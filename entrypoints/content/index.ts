import { defineContentScript } from "wxt/sandbox";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { Panel } from "../../components/Panel";
import { getRightmoveListingId } from "../../lib/extractors/rightmove";
import { getDismissed } from "../../lib/cache";
// Tailwind compiled CSS imported as a string at build time. `?inline`
// tells Vite to inline the asset; the result is the same CSS bundle
// WXT would otherwise auto-inject, but as a literal we can drop into
// a <style> element inside the shadow root.
import tailwindCss from "./style.css?inline";

const HOST_ID = "hauscope-root";
// Window-level singleton flag. If WXT/Chrome re-injects this content
// script (dev HMR, manual reload, race during SPA nav), main() runs
// again — each run would otherwise instantiate its own React root over
// the same logical container and React would throw "createRoot() on a
// container that has already been passed to createRoot()".
const SINGLETON_FLAG = "__hauscopeMounted__";

// Bar heights (px). 56 on desktop, 40 once the responsive layout
// collapses below 700px. The body offset must track this so the page
// content sits exactly below the bar at every width.
const BAR_HEIGHT_DESKTOP = 56;
const BAR_HEIGHT_NARROW = 40;
const NARROW_BREAKPOINT = 700;

function barHeight(): number {
  return window.innerWidth < NARROW_BREAKPOINT
    ? BAR_HEIGHT_NARROW
    : BAR_HEIGHT_DESKTOP;
}

// Self-hosted fonts. Declared at runtime because the chrome-extension://
// URL is per-install and can't live in a static stylesheet. The files
// are exposed to the Rightmove origin via web_accessible_resources.
const FONT_FACES: ReadonlyArray<{ family: string; weight: number; file: string }> = [
  { family: "DM Sans", weight: 400, file: "dm-sans-400.woff2" },
  { family: "DM Sans", weight: 500, file: "dm-sans-500.woff2" },
  { family: "DM Sans", weight: 600, file: "dm-sans-600.woff2" },
  { family: "Cormorant Garamond", weight: 500, file: "cormorant-garamond-500.woff2" },
  { family: "Cormorant Garamond", weight: 600, file: "cormorant-garamond-600.woff2" },
];

function fontFaceCss(): string {
  return FONT_FACES.map(
    ({ family, weight, file }) =>
      `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};` +
      `font-display:swap;src:url("${chrome.runtime.getURL(`fonts/${file}`)}") format("woff2");}`,
  ).join("");
}

/** Rightmove content script.
 *
 *  Manages a single shadow-DOM top bar per listing. We deliberately do
 *  NOT use createShadowRootUi — under some WXT/React combinations its
 *  onMount container resolved to the ShadowRoot itself (or document.body),
 *  which trips React 18's "Creating roots directly with document.body"
 *  warning.
 *
 *  Mount chain (each step is required for createRoot to receive a
 *  fully-attached ELEMENT_NODE container):
 *    1. Create host <div id="hauscope-root">, append to body.
 *    2. Attach an open shadow root on the host.
 *    3. Inject self-hosted @font-face + Tailwind inside the shadow.
 *    4. Create a separate <div> inside the shadow as the React mount
 *       point. createRoot(container) — never createRoot(shadow).
 *
 *  The bar is position:fixed, so the host has no layout height of its
 *  own; we push the page down with a body margin-top managed here (not
 *  in React) so its lifecycle is tied to mount/unmount and the
 *  collapsed state. */
export default defineContentScript({
  matches: ["*://*.rightmove.co.uk/*"],
  runAt: "document_idle",
  // We manage the shadow root ourselves, so opt out of WXT's auto
  // CSS-into-manifest behaviour. The `?inline` import above pulls the
  // Tailwind bundle in as a string for the manual style injection.
  cssInjectionMode: "manual",

  main(ctx) {
    // Re-injection guard. A previous instance already owns the bar —
    // bail out before we touch the DOM or instantiate a second root.
    const w = window as unknown as Record<string, unknown>;
    if (w[SINGLETON_FLAG]) return;
    w[SINGLETON_FLAG] = true;

    let activeListingId: string | null = null;
    let mount: PanelMount | null = null;

    async function mountForListing(listingId: string) {
      mount?.unmount();
      mount = null;
      // Read the persisted dismissed state before mounting so the bar
      // opens in the right state (and the body offset is applied or
      // skipped) without a flash.
      const dismissed = await getDismissed(listingId).catch(() => false);
      // The listing may have changed while we awaited storage.
      if (activeListingId !== listingId) return;
      mount = createPanelMount(listingId, dismissed);
    }

    function checkListing() {
      const listingId = getRightmoveListingId(window.location.href);
      if (listingId && listingId !== activeListingId) {
        activeListingId = listingId;
        void mountForListing(listingId);
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

function createPanelMount(listingId: string, initialCollapsed: boolean): PanelMount {
  // Strip any orphan host left over from a previous mount that didn't
  // clean up (e.g. unhandled exception during render).
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  // Self-hosted @font-face — injected first so Cormorant Garamond +
  // DM Sans are registered before Tailwind's font-family utilities use
  // them. No Google Fonts CDN dependency.
  const fontStyle = document.createElement("style");
  fontStyle.textContent = fontFaceCss();
  shadow.appendChild(fontStyle);

  // Tailwind base/components/utilities — injected as a <style> so it
  // applies only inside the shadow tree (and host-page rules can't
  // leak in to override our hsc- utilities).
  const styleEl = document.createElement("style");
  styleEl.textContent = tailwindCss;
  shadow.appendChild(styleEl);

  // ── Body offset (push the page down beneath the fixed bar) ──
  // Owned here, not in React, so it's bound to mount/unmount and to
  // the collapsed state. Captured once so we can restore the page's
  // original inline margin on tear-down.
  const originalMarginTop = document.body.style.marginTop;
  let offsetApplied = false;

  function syncOffset() {
    if (offsetApplied) document.body.style.marginTop = `${barHeight()}px`;
  }
  function applyBodyOffset() {
    if (offsetApplied) return;
    offsetApplied = true;
    document.body.style.marginTop = `${barHeight()}px`;
    window.addEventListener("resize", syncOffset);
  }
  function clearBodyOffset() {
    if (offsetApplied) {
      offsetApplied = false;
      window.removeEventListener("resize", syncOffset);
    }
    document.body.style.marginTop = originalMarginTop;
  }

  // Collapsed (tab) doesn't push content; expanded (bar) does.
  if (!initialCollapsed) applyBodyOffset();

  // Dedicated React container — React 18 refuses ShadowRoot or body
  // as a createRoot target. The div is appended to the shadow BEFORE
  // createRoot so React sees a fully-attached ELEMENT_NODE.
  const container = document.createElement("div");
  shadow.appendChild(container);

  let root: Root | null = createRoot(container);
  root.render(
    createElement(Panel, {
      listingId,
      initialCollapsed,
      onCollapsedChange: (collapsed: boolean) =>
        collapsed ? clearBodyOffset() : applyBodyOffset(),
    }),
  );

  return {
    unmount() {
      // Unmount can land mid-render if a SPA nav fires before the
      // initial commit. Guard against a double-unmount of the same
      // root (also throws inside React).
      clearBodyOffset();
      if (root) {
        root.unmount();
        root = null;
      }
      host.remove();
    },
  };
}
