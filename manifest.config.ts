import type { UserManifest } from "wxt";

/**
 * MV3 manifest fragment merged into wxt.config.ts. Name + version are
 * derived from package.json by WXT; we only define what's specific to
 * the runtime surface.
 *
 * Permissions:
 *   activeTab — drive the panel UI on the focused Rightmove listing.
 *   storage   — back the 24h cache.local TTL store (lib/cache.ts).
 *
 * host_permissions covers two origins:
 *   rightmove.co.uk — the content script attaches here.
 *   hauscope.com    — the background service worker fetches our API
 *     here. MV3 SW fetches ARE subject to CORS unless the target
 *     origin is declared in host_permissions, so without this entry
 *     the /api/extension/analyse call fails with "Failed to fetch".
 *     Declaring it makes the SW fetch privileged for that origin and
 *     skips the CORS check, the same way an MV2 background page
 *     would have behaved.
 */
export const manifestConfig: UserManifest = {
  name: "Hauscope",
  description:
    "See how each Rightmove listing compares to real local sales — directly on the page.",
  permissions: ["activeTab", "storage"],
  host_permissions: [
    "*://*.rightmove.co.uk/*",
    "https://hauscope.com/*",
    "https://*.hauscope.com/*",
  ],
  action: {
    default_title: "Hauscope",
    default_popup: "popup.html",
  },
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
};
