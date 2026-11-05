import { readJson, sendJson, sendError, checkAccess, rateLimit, isMock, userKeys } from "../lib/http.js";
import { askJson } from "../lib/llm.js";
import { keywordsPrompt, cleanKeywords, gapPrompt, cleanGap, titlesPrompt, cleanTitles, draftPrompt, cleanDraft } from "../lib/prompts.js";
import { mockLlm } from "../lib/mock.js";

const TASKS = {
  keywords: { build: keywordsPrompt, clean: (j) => cleanKeywords(j), temperature: 0.3, maxTokens: 800 },
  gap: { build: gapPrompt, clean: (j, b) => cleanGap(j, (b.papers || []).map((w) => Number(w.n))), temperature: 0.2, maxTokens: 4000 },
  titles: { build: titlesPrompt, clean: (j) => cleanTitles(j), temperature: 0.6, maxTokens: 1200 },
  draft: { build: draftPrompt, clean: (j, b) => cleanDraft(j, (b.papers || []).map((w) => Number(w.n)), b.lang), temperature: 0.4, maxTokens: 9000 },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return sendError(res, 405, "Gunakan POST.");
  if (!checkAccess(req, res)) return;
  if (!rateLimit(req, res, { limit: 120 })) return;
  const body = await readJson(req);
  const t = TASKS[body.task];
  if (!t) return sendError(res, 400, "Tugas AI tidak dikenal.");
  if (!String(body.title || "").trim()) return sendError(res, 400, "Judul penelitian belum diisi di langkah 1.");
  if ((body.task === "gap" || body.task === "draft") && !(body.papers || []).length) {
    return sendError(res, 400, "Pilih minimal satu makalah di langkah Literatur terlebih dahulu.");
  }
  try {
    if (isMock()) {
      return sendJson(res, 200, { result: t.clean(mockLlm(body.task, body), body), model: "mode uji", label: "Mode uji", mock: true });
    }
    const { system, user } = t.build(body);
    const picked = String(req.headers["x-ai-model"] || "").slice(0, 80);
    const { json, model, label } = await askJson(system, user, { temperature: t.temperature, maxTokens: t.maxTokens, userKey: userKeys(req).ai, model: picked });
    sendJson(res, 200, { result: t.clean(json, body), model, label });
  } catch (e) {
    sendError(res, e.status || 500, e.message || "Permintaan ke AI gagal.", e.code ? { code: e.code } : {});
  }
}
