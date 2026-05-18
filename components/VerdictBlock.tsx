import type { ExtensionSummary } from "../lib/types";

const COLOR_BY_LABEL: Record<ExtensionSummary["verdict"]["label"], string> = {
  "significant-above": "#c8963e",
  "marginal-above": "#c8963e",
  "in-range": "#9a9a8e",
  "marginal-below": "#2c4a3e",
  "significant-below": "#2c4a3e",
};

const COPY_BY_LABEL: Record<ExtensionSummary["verdict"]["label"], string> = {
  "significant-above": "above comparable evidence",
  "marginal-above": "above comparable evidence",
  "in-range": "in line with comparable evidence",
  "marginal-below": "below comparable evidence",
  "significant-below": "below comparable evidence",
};

export function VerdictBlock({
  verdict,
}: {
  verdict: ExtensionSummary["verdict"];
}) {
  const color = COLOR_BY_LABEL[verdict.label];
  const copy = COPY_BY_LABEL[verdict.label];
  return (
    <div>
      <p className="hsc-text-[10px] hsc-font-semibold hsc-uppercase hsc-tracking-[0.18em] hsc-text-muted">
        Verdict
      </p>
      <p
        className="hsc-mt-1.5 hsc-font-serif hsc-text-[32px] hsc-leading-tight"
        style={{ color }}
      >
        {verdict.gapFormatted}
      </p>
      <p className="hsc-mt-1 hsc-text-[13px] hsc-leading-snug hsc-text-ink">
        {copy}
      </p>
    </div>
  );
}
