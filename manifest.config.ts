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
 * Host permissions are pinned to rightmove.co.uk so the extension
 * cannot run on any other origin. The Hauscope API origin is reached
 * via the background service worker's fetch, which isn't gated by host
 * permissions (MV3 service workers can fetch any origin).
 */
export const manifestConfig: UserManifest = {
  name: "Hauscope",
  description:
    "See how each Rightmove listing compares to real local sales — directly on the page.",
  permissions: ["activeTab", "storage"],
  host_permissions: ["*://*.rightmove.co.uk/*"],
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
