import { defineBackground } from "wxt/sandbox";
import { analyseListing } from "../lib/api";
import { cacheGet, cacheSet } from "../lib/cache";
import type {
  AnalyseMessage,
  AnalyseResponse,
  AnalyseRequest,
} from "../lib/types";

/** Background service worker.
 *
 *  Responsibilities:
 *    1. Receive ANALYSE messages from the content script.
 *    2. Check chrome.storage.local for a fresh (≤24h) cached summary.
 *    3. On miss, fetch /api/extension/analyse on the Hauscope main app.
 *    4. Cache the response and reply.
 *
 *  Why fetch lives here (not in the content script): the Hauscope API
 *  origin is cross-site and we don't ship CORS headers on the
 *  endpoint. SW fetches aren't subject to page-CORS, so the round-trip
 *  is reliable regardless of the host site's policy. */
export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (raw: unknown, _sender, sendResponse: (resp: AnalyseResponse) => void) => {
      const message = raw as AnalyseMessage | undefined;
      if (!message || message.type !== "ANALYSE") return false;
      void handleAnalyse(message.payload).then(sendResponse);
      // Returning true keeps the message channel open for the async reply.
      return true;
    },
  );
});

async function handleAnalyse(payload: AnalyseRequest): Promise<AnalyseResponse> {
  // Local cache hit — instant return, no network.
  const cached = await cacheGet(payload.listingId).catch(() => null);
  if (cached) {
    return { ok: true, data: cached };
  }
  try {
    const data = await analyseListing(payload);
    await cacheSet(payload.listingId, data).catch(() => {});
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analyse failed";
    return { ok: false, error: message };
  }
}
