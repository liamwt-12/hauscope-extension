import type { AnalyseRequest, ExtensionSummary } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "https://hauscope.com").replace(/\/$/, "");
const API_KEY = import.meta.env.VITE_EXTENSION_API_KEY ?? "";

/** POST a listing payload to the Hauscope main app and return the
 *  summarised extension response. Throws on non-2xx; the caller wraps
 *  this in the messaging boundary so failures surface as the panel's
 *  quiet error state rather than a runtime exception. */
export async function analyseListing(req: AnalyseRequest): Promise<ExtensionSummary> {
  if (!API_KEY) {
    throw new Error("VITE_EXTENSION_API_KEY not set at build time");
  }
  const resp = await fetch(`${API_BASE}/api/extension/analyse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hauscope-extension-key": API_KEY,
    },
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`API ${resp.status}: ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as ExtensionSummary;
}
