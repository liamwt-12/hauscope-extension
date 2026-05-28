import { useCallback, useEffect, useState } from "react";
import { extractRightmoveListing } from "../lib/extractors/rightmove";
import { setDismissed } from "../lib/cache";
import type {
  AnalyseMessage,
  AnalyseResponse,
  ExtensionSummary,
} from "../lib/types";

type Phase = "loading" | "success" | "error";

type PanelProps = {
  listingId: string;
  initialCollapsed: boolean;
  /** Notifies the content script so it can push the page down (bar) or
   *  release it (collapsed tab). Not called for the initial state —
   *  the content script already set the offset from the same flag. */
  onCollapsedChange: (collapsed: boolean) => void;
};

// Verdict tone on the dark bar. Forest (#2c4a3e) would vanish against
// ink, so positive uses mint; amber and muted both read cleanly on dark.
const VERDICT_TONE: Record<
  ExtensionSummary["verdict"]["label"],
  { color: string; copy: string }
> = {
  "significant-above": { color: "#c8963e", copy: "above evidence" },
  "marginal-above": { color: "#c8963e", copy: "above evidence" },
  "in-range": { color: "#9a9a8e", copy: "in line" },
  "marginal-below": { color: "#b6e3c6", copy: "below evidence" },
  "significant-below": { color: "#b6e3c6", copy: "below evidence" },
};

const BAR =
  "hsc-fixed hsc-top-0 hsc-left-0 hsc-right-0 hsc-z-[999999] hsc-flex hsc-h-14 hsc-items-center hsc-gap-4 hsc-border-b hsc-border-cream/10 hsc-bg-ink hsc-px-4 hsc-font-sans hsc-text-cream max-[699px]:hsc-h-10 max-[699px]:hsc-gap-3 max-[699px]:hsc-px-3";

/** Top-level bar rendered inside the content-script shadow DOM. Owns
 *  the lifecycle for one listing — re-mounted by the content script
 *  when the SPA-navigation observer detects a listing change. */
export function Panel({ listingId, initialCollapsed, onCollapsedChange }: PanelProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<ExtensionSummary | null>(null);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setPhase("loading");
      setData(null);
      try {
        const extracted = await extractRightmoveListing();
        if (cancelled) return;
        if (!extracted) {
          setPhase("error");
          return;
        }
        const message: AnalyseMessage = { type: "ANALYSE", payload: extracted };
        const response = (await chrome.runtime.sendMessage(message)) as
          | AnalyseResponse
          | undefined;
        if (cancelled) return;
        if (response?.ok) {
          setData(response.data);
          setPhase("success");
        } else {
          setPhase("error");
        }
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [listingId, retryToken]);

  const updateCollapsed = useCallback(
    (next: boolean) => {
      setCollapsed(next);
      onCollapsedChange(next);
      void setDismissed(listingId, next);
    },
    [listingId, onCollapsedChange],
  );

  // ─── Collapsed tab ──────────────────────────────────────────────────
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => updateCollapsed(false)}
        aria-label="Show Hauscope"
        className="hsc-fixed hsc-top-0 hsc-right-0 hsc-z-[999999] hsc-flex hsc-h-9 hsc-w-9 hsc-items-center hsc-justify-center hsc-rounded-bl-lg hsc-bg-ink hsc-text-cream hsc-shadow-lg hover:hsc-bg-ink/90"
      >
        <HMark className="hsc-h-4 hsc-w-4" />
      </button>
    );
  }

  // ─── Loading ────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className={`${BAR} hsc-relative`}>
        <div className="hsc-flex hsc-w-full hsc-items-center hsc-justify-center hsc-gap-2 hsc-animate-pulse">
          <HMark className="hsc-h-4 hsc-w-4 hsc-text-cream" />
          <span className="hsc-text-[11px] hsc-font-medium hsc-uppercase hsc-tracking-[0.18em] hsc-text-cream/80">
            Hauscope · Analysing…
          </span>
        </div>
        <div
          className="hsc-absolute hsc-bottom-0 hsc-inset-x-0 hsc-h-[2px] hsc-animate-shimmer"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #b6e3c6 50%, transparent 100%)",
            backgroundSize: "200% 100%",
          }}
        />
      </div>
    );
  }

  // ─── Error ──────────────────────────────────────────────────────────
  if (phase === "error" || !data) {
    return (
      <div className={BAR}>
        <Brand />
        <Divider />
        <span className="hsc-text-[11px] hsc-uppercase hsc-tracking-[0.12em] hsc-text-cream/70">
          Couldn’t analyse this listing
        </span>
        <button
          type="button"
          onClick={() => setRetryToken((n) => n + 1)}
          className="hsc-text-[11px] hsc-font-medium hsc-text-mint hover:hsc-underline"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={() => updateCollapsed(true)}
          aria-label="Dismiss"
          className="hsc-ml-auto hsc-flex hsc-h-6 hsc-w-6 hsc-items-center hsc-justify-center hsc-rounded-full hsc-text-cream/60 hover:hsc-bg-cream/10 hover:hsc-text-cream"
        >
          ×
        </button>
      </div>
    );
  }

  // ─── Success ────────────────────────────────────────────────────────
  const tone = VERDICT_TONE[data.verdict.label];
  return (
    <div className={BAR}>
      <Brand />
      <Divider />

      <div className="hsc-flex hsc-items-baseline hsc-gap-2">
        <span
          className="hsc-font-serif hsc-text-[22px] hsc-leading-none hsc-tabular-nums"
          style={{ color: tone.color }}
        >
          {data.verdict.gapFormatted}
        </span>
        <span className="hsc-text-[10px] hsc-uppercase hsc-tracking-[0.12em] hsc-text-cream/60 max-[699px]:hsc-hidden">
          {tone.copy}
        </span>
      </div>

      <Divider className="max-[899px]:hsc-hidden" />
      <span className="hsc-whitespace-nowrap hsc-text-[13px] hsc-font-medium hsc-text-cream max-[899px]:hsc-hidden">
        Offer {data.suggestedOfferFormatted}
      </span>

      <Divider className="max-[899px]:hsc-hidden" />
      <span className="hsc-whitespace-nowrap hsc-text-[11px] hsc-text-cream/50 max-[899px]:hsc-hidden">
        {statsLine(data)}
      </span>

      <div className="hsc-ml-auto hsc-flex hsc-items-center hsc-gap-2">
        <a
          href={data.reportUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hsc-whitespace-nowrap hsc-rounded-full hsc-bg-forest hsc-px-3 hsc-py-1 hsc-text-[11px] hsc-font-medium hsc-text-cream hover:hsc-bg-forest/90"
        >
          See full report →
        </a>
        <button
          type="button"
          onClick={() => updateCollapsed(true)}
          aria-label="Dismiss"
          className="hsc-flex hsc-h-6 hsc-w-6 hsc-items-center hsc-justify-center hsc-rounded-full hsc-text-cream/60 hover:hsc-bg-cream/10 hover:hsc-text-cream"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function statsLine(data: ExtensionSummary): string {
  const parts = [`${data.comparablesCount} comps`];
  if (data.daysOnMarket != null && data.daysOnMarket > 0) {
    parts.push(`${data.daysOnMarket} days`);
  }
  parts.push(`${data.verdict.confidence} confidence`);
  return parts.join(" · ");
}

function Brand() {
  return (
    <div className="hsc-flex hsc-items-center hsc-gap-2">
      <HMark className="hsc-h-4 hsc-w-4 hsc-text-cream" />
      <span className="hsc-text-[11px] hsc-font-semibold hsc-uppercase hsc-tracking-[0.18em] hsc-text-cream max-[699px]:hsc-hidden">
        Hauscope
      </span>
    </div>
  );
}

function Divider({ className }: { className?: string }) {
  return (
    <div
      className={`hsc-h-6 hsc-w-px hsc-bg-cream/15 max-[699px]:hsc-h-5 ${className ?? ""}`}
    />
  );
}

function HMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="Hauscope"
      fill="currentColor"
    >
      <path d="M4 3H9V9H15V3H20V21H15V14H9V21H4Z" />
    </svg>
  );
}
