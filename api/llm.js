import { readJson, sendJson, sendError, checkAccess, rateLimit, isMock } from "../lib/http.js";
import { askJson, providerInfo } from "../lib/llm.js";
import {
  questionsPrompt, cleanQuestions, gapPrompt, cleanGap,
  titlesPrompt, cleanTitles, draftPrompt, cleanDraft,
} from "../lib/prompts.js";
import { mockLlm } from "../lib/mock.js";

const TASKS = {
  questions: { build: questionsPrompt, clean: (j) => cleanQuestions(j), temperature: 0.7 },
  gap: { build: gapPrompt, clean: (j, b) => cleanGap(j, (b.papers || []).map((w) => Number(w.n))), temperature: 0.2 },
  titles: { build: titlesPrompt, clean: (j) => cleanTitles(j), temperature: 0.7 },
  draft: { build: draftPrompt, clean: (j, b) => cleanDraft(j, (b.papers || []).map((w) => Number(w.n)), b.lang), temperature: 0.4 },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return sendError(res, 405, "Gunakan POST.");
  if (!checkAccess(req, res)) return;
  if (!rateLimit(req, res, { limit: 20 })) return;
  const body = await readJson(req);
  const t = TASKS[body.task];
  if (!t) return sendError(res, 400, "Tugas AI tidak dikenal.");
  if ((body.task === "gap" || body.task === "draft") && !(body.papers || []).length) {
    return sendError(res, 400, "Pilih minimal satu makalah di tahap Literatur terlebih dahulu.");
  }
  try {
    if (isMock()) {
      return sendJson(res, 200, { result: t.clean(mockLlm(body.task, body), body), model: "mode uji", mock: true });
    }
    const { system, user } = t.build(body);
    const { json, model } = await askJson(system, user, { temperature: t.temperature });
    sendJson(res, 200, { result: t.clean(json, body), model, label: providerInfo().label });
  } catch (e) {
    sendError(res, e.status || 500, e.message || "Permintaan ke AI gagal.");
  }
}
