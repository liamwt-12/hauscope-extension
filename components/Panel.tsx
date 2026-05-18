import { useEffect, useState } from "react";
import { extractRightmoveListing } from "../lib/extractors/rightmove";
import type {
  AnalyseMessage,
  AnalyseResponse,
  ExtensionSummary,
} from "../lib/types";
import { LoadingState } from "./LoadingState";
import { VerdictBlock } from "./VerdictBlock";
import { SuggestedOffer } from "./SuggestedOffer";

type Phase = "loading" | "success" | "error";

const LOG = "[hauscope]";

const PANEL_POSITION: React.CSSProperties = {
  position: "fixed",
  top: 80,
  right: 0,
  width: 380,
  zIndex: 999999,
};

const CHIP_POSITION: React.CSSProperties = {
  position: "fixed",
  top: 80,
  right: 0,
  zIndex: 999999,
};

/** Top-level panel rendered inside the content-script shadow DOM.
 *  Owns the lifecycle for one listing — re-mounted by the content
 *  script when the SPA-navigation observer detects a listing change. */
export function Panel({ listingId }: { listingId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<ExtensionSummary | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setPhase("loading");
      setData(null);
      try {
        const extracted = await extractRightmoveListing();
        if (cancelled) return;
        if (!extracted) {
          console.warn(LOG, "Panel: extraction returned null → error state");
          setPhase("error");
          return;
        }
        console.log(LOG, "Panel: sending ANALYSE message", extracted);
        const message: AnalyseMessage = { type: "ANALYSE", payload: extracted };
        const response = (await chrome.runtime.sendMessage(message)) as
          | AnalyseResponse
          | undefined;
        if (cancelled) return;
        console.log(LOG, "Panel: ANALYSE response", response);
        if (response?.ok) {
          setData(response.data);
          setPhase("success");
        } else {
          console.warn(
            LOG,
            "Panel: API returned error:",
            response?.error ?? "(no error string)",
          );
          setPhase("error");
        }
      } catch (err) {
        console.error(LOG, "Panel: exception during extract/sendMessage:", err);
        if (!cancelled) setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [listingId]);

  // ─── Collapsed chip ─────────────────────────────────────────────────
  if (collapsed && data) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        style={CHIP_POSITION}
        className="hsc-cursor-pointer hsc-rounded-l-md hsc-bg-cream hsc-px-3 hsc-py-2 hsc-font-sans hsc-text-[13px] hsc-text-ink hsc-shadow-md hover:hsc-bg-white"
      >
        Hauscope&nbsp;
        <span className="hsc-font-medium hsc-tabular-nums">
          {data.verdict.gapFormatted}
        </span>
      </button>
    );
  }

  // ─── Expanded panel ────────────────────────────────────────────────
  return (
    <div
      style={PANEL_POSITION}
      className="hsc-rounded-l-md hsc-bg-cream hsc-p-5 hsc-font-sans hsc-text-ink hsc-shadow-xl"
    >
      <div
        className="hsc-absolute hsc-left-0 hsc-top-0 hsc-bottom-0"
        style={{ width: 3, background: "#2c4a3e" }}
      />
      {phase === "loading" && <LoadingState />}
      {phase === "error" && (
        <p className="hsc-text-[13px] hsc-text-muted">
          Couldn’t analyse this property.
        </p>
      )}
      {phase === "success" && data && (
        <div className="hsc-flex hsc-flex-col hsc-gap-4">
          <VerdictBlock verdict={data.verdict} />
          <SuggestedOffer summary={data} />
          <div className="hsc-grid hsc-grid-cols-3 hsc-gap-2">
            <Stat label="Comparables" value={String(data.comparablesCount)} />
            <Stat
              label="Days listed"
              value={
                data.daysOnMarket != null && data.daysOnMarket > 0
                  ? String(data.daysOnMarket)
                  : "—"
              }
            />
            <Stat label="Confidence" value={data.verdict.confidence} />
          </div>
          <div className="hsc-flex hsc-items-center hsc-justify-between hsc-pt-1">
            <a
              href={data.reportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hsc-text-[13px] hsc-font-medium hsc-text-forest hover:hsc-underline"
            >
              See full report →
            </a>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="hsc-text-[11px] hsc-uppercase hsc-tracking-[0.06em] hsc-text-muted hover:hsc-text-ink"
            >
              Collapse ↑
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="hsc-text-[10px] hsc-font-semibold hsc-uppercase hsc-tracking-[0.06em] hsc-text-muted">
        {label}
      </div>
      <div className="hsc-mt-0.5 hsc-text-[13px] hsc-text-ink hsc-tabular-nums">
        {value}
      </div>
    </div>
  );
}
