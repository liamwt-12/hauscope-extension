import { defineContentScript } from "wxt/sandbox";
import ReactDOM from "react-dom/client";
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

/** Rightmove content script.
 *
 *  Manages a single shadow-DOM panel per listing. We deliberately do
 *  NOT use createShadowRootUi — under some WXT/React combinations its
 *  onMount container resolved to the ShadowRoot itself (or document.body),
 *  which trips React 18's "Creating roots directly with document.body"
 *  warning and the #421 root-rendering error.
 *
 *  Instead we own the host/shadow/container chain explicitly:
 *    1. Create a host <div id="hauscope-root">, append to body.
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

    // Initial mount on first paint.
    checkListing();

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
  // as a createRoot target. Always mount into a plain <div> inside
  // the shadow.
  const container = document.createElement("div");
  shadow.appendChild(container);

  const root = ReactDOM.createRoot(container);
  root.render(createElement(Panel, { listingId }));

  return {
    unmount() {
      root.unmount();
      host.remove();
    },
  };
}
