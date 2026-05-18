import type { ExtensionSummary } from "../lib/types";

export function SuggestedOffer({ summary }: { summary: ExtensionSummary }) {
  return (
    <div
      className="hsc-rounded-md hsc-p-3"
      style={{ background: "#ffffff", border: "1px solid #e2e0d8" }}
    >
      <p className="hsc-text-[10px] hsc-font-semibold hsc-uppercase hsc-tracking-[0.18em] hsc-text-muted">
        Suggested opening offer
      </p>
      <p className="hsc-mt-1 hsc-font-serif hsc-text-[24px] hsc-leading-tight hsc-text-forest hsc-tabular-nums">
        {summary.suggestedOfferFormatted}
      </p>
    </div>
  );
}
