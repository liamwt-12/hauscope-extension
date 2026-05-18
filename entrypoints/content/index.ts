import { defineContentScript } from "wxt/sandbox";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { Panel } from "../../components/Panel";
import { getRightmoveListingId } from "../../lib/extractors/rightmove";
// Tailwind compiled CSS imported as a string at build time. `?inline`
// tells Vite to inline the asset; the result is the same CSS bundle
// WXT would otherwise auto-inject, but as a literal we can drop into
// a <style> element inside the shadow root.
import tailwindCss from "./style.css?inline";

const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=DM+Sans:wght@400;500;600&display=swap";

const HOST_ID = "hauscope-root";
// Window-level singleton flag. If WXT/Chrome re-injects this content
// script (dev HMR, manual reload, race during SPA nav), main() runs
// again — each run would otherwise instantiate its own React root over
// the same logical container and React would throw "createRoot() on a
// container that has already been passed to createRoot()".
const SINGLETON_FLAG = "__hauscopeMounted__";

/** Rightmove content script.
 *
 *  Manages a single shadow-DOM panel per listing. We deliberately do
 *  NOT use createShadowRootUi — under some WXT/React combinations its
 *  onMount container resolved to the ShadowRoot itself (or document.body),
 *  which trips React 18's "Creating roots directly with document.body"
 *  warning.
 *
 *  Mount chain (each step is required for createRoot to receive a
 *  fully-attached ELEMENT_NODE container):
 *    1. Create host <div id="hauscope-root">, append to body.
 *    2. Attach an open shadow root on the host.
 *    3. Inject Tailwind + Google Fonts inside the shadow.
 *    4. Create a separate <div> inside the shadow as the React mount
 *       point. createRoot(container) — never createRoot(shadow). */
export default defineContentScript({
  matches: ["*://*.rightmove.co.uk/*"],
  runAt: "document_idle",
  // We manage the shadow root ourselves, so opt out of WXT's auto
  // CSS-into-manifest behaviour. The `?inline` import above pulls the
  // Tailwind bundle in as a string for the manual style injection.
  cssInjectionMode: "manual",

  main(ctx) {
    // Re-injection guard. A previous instance already owns the panel —
    // bail out before we touch the DOM or instantiate a second root.
    const w = window as unknown as Record<string, unknown>;
    if (w[SINGLETON_FLAG]) return;
    w[SINGLETON_FLAG] = true;

    let activeListingId: string | null = null;
    let mount: PanelMount | null = null;

    function mountForListing(listingId: string) {
      mount?.unmount();
      mount = createPanelMount(listingId);
    }

    function checkListing() {
      const listingId = getRightmoveListingId(window.location.href);
      if (listingId && listingId !== activeListingId) {
        activeListingId = listingId;
        mountForListing(listingId);
        return;
      }
      if (!listingId && mount) {
        mount.unmount();
        mount = null;
        activeListingId = null;
      }
    }

    // document_idle fires after DOMContentLoaded but page scripts may
    // still be mutating body layout. Deferring the first mount one
    // frame gives the body a stable state before we attach the host.
    requestAnimationFrame(checkListing);

    // SPA navigation observer — Rightmove transitions via pushState
    // without a full document load. Watch URL changes via a cheap
    // DOM-mutation tick and re-check the listing id.
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        checkListing();
      }
    });
    observer.observe(document, { subtree: true, childList: true });

    window.addEventListener("popstate", checkListing);

    // Tear-down on extension reload / SW restart.
    ctx.onInvalidated(() => {
      observer.disconnect();
      window.removeEventListener("popstate", checkListing);
      mount?.unmount();
      mount = null;
      delete w[SINGLETON_FLAG];
    });
  },
});

// ─── Mount helpers ──────────────────────────────────────────────────

type PanelMount = { unmount(): void };

function createPanelMount(listingId: string): PanelMount {
  // Strip any orphan host left over from a previous mount that didn't
  // clean up (e.g. unhandled exception during render).
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  // Tailwind base/components/utilities — injected as a <style> so it
  // applies only inside the shadow tree (and host-page rules can't
  // leak in to override our hsc- utilities).
  const styleEl = document.createElement("style");
  styleEl.textContent = tailwindCss;
  shadow.appendChild(styleEl);

  // Cormorant Garamond + DM Sans inside the shadow, so the host
  // page's font stack doesn't shadow ours.
  const fontLink = document.createElement("link");
  fontLink.rel = "stylesheet";
  fontLink.href = GOOGLE_FONTS_HREF;
  shadow.appendChild(fontLink);

  // Dedicated React container — React 18 refuses ShadowRoot or body
  // as a createRoot target. The div is appended to the shadow BEFORE
  // createRoot so React sees a fully-attached ELEMENT_NODE.
  const container = document.createElement("div");
  shadow.appendChild(container);

  let root: Root | null = createRoot(container);
  root.render(createElement(Panel, { listingId }));

  return {
    unmount() {
      // Unmount can land mid-render if a SPA nav fires before the
      // initial commit. Guard against a double-unmount of the same
      // root (also throws inside React).
      if (root) {
        root.unmount();
        root = null;
      }
      host.remove();
    },
  };
}
