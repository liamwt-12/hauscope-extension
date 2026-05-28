import type { ExtensionSummary } from "./types";

/** Local 24-hour TTL cache keyed on Rightmove listingId. The Hauscope
 *  API also caches at the property_url layer (24h), but local caching
 *  saves a network round-trip on repeat opens of the same listing and
 *  keeps the panel snappy when the user toggles between tabs. */

const TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PREFIX = "hsc:listing:";

type Entry = {
  storedAt: number;
  data: ExtensionSummary;
};

export async function cacheGet(listingId: string): Promise<ExtensionSummary | null> {
  const key = KEY_PREFIX + listingId;
  const obj = await chrome.storage.local.get(key);
  const entry = obj[key] as Entry | undefined;
  if (!entry) return null;
  if (Date.now() - entry.storedAt > TTL_MS) {
    await chrome.storage.local.remove(key).catch(() => {});
    return null;
  }
  return entry.data;
}

export async function cacheSet(
  listingId: string,
  data: ExtensionSummary,
): Promise<void> {
  const key = KEY_PREFIX + listingId;
  const entry: Entry = { storedAt: Date.now(), data };
  await chrome.storage.local.set({ [key]: entry });
}

/** Manual eviction — useful when the user explicitly refreshes the
 *  panel. Not yet wired to UI but kept here so the cache surface is
 *  self-contained. */
export async function cacheClear(listingId: string): Promise<void> {
  await chrome.storage.local.remove(KEY_PREFIX + listingId).catch(() => {});
}

// ─── Dismissed bar state ─────────────────────────────────────────────
//
// Per-listing flag remembering that the user collapsed the top bar to
// its tab. No TTL — a dismissal should stick for that listing across
// reloads and SPA navigation. Content scripts can read/write
// chrome.storage.local directly, so the Panel owns these calls.

const DISMISS_PREFIX = "hsc:dismissed:";

export async function getDismissed(listingId: string): Promise<boolean> {
  const key = DISMISS_PREFIX + listingId;
  const obj = await chrome.storage.local.get(key);
  return obj[key] === true;
}

export async function setDismissed(
  listingId: string,
  dismissed: boolean,
): Promise<void> {
  const key = DISMISS_PREFIX + listingId;
  if (dismissed) {
    await chrome.storage.local.set({ [key]: true });
  } else {
    await chrome.storage.local.remove(key).catch(() => {});
  }
}
