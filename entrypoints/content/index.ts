import { defineContentScript } from "wxt/sandbox";
import { createShadowRootUi } from "wxt/client";
import ReactDOM from "react-dom/client";
import { createElement } from "react";
import { Panel } from "../../components/Panel";
import { getRightmoveListingId } from "../../lib/extractors/rightmove";
import "./style.css";

const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=DM+Sans:wght@400;500;600&display=swap";

/** Content script — runs on every rightmove.co.uk URL, mounts the
 *  Hauscope panel inside a shadow DOM when the current page is a
 *  property detail (/properties/<id>), and re-mounts whenever the
 *  listingId in the URL changes (Rightmove is a soft-nav SPA). */
export default defineContentScript({
  matches: ["*://*.rightmove.co.uk/*"],
  runAt: "document_idle",
  cssInjectionMode: "ui",

  async main(ctx) {
    let activeListingId: string | null = null;
    let ui: Awaited<ReturnType<typeof createShadowRootUi>> | null = null;

    async function mountForListing(listingId: string) {
      // Tear down any previous UI before mounting a new one — leaving
      // an orphaned shadow root would double-render the panel after a
      // soft-nav between listings.
      ui?.remove();

      const newUi = await createShadowRootUi(ctx, {
        name: "hauscope-extension-panel",
        position: "overlay",
        anchor: "body",
        append: "last",
        onMount(container, shadow) {
          // Pull Cormorant Garamond + DM Sans inside the shadow root so
          // host-page font rules can't shadow them.
          const link = (shadow.host.ownerDocument ?? document).createElement(
            "link",
          );
          link.rel = "stylesheet";
          link.href = GOOGLE_FONTS_HREF;
          shadow.appendChild(link);

          const root = ReactDOM.createRoot(container);
          root.render(createElement(Panel, { listingId }));
          return root;
        },
        onRemove(root) {
          root?.unmount();
        },
      });
      newUi.mount();
      ui = newUi;
    }

    function checkListing() {
      const listingId = getRightmoveListingId(window.location.href);
      if (listingId && listingId !== activeListingId) {
        activeListingId = listingId;
        void mountForListing(listingId);
        return;
      }
      if (!listingId && ui) {
        ui.remove();
        ui = null;
        activeListingId = null;
      }
    }

    // Initial mount on first paint.
    checkListing();

    // ─── SPA navigation observer ────────────────────────────────────
    //
    // Rightmove uses client-side routing; the URL changes but no full
    // navigation fires. We watch DOM mutations as a cheap proxy for
    // "something happened" and re-read location.href on each tick.
    // Cheaper than polling and the only signal that always fires on
    // both pushState and replaceState transitions.
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        checkListing();
      }
    });
    observer.observe(document, { subtree: true, childList: true });

    // Also catch pop-state (back/forward) which doesn't always emit a
    // DOM mutation.
    window.addEventListener("popstate", checkListing);
  },
});
