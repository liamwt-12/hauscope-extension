import type { AnalyseRequest } from "../types";

/** Pulls a Rightmove listing id from a URL.
 *
 *  Rightmove URLs come in two flavours we care about:
 *    /properties/123456789
 *    /properties/123456789#/?channel=RES_BUY
 *
 *  Search results / map / agent pages do not match — the panel only
 *  mounts on a property detail page. */
export function getRightmoveListingId(url: string): string | null {
  const m = url.match(/\/properties\/(\d+)/);
  return m ? m[1] : null;
}

/** Two-stage extraction: try PAGE_MODEL via a main-world script
 *  injection (Rightmove keeps a rich JS object on the listing page
 *  with everything we need), then fall back to DOM scraping if the
 *  injected probe doesn't return a usable payload inside the timeout.
 *
 *  Returned shape is exactly the AnalyseRequest body the Hauscope API
 *  expects — the caller can hand it straight to the background SW. */
export async function extractRightmoveListing(): Promise<AnalyseRequest | null> {
  const listingId = getRightmoveListingId(window.location.href);
  if (!listingId) return null;

  const fromPageModel = await tryExtractFromPageModel(listingId);
  if (fromPageModel) return fromPageModel;

  return tryExtractFromDom(listingId);
}

// ─── PAGE_MODEL probe ─────────────────────────────────────────────────
//
// Content scripts run in an isolated world and can't see `window.PAGE_MODEL`.
// We inject a tiny script tag into the page's main world; it reads the
// global and posts the payload back via window.postMessage. The probe
// resolves null on any failure so the caller transparently falls through
// to DOM scraping.

async function tryExtractFromPageModel(
  listingId: string,
): Promise<AnalyseRequest | null> {
  return new Promise((resolve) => {
    const channel = `hsc-extract-${listingId}-${Math.random().toString(36).slice(2, 8)}`;

    function cleanup() {
      window.removeEventListener("message", listener);
      script.remove();
    }

    function listener(e: MessageEvent) {
      if (e.source !== window) return;
      const data = e.data as { channel?: string; payload?: AnalyseRequest | null } | null;
      if (!data || data.channel !== channel) return;
      cleanup();
      resolve(data.payload ?? null);
    }

    window.addEventListener("message", listener);

    const script = document.createElement("script");
    script.textContent = `(() => {
      function send(payload) {
        window.postMessage({ channel: ${JSON.stringify(channel)}, payload }, "*");
      }
      try {
        const pm = window.PAGE_MODEL || window.PAGE_MODEL_DESKTOP;
        const p = pm && (pm.propertyData || pm.analyticsInfo && pm.analyticsInfo.propertyData);
        if (!p) { send(null); return; }
        const priceText = (p.prices && (p.prices.primaryPrice || p.prices.displayPrice || "")) || "";
        const price = parseInt(String(priceText).replace(/[^0-9]/g, ""), 10) || 0;
        const outcode = p.address && p.address.outcode ? String(p.address.outcode).trim() : "";
        const incode = p.address && p.address.incode ? String(p.address.incode).trim() : "";
        const postcode = outcode && incode ? outcode + " " + incode : "";
        const customer = p.customer || {};
        send({
          source: "rightmove",
          listingId: String(p.id || ${JSON.stringify(listingId)}),
          url: window.location.href,
          price,
          address: (p.address && p.address.displayAddress) || "",
          postcode,
          bedrooms: Number(p.bedrooms || 0),
          propertyType: p.propertySubType || p.propertyType || "",
          listingDate: p.listingHistory && (p.listingHistory.listingUpdateDate || p.listingHistory.firstVisibleDate) || undefined,
          agent: customer && (customer.branchName || customer.companyName)
            ? { name: customer.companyName || customer.branchName || "", branchName: customer.branchName || "" }
            : undefined,
        });
      } catch (err) {
        send(null);
      }
    })();`;

    (document.head || document.documentElement).appendChild(script);

    // PAGE_MODEL is set synchronously by Rightmove's bootstrap; 1.5s
    // is generous. If the global never materialises (e.g., CSP blocks
    // the inline injection) we fall through to the DOM scrape.
    setTimeout(() => {
      cleanup();
      resolve(null);
    }, 1500);
  });
}

// ─── DOM fallback ────────────────────────────────────────────────────
//
// Selectors target Rightmove's data-testid attributes where present.
// Brittle by nature — if the page redesigns we lose extraction, but
// at that point the PAGE_MODEL path is still the primary surface so
// this is acceptable for v1.

function tryExtractFromDom(listingId: string): AnalyseRequest | null {
  const url = window.location.href;

  const priceText =
    document.querySelector('[data-testid="primary-price"]')?.textContent?.trim() ??
    document.querySelector('[itemprop="price"]')?.textContent?.trim() ??
    "";
  const price = parseInt(priceText.replace(/[^0-9]/g, ""), 10);

  const address =
    document.querySelector('[data-testid="address-label"]')?.textContent?.trim() ??
    document.querySelector("h1")?.textContent?.trim() ??
    "";

  const postcodeMatch = address.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  const postcode = postcodeMatch ? postcodeMatch[1].toUpperCase() : "";

  const bedsText =
    document.querySelector('[data-testid="property-bedrooms"]')?.textContent ??
    document.querySelector('dl[data-test="bedrooms"]')?.textContent ??
    "";
  const bedsMatch = bedsText.match(/(\d+)/);
  const bedrooms = bedsMatch ? parseInt(bedsMatch[1], 10) : 0;

  const propertyType =
    document.querySelector('[data-testid="property-type"]')?.textContent?.trim() ??
    document.querySelector('dl[data-test="property-type"]')?.textContent?.trim() ??
    "";

  if (!Number.isFinite(price) || price <= 0) return null;
  if (!address || !postcode) return null;

  return {
    source: "rightmove",
    listingId,
    url,
    price,
    address,
    postcode,
    bedrooms,
    propertyType,
  };
}
