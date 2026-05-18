/** Mirrors the response shape from /api/extension/analyse on the main
 *  Hauscope codebase. Keep this in sync if the server contract changes. */

export type Source = "rightmove" | "zoopla";

export type VerdictLabel =
  | "significant-above"
  | "marginal-above"
  | "in-range"
  | "marginal-below"
  | "significant-below";

export type Confidence = "High" | "Medium" | "Low";

export type AnalyseRequest = {
  source: Source;
  listingId: string;
  url: string;
  price: number;
  address: string;
  postcode: string;
  bedrooms: number;
  propertyType: string;
  listingDate?: string;
  agent?: { name: string; branchName: string };
};

export type ExtensionSummary = {
  reportId: string;
  reportUrl: string;
  verdict: {
    gap: number;
    gapFormatted: string;
    label: VerdictLabel;
    askingPrice: number;
    fairValue: number;
    confidence: Confidence;
  };
  suggestedOffer: number;
  suggestedOfferFormatted: string;
  comparablesCount: number;
  daysOnMarket: number | null;
  source: Source;
};

/** Messages exchanged between content script and background. */
export type AnalyseMessage = { type: "ANALYSE"; payload: AnalyseRequest };
export type AnalyseResponse =
  | { ok: true; data: ExtensionSummary }
  | { ok: false; error: string };
