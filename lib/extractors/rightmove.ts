import type { AnalyseRequest } from "../types";

/** Pulls the listing id out of a Rightmove property URL.
 *  Format: /properties/<numeric id>[#/…?…]. Anything else (search,
 *  agent, map) returns null and the panel never mounts. */
export function getRightmoveListingId(url: string): string | null {
  const m = url.match(/\/properties\/(\d+)/);
  return m ? m[1] : null;
}

/** Listing extractor.
 *
 *  Primary path reads Rightmove's window.__PAGE_MODEL — the same source
 *  the main app's lib/property/rightmove-provider.ts parses, using the
 *  identical flatted unflatten + listingUpdateReason decode. The
 *  difference is where the payload comes from: a content script runs in
 *  an isolated world and can't see the page's `window`, but it CAN read
 *  the inline bootstrap <script> element's text from the DOM, which
 *  carries the `window.__PAGE_MODEL = {…}` assignment verbatim.
 *
 *  This gives us a real listingDate (firstListedDate) that DOM scraping
 *  can't, plus reliable price/address/postcode/bedrooms/type.
 *
 *  Falls back to DOM scraping when the model is absent, unparseable, or
 *  belongs to a different listing (a stale model left in the DOM after
 *  an SPA navigation). The fallback can't supply listingDate. */
export async function extractRightmoveListing(): Promise<AnalyseRequest | null> {
  const url = window.location.href;
  const listingId = getRightmoveListingId(url);
  if (!listingId) return null;

  const fromModel = extractFromPageModel(listingId);
  if (fromModel) {
    const postcode = await resolveFullPostcode(
      fromModel.postcodeCandidate,
      fromModel.address,
    );
    if (fromModel.price && fromModel.address && postcode) {
      return {
        source: "rightmove",
        listingId,
        url,
        price: fromModel.price,
        address: fromModel.address,
        postcode,
        bedrooms: fromModel.bedrooms ?? 0,
        propertyType: fromModel.propertyType,
        listingDate: fromModel.listingDate,
        agent: fromModel.agent,
      };
    }
  }

  return extractFromDom(listingId, url);
}

// ─── PAGE_MODEL extraction ───────────────────────────────────────────
//
// Ported from the main app (lib/property/rightmove-provider.ts). Kept
// in sync deliberately: the unflatten algorithm and the
// listingUpdateReason parser must match the server so both surfaces
// derive the same firstListedDate from the same payload.

// Matches the current double-underscore global and the legacy
// single-underscore one, with or without surrounding whitespace
// (minified inline scripts may drop the spaces the server HTML keeps).
const PAGE_MODEL_MARKER_RE = /window\.(?:__)?PAGE_MODEL\s*=/;

type PageModelFields = {
  price: number | null;
  address: string | null;
  /** Full postcode ("EN6 1PW"), bare outcode ("EN6"), or null — the
   *  caller resolves it to a full postcode the server will accept. */
  postcodeCandidate: string | null;
  bedrooms: number | null;
  propertyType: string;
  listingDate?: string;
  agent?: { name: string; branchName: string };
};

function extractFromPageModel(listingId: string): PageModelFields | null {
  const propertyData = readPropertyData();
  if (!propertyData) return null;

  // Stale-model guard: after an SPA navigation the inline bootstrap
  // script still holds the listing the document first loaded with.
  // Reject it when its id doesn't match the listing in the URL so we
  // fall through to DOM scraping of the live page.
  const modelId = propertyData.id;
  if (modelId != null && String(modelId) !== listingId) return null;

  const prices = asRecord(propertyData.prices);
  const price =
    parsePrice(prices?.primaryPrice) ??
    parsePrice(prices?.secondaryPrice) ??
    parsePrice(propertyData.price);

  const addressObj = asRecord(propertyData.address);
  const address = firstString(addressObj?.displayAddress, propertyData.displayAddress);

  // Rightmove ships the postcode split into outcode + incode on the
  // address object (displayAddress usually omits it). Combine when both
  // ship; fall back to the bare outcode otherwise.
  const outcode = firstString(addressObj?.outcode);
  const incode = firstString(addressObj?.incode);
  const postcodeCandidate = outcode && incode ? `${outcode} ${incode}` : outcode;

  const bedrooms = parseBedrooms(propertyData.bedrooms);
  const propertyType =
    firstString(propertyData.propertySubType, propertyData.propertyType) ?? "";

  const listingHistory = asRecord(propertyData.listingHistory);
  const { firstListedDate } = parseListingUpdateReason(
    listingHistory?.listingUpdateReason,
  );

  const customer = asRecord(propertyData.customer);
  const agentName = firstString(
    customer?.companyName,
    customer?.branchDisplayName,
    customer?.branchName,
  );
  const branchName = firstString(customer?.branchName, customer?.branchDisplayName);
  const agent =
    agentName && branchName ? { name: agentName, branchName } : undefined;

  return {
    price,
    address,
    postcodeCandidate,
    bedrooms,
    propertyType,
    listingDate: firstListedDate,
    agent,
  };
}

/** Locate the inline <script> carrying the PAGE_MODEL assignment, slice
 *  out the JSON value, JSON.parse the envelope, unflatten the data
 *  array, and return propertyData. Mirrors fromPageModel() in the main
 *  app, adapted to read from script-element text rather than a fetched
 *  HTML string. */
function readPropertyData(): Record<string, unknown> | null {
  const text = readPageModelScript();
  if (!text) return null;

  const marker = PAGE_MODEL_MARKER_RE.exec(text);
  if (!marker) return null;
  const after = text.slice(marker.index + marker[0].length);
  const end = findJsonValueEnd(after);
  if (end === -1) return null;
  const raw = after.slice(0, end).trim();

  let unflattened: unknown = null;
  try {
    const envelope = JSON.parse(raw) as unknown;
    // New shape: {"data":"[<flatted array json>]","encoding":"on"}.
    // Old shape: the parsed JSON is already the model object/array.
    if (envelope && typeof envelope === "object" && !Array.isArray(envelope)) {
      const dataField = (envelope as Record<string, unknown>).data;
      if (typeof dataField === "string") {
        const arr = JSON.parse(dataField);
        if (Array.isArray(arr)) unflattened = unflatten(arr);
      } else {
        unflattened = envelope; // legacy: envelope is the model
      }
    } else if (Array.isArray(envelope)) {
      unflattened = unflatten(envelope);
    }
  } catch {
    return null;
  }

  if (!unflattened || typeof unflattened !== "object" || Array.isArray(unflattened)) {
    return null;
  }
  const root = unflattened as Record<string, unknown>;
  return asRecord(root.propertyData) ?? root;
}

function readPageModelScript(): string | null {
  const scripts = document.querySelectorAll("script");
  for (const s of scripts) {
    const text = s.textContent ?? "";
    if (PAGE_MODEL_MARKER_RE.test(text)) return text;
  }
  return null;
}

// ─── Flatted unflatten (ported verbatim from the main app) ───────────
//
// Rightmove's __PAGE_MODEL.data uses the "flatted" encoding
// (https://github.com/WebReflection/flatted): a JSON array where cell 0
// is the root and every container's values are integer indices back
// into the array. A memoised DFS from cell 0 resolves the graph in
// linear time; integer values inside dicts/arrays are treated as refs.

function unflatten(arr: unknown[]): unknown {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const resolved: unknown[] = new Array(arr.length);
  const seen: boolean[] = new Array(arr.length).fill(false);

  function isRef(v: unknown): v is number {
    return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < arr.length;
  }

  function walk(idx: number): unknown {
    if (seen[idx]) return resolved[idx];
    seen[idx] = true;
    const cell = arr[idx];
    if (Array.isArray(cell)) {
      const out: unknown[] = [];
      resolved[idx] = out;
      for (const v of cell) {
        out.push(isRef(v) ? walk(v) : v);
      }
      return out;
    }
    if (cell !== null && typeof cell === "object") {
      const out: Record<string, unknown> = {};
      resolved[idx] = out;
      for (const [k, v] of Object.entries(cell as Record<string, unknown>)) {
        out[k] = isRef(v) ? walk(v) : v;
      }
      return out;
    }
    resolved[idx] = cell;
    return cell;
  }

  return walk(0);
}

/** Find the end of the JSON value starting at the head of `source`,
 *  respecting string boundaries so a `}` inside a string doesn't close
 *  the scan early. Returns the index one past the close, or -1. The
 *  PAGE_MODEL script ships further statements after the assignment, so
 *  we can't naively slice to the next brace. */
function findJsonValueEnd(source: string): number {
  let i = 0;
  while (i < source.length && /\s/.test(source[i])) i++;
  const open = source[i];
  if (open !== "{" && open !== "[") return -1;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// ─── listingHistory.listingUpdateReason parser (ported) ──────────────
//
// The current model collapses listing history into a single string:
//   "Added on DD/MM/YYYY" | "Added today" | "Added yesterday"
//   "Reduced on DD/MM/YYYY" | "Reduced today" | "Reduced yesterday"
// "Added" gives a real firstListedDate. "Reduced" tells us only that
// the most recent event was a reduction — no first-listed date — so we
// leave firstListedDate undefined there.

const ADDED_ON_RE = /^Added on (\d{1,2})\/(\d{1,2})\/(\d{4})/i;
const REDUCED_ON_RE = /^Reduced on (\d{1,2})\/(\d{1,2})\/(\d{4})/i;

type ListingUpdateParsed = {
  firstListedDate?: string;
  wasReduced?: boolean;
  lastReductionDate?: string;
};

function parseListingUpdateReason(raw: unknown): ListingUpdateParsed {
  if (typeof raw !== "string") return {};
  const reason = raw.trim();
  if (!reason) return {};

  if (/^Added today\b/i.test(reason)) return { firstListedDate: todayIso() };
  if (/^Added yesterday\b/i.test(reason)) return { firstListedDate: yesterdayIso() };
  const addedMatch = reason.match(ADDED_ON_RE);
  if (addedMatch) {
    const iso = isoFromDdMmYyyy(addedMatch[1], addedMatch[2], addedMatch[3]);
    return iso ? { firstListedDate: iso } : {};
  }

  if (/^Reduced today\b/i.test(reason)) {
    return { wasReduced: true, lastReductionDate: todayIso() };
  }
  if (/^Reduced yesterday\b/i.test(reason)) {
    return { wasReduced: true, lastReductionDate: yesterdayIso() };
  }
  const reducedMatch = reason.match(REDUCED_ON_RE);
  if (reducedMatch) {
    const iso = isoFromDdMmYyyy(reducedMatch[1], reducedMatch[2], reducedMatch[3]);
    return iso ? { wasReduced: true, lastReductionDate: iso } : {};
  }

  return {};
}

function isoFromDdMmYyyy(d: string, m: string, y: string): string | null {
  const day = parseInt(d, 10);
  const month = parseInt(m, 10);
  const year = parseInt(y, 10);
  if (!day || !month || !year) return null;
  if (year < 1990 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ─── Small value coercions (ported) ──────────────────────────────────

function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseBedrooms(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) {
    return Math.round(input);
  }
  const text = typeof input === "string" ? input : "";
  const match =
    text.match(/\b(\d+)\s*(?:bed|beds|bedroom|bedrooms)\b/i) ?? text.match(/^\s*(\d+)\s*$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

// ─── DOM fallback ─────────────────────────────────────────────────────
//
// Used when PAGE_MODEL is unavailable or stale. Scrapes the rendered
// page. Cannot supply listingDate, so the server's days-on-market falls
// back — but price/address/postcode still come through.

async function extractFromDom(
  listingId: string,
  url: string,
): Promise<AnalyseRequest | null> {
  const price = findAskingPrice();
  const address = (document.querySelector("h1")?.textContent ?? "").trim();
  const bedrooms = findBedrooms();
  const propertyType = findPropertyType();
  const postcode = await resolvePostcode(address);

  if (!price) return null;
  if (!address) return null;
  if (!postcode) return null;

  return {
    source: "rightmove",
    listingId,
    url,
    price,
    address,
    postcode,
    bedrooms: bedrooms ?? 0,
    propertyType,
  };
}

// ─── Price (DOM) ──────────────────────────────────────────────────────
//
// Rightmove renders the asking price in an un-classed <span> matching
// /^£[\d,]+$/. Other £-bearing spans on the page are scoped (monthly
// payment, affordability widget). Filtering on className === "" plus
// the tight regex catches the right one; children.length === 0 skips
// wrapper spans whose textContent recursively concatenates.

const PRICE_RE = /^£[\d,]+$/;

function findAskingPrice(): number | null {
  const spans = document.querySelectorAll<HTMLSpanElement>("span");
  for (const el of spans) {
    if (el.className !== "") continue;
    if (el.children.length > 0) continue;
    const text = el.textContent?.trim() ?? "";
    if (!PRICE_RE.test(text)) continue;
    const n = parseInt(text.replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

// ─── Bedrooms (DOM) ───────────────────────────────────────────────────

function findBedrooms(): number | null {
  const text = document.body?.innerText ?? "";
  const inline = text.match(/(\d+)\s*(?:x\s*)?(?:bed(?:room)?s?)\b/i);
  if (inline) {
    const n = parseInt(inline[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const labelled = text.match(/bed(?:room)?s?\s*[:\-]?\s*(\d+)/i);
  if (labelled) {
    const n = parseInt(labelled[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

// ─── Property type (DOM) ──────────────────────────────────────────────

const TYPE_RE =
  /\b(end[-\s]?of[-\s]?terrace|semi[-\s]?detached|detached|terraced|flat|apartment|maisonette|bungalow|cottage|townhouse|studio)\b/i;

function findPropertyType(): string {
  const text = document.body?.innerText ?? "";
  const m = text.match(TYPE_RE);
  return m ? m[1] : "";
}

// ─── Postcode resolution ──────────────────────────────────────────────

const FULL_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const OUTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

/** Resolve a PAGE_MODEL postcode candidate to a full postcode the
 *  server's POSTCODE_RE will accept. Full postcode → normalise; bare
 *  outcode → expand via postcodes.io; nothing usable → fall back to the
 *  address/innerText scan. */
async function resolveFullPostcode(
  candidate: string | null,
  address: string | null,
): Promise<string | null> {
  if (candidate) {
    const upper = candidate.toUpperCase().replace(/\s+/g, " ").trim();
    const full = upper.match(FULL_POSTCODE_RE);
    if (full) {
      const pc = full[1].toUpperCase().replace(/\s+/g, " ");
      return pc.includes(" ") ? pc : pc.replace(/(.+)(\d[A-Z]{2})$/, "$1 $2");
    }
    if (OUTCODE_RE.test(upper)) {
      const expanded = await outcodeToFullPostcode(upper);
      if (expanded) return expanded;
    }
  }
  return resolvePostcode(address ?? "");
}

async function resolvePostcode(address: string): Promise<string | null> {
  const text = document.body?.innerText ?? "";
  const fullMatch = text.match(FULL_POSTCODE_RE);
  if (fullMatch) {
    const upper = fullMatch[1].toUpperCase().replace(/\s+/g, " ");
    return upper.includes(" ")
      ? upper
      : upper.replace(/(.+)(\d[A-Z]{2})$/, "$1 $2");
  }

  const outcode = outcodeFromAddress(address);
  if (!outcode) return null;
  return outcodeToFullPostcode(outcode);
}

function outcodeFromAddress(address: string): string | null {
  const segments = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Scan back-to-front — the outcode, when present, sits at the tail.
  for (let i = segments.length - 1; i >= 0; i--) {
    if (OUTCODE_RE.test(segments[i])) return segments[i].toUpperCase();
  }
  return null;
}

async function outcodeToFullPostcode(outcode: string): Promise<string | null> {
  const url = `https://api.postcodes.io/postcodes?q=${encodeURIComponent(outcode)}&limit=1`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      result?: Array<{ postcode?: string }> | null;
    };
    const pc = data.result?.[0]?.postcode;
    return pc ? pc.toUpperCase() : null;
  } catch {
    return null;
  }
}
