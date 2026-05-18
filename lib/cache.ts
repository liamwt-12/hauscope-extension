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
