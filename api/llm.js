import { readJson, sendJson, sendError, checkAccess, rateLimit, isMock, userKeys } from "../lib/http.js";
import { askJson } from "../lib/llm.js";
import { keywordsPrompt, cleanKeywords, gapPrompt, cleanGap, titlesPrompt, cleanTitles, draftPrompt, cleanDraft, contribPrompt, cleanContrib, methodPrompt, cleanMethod, reviewPrompt, cleanReview } from "../lib/prompts.js";
import { mockLlm } from "../lib/mock.js";
import { resultsPrompt, cleanResults } from "../lib/results.js";

const TASKS = {
  keywords: { build: keywordsPrompt, clean: (j, b) => cleanKeywords(j, b), temperature: 0.3, maxTokens: 800 },
  gap: { build: gapPrompt, clean: (j, b) => cleanGap(j, (b.papers || []).map((w) => Number(w.n))), temperature: 0.2, maxTokens: 6000 },
  titles: { build: titlesPrompt, clean: (j) => cleanTitles(j), temperature: 0.6, maxTokens: 1200 },
  review: { build: reviewPrompt, clean: (j, b) => cleanReview(j, b), temperature: 0.2, maxTokens: 4500 },
  method: { build: methodPrompt, clean: (j, b) => cleanMethod(j, b), temperature: 0.5, maxTokens: 1800 },
  contrib: { build: contribPrompt, clean: (j, b) => cleanContrib(j, b), temperature: 0.3, maxTokens: 1500 },
  results: { build: resultsPrompt, clean: (j, b) => cleanResults(j, b), temperature: 0.2, maxTokens: 8000 },
  draft: { build: draftPrompt, clean: (j, b) => cleanDraft(j, (b.papers || []).map((w) => Number(w.n)), b.lang), temperature: 0.4, maxTokens: 12000 },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return sendError(res, 405, "Gunakan POST.");
  if (!checkAccess(req, res)) return;
  if (!rateLimit(req, res, { limit: 120 })) return;
  const body = await readJson(req);
  const t = TASKS[body.task];
  if (!t) return sendError(res, 400, "Tugas AI tidak dikenal.");
  if (!String(body.title || "").trim()) return sendError(res, 400, "Judul penelitian belum diisi di langkah 1.");
  if (body.task === "review" && !(body.sections || []).length) return sendError(res, 400, "Susun draf terlebih dahulu sebelum direview.");
  if (body.task === "results" && !(body.sections || []).length) return sendError(res, 400, "Susun draf terlebih dahulu, lalu unggah hasil analisis.");
  if (body.task === "results" && !(body.tables || []).length && !(body.texts || []).length && !(body.figures || []).length && !body.project) return sendError(res, 400, "Belum ada tabel, output teks, atau gambar yang terbaca dari file Anda.");
  if ((body.task === "gap" || body.task === "draft") && !(body.papers || []).length) {
    return sendError(res, 400, "Pilih minimal satu makalah di langkah Literatur terlebih dahulu.");
  }
  try {
    // Prompt dikembalikan ke peserta untuk pembelajaran (tidak memuat API key atau data rahasia).
    const { system, user } = t.build(body);
    if (isMock()) {
      return sendJson(res, 200, { result: t.clean(mockLlm(body.task, body), body), model: "mode uji", label: "Mode uji", mock: true, prompt: { system, user } });
    }
    const opts = { temperature: t.temperature, maxTokens: t.maxTokens, userKey: userKeys(req).ai, model: body.model };
    try {
      const { json, model, label } = await askJson(system, user, opts);
      return sendJson(res, 200, { result: t.clean(json, body), model, label, prompt: { system, user } });
    } catch (e) {
      // Draf panjang yang terpotong, rusak, atau terlalu lama: coba sekali lagi dengan versi ringkas.
      if (!["draft", "review", "results"].includes(body.task) || !["truncated", "badjson", "timeout"].includes(e.code)) throw e;
      if (body.task === "review" || body.task === "results") {
        // Review: cukup coba sekali lagi dengan ruang token lebih besar.
        const { json, model, label } = await askJson(system, user, { ...opts, maxTokens: body.task === "results" ? 12000 : 6000 });
        return sendJson(res, 200, { result: t.clean(json, body), model, label, prompt: { system, user } });
      }
      const small = t.build({ ...body, compact: true });
      const { json, model, label } = await askJson(small.system, small.user, { ...opts, maxTokens: 9000 });
      return sendJson(res, 200, { result: t.clean(json, body), model, label, compact: true, prompt: { system: small.system, user: small.user } });
    }
  } catch (e) {
    sendError(res, e.status || 500, e.message || "Permintaan ke AI gagal.", e.code ? { code: e.code } : {});
  }
}
