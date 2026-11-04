import { sendJson, isMock } from "../lib/http.js";
import { providerInfo } from "../lib/llm.js";

export default async function handler(req, res) {
  const p = providerInfo();
  sendJson(res, 200, {
    mock: isMock(),
    accessRequired: Boolean((process.env.ACCESS_CODE || "").trim()),
    llm: { label: p.label, model: p.model, configured: isMock() || p.configured },
    openalexKey: Boolean((process.env.OPENALEX_API_KEY || "").trim()),
    eventName: process.env.EVENT_NAME || "AI-Assisted Research: Dari Ide hingga Publikasi",
  });
}
