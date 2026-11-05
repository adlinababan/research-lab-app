import { readJson, sendError, checkAccess, rateLimit } from "../lib/http.js";
import { buildDocx } from "../lib/docx.js";
import { citationOrder, renumberText } from "../lib/cite.js";
import { ieeeReferenceParts } from "../lib/openalex.js";

const clip = (s, n) => String(s || "").slice(0, n);

export default async function handler(req, res) {
  if (req.method !== "POST") return sendError(res, 405, "Gunakan POST.");
  if (!checkAccess(req, res)) return;
  if (!rateLimit(req, res, { limit: 20 })) return;
  const b = await readJson(req);
  try {
    const papers = (b.papers || []).slice(0, 30);
    const byN = new Map(papers.map((w) => [Number(w.n), w]));
    const sections = (b.sections || []).slice(0, 8).map((s) => ({
      heading: clip(s.heading, 120),
      paragraphs: (s.paragraphs || []).slice(0, 12).map((p) => clip(p, 4000)),
    }));
    const matrixRows = (b.matrix?.rows || []).filter((r) => byN.has(Number(r.n)));
    const { order } = citationOrder(sections, matrixRows);
    // nomor baru berurutan (urutan kemunculan) hanya untuk sitasi yang ada di daftar makalah
    const finalOrder = order.filter((old) => byN.has(old));
    const finalMap = new Map(finalOrder.map((old, i) => [old, i + 1]));

    const paper = {
      lang: b.lang === "id" ? "id" : "en",
      title: clip(b.title, 300),
      authors: (b.authors || []).slice(0, 6).map((a) => ({
        name: clip(a.name, 120), dept: clip(a.prodi || a.dept, 160), org: clip(a.org, 160), city: clip(a.city, 120), email: clip(a.email, 160),
      })),
      abstract: clip(b.abstract, 3000).replace(/\[\d+\]/g, "").replace(/\s{2,}/g, " "),
      keywords: (b.keywords || []).slice(0, 8).map((k) => clip(k, 60)),
      sections: sections.map((s) => ({ heading: s.heading, paragraphs: s.paragraphs.map((p) => renumberText(p, finalMap)) })),
      matrix: matrixRows.length
        ? { aspects: (b.matrix.aspects || []).slice(0, 4).map((a) => clip(a, 40)), rows: matrixRows.map((r) => ({ n: finalMap.get(Number(r.n)), cells: (r.cells || []).slice(0, 4) })).sort((x, y) => x.n - y.n) }
        : null,
      acknowledgment: clip(b.acknowledgment, 2000),
      contributionship: clip(b.contributionship, 3000),
      openData: clip(b.openData, 1500),
      references: finalOrder.map((old) => ieeeReferenceParts(byN.get(old))),
    };
    const buf = buildDocx(paper);
    const safe = (paper.title || "draf-paper").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "draf-paper";
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safe)}.docx"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(buf);
  } catch (e) {
    sendError(res, 500, `Gagal membuat .docx: ${e.message}`);
  }
}
