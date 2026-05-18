import type { AnalyseRequest } from "../types";

/** Pulls the listing id out of a Rightmove property URL.
 *  Format: /properties/<numeric id>[#/…?…]. Anything else (search,
 *  agent, map) returns null and the panel never mounts. */
export function getRightmoveListingId(url: string): string | null {
  const m = url.match(/\/properties\/(\d+)/);
  return m ? m[1] : null;
}

/** DOM-only extractor. PAGE_MODEL was removed from Rightmove sometime
 *  before v1; the inline-script probe + main-world injection is gone.
 *
 *  Required fields (panel shows error if any are missing):
 *    listingId, url, price, address, postcode.
 *  Optional / best-effort:
 *    bedrooms (defaults to 0 = unknown — the server re-parses the URL
 *      itself so this is metadata, not load-bearing),
 *    propertyType (defaults to "" if no match — same reasoning). */
export async function extractRightmoveListing(): Promise<AnalyseRequest | null> {
  const url = window.location.href;
  const listingId = getRightmoveListingId(url);
  if (!listingId) return null;

  const price = findAskingPrice();
  const address = (document.querySelector("h1")?.textContent ?? "").trim();
  const bedrooms = findBedrooms();
  const propertyType = findPropertyType();
  const postcode = await resolvePostcode(address);

  // Hard requirements — without these the server validation fails.
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
    // 0 acts as "unknown" — the server's parseListingUrl(url) call
    // does its own bedrooms read, so this field is informational only.
    bedrooms: bedrooms ?? 0,
    propertyType,
  };
}

// ─── Price ───────────────────────────────────────────────────────────
//
// Rightmove renders the asking price in an un-classed <span> matching
// /^£[\d,]+$/. Other £-bearing spans on the page are scoped:
//   - monthly payment: class "text-md font-medium leading-[1.4]"
//   - affordability widget duplicates: text "Property: £ 270,000" etc.
// Filtering on className === "" plus the tight regex catches the right
// one without an extra heuristic. We also require children.length === 0
// to skip wrapper spans whose textContent recursively concatenates.

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

// ─── Bedrooms ────────────────────────────────────────────────────────
//
// First pattern matches "3 bed", "3 bedrooms", "3x bed", etc. anywhere
// in body innertext. Second handles label-style "Bedrooms: 3". If
// neither matches, return null and the caller defaults to 0.

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

// ─── Property type ───────────────────────────────────────────────────

const TYPE_RE =
  /\b(end[-\s]?of[-\s]?terrace|semi[-\s]?detached|detached|terraced|flat|apartment|maisonette|bungalow|cottage|townhouse|studio)\b/i;

function findPropertyType(): string {
  const text = document.body?.innerText ?? "";
  const m = text.match(TYPE_RE);
  return m ? m[1] : "";
}

// ─── Postcode resolution ────────────────────────────────────────────
//
// Tier 1: scan body innerText for a full UK postcode pattern. Many
//   property pages mention one in the description / nearby schools /
//   agent block; the regex picks the first match.
// Tier 2: extract an outcode segment from the H1 address (e.g. "TS5"
//   from "Acklam Road, Middlesbrough, TS5") and resolve to a full
//   postcode via postcodes.io. The resolved postcode is approximate
//   — postcodes.io's q-search returns the first postcode it finds
//   within the outcode — but the Hauscope API uses the URL, not the
//   postcode, for the actual valuation; this field exists to satisfy
//   server-side POSTCODE_RE validation.
//
// Both layers can miss. If a property page has no postcode-shaped
// text and the address has no outcode segment (e.g. "…Newcastle Upon
// Tyne"), this returns null and the panel renders the error state.

const FULL_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const OUTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

async function resolvePostcode(address: string): Promise<string | null> {
  const text = document.body?.innerText ?? "";
  const fullMatch = text.match(FULL_POSTCODE_RE);
  if (fullMatch) {
    // Normalise: uppercase, single space between outward and inward.
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
  try {
    const resp = await fetch(
      `https://api.postcodes.io/postcodes?q=${encodeURIComponent(outcode)}&limit=1`,
    );
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
