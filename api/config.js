import { sendJson, isMock } from "../lib/http.js";
import { providerInfo, OPENROUTER_MODELS } from "../lib/llm.js";

export default async function handler(req, res) {
  const p = providerInfo();
  sendJson(res, 200, {
    mock: isMock(),
    accessRequired: Boolean((process.env.ACCESS_CODE || "").trim()),
    // configured = server punya key AI sendiri (mis. OPENROUTER_API_KEY). Bila tidak, peserta wajib menempelkan key.
    llm: { label: p.label, model: p.model, configured: isMock() || p.configured },
    byok: true,
    openrouterModels: OPENROUTER_MODELS,
    openalexKey: Boolean((process.env.OPENALEX_API_KEY || "").trim()),
    eventName: process.env.EVENT_NAME || "AI-Assisted Research: Dari Ide hingga Publikasi",
  });
}
