// Tugas AI "sync": setelah hasil analisis milik dosen diterapkan, usulkan pembaruan bagian yang masih berisi
// versi rencana: Judul, Kata kunci, Pendahuluan, dan Metode (termasuk penyimpangan dari Rencana Hasil yang
// dikunci). Setiap angka di usulan harus berasal dari file hasil atau teks draf; yang tidak ditemukan ditandai.
import { LANG, ROLE_SETS, sanitizeCitations } from "./prompts.js";
import { sourceNumbers, unmatchedNumbers, diffsOf, tableGroups } from "./results.js";

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const arr = (a) => (Array.isArray(a) ? a : []);
const roleOf = (key, r) => (ROLE_SETS[key].includes(String(r || "").toLowerCase().trim()) ? String(r).toLowerCase().trim() : "");

export function syncPrompt(b) {
  const L = LANG[b.lang] || LANG.en;
  const sec = arr(b.sections);
  const S = (i) => arr(sec[i]?.paragraphs).map((p, k) => `(${k + 1}) ${clip(p, 1800)}`).join("\n");
  const tables = arr(b.tables).slice(0, 20).map((t) => `${clip(t.name, 100)}: ${[arr(t.headers).join(" | "), ...arr(t.rows).slice(0, 25).map((r) => arr(r).join(" | "))].join(" / ")}`).join("\n");
  const texts = arr(b.texts).slice(0, 8).map((t) => `${clip(t.name, 100)}: ${String(t.text || "").slice(0, 1500)}`).join("\n");
  const raw = arr(b.raw).map((r) => `${clip(r.name, 100)}: ${r.rows} rows`).join("; ");
  const system = `You are an IEEE paper editor. The authors have finished their own analysis, and the Results, Conclusion, and Abstract already report their real outputs. Other parts of the paper were written at the planning stage and may no longer match. Propose minimal, precise updates so the whole paper is consistent with the actual results.
Hard rules:
- Every number you write must come from the authors' outputs or the current paper text. Never invent sample sizes, dates, versions, or results; if a needed fact is not available, keep or write a bracketed placeholder.
- Keep paragraphs that are still correct unchanged, word for word. Change only what is inconsistent with the results, outdated, or missing.
- Keep every citation number [n] exactly as it is; never add new citations.
- Claims of contribution must not exceed what the results show. Do not claim significance without a test.
- Return ONLY valid JSON matching the schema. No markdown.`;
  const user = `Paper language: ${L.name}.
CURRENT TITLE: ${clip(b.title, 300)}
CURRENT KEYWORDS: ${clip(b.keywords, 300)}

CURRENT ${L.sections[0].toUpperCase()} (paragraphs):
${S(0)}

CURRENT ${L.sections[2].toUpperCase()} (paragraphs):
${S(2)}

UPDATED ${L.sections[3].toUpperCase()} (already reflects the real results):
${S(3)}

UPDATED ${L.sections[4].toUpperCase()}:
${S(4)}

UPDATED ABSTRACT: ${clip(b.abstract, 2000)}

AUTHORS' OUTPUTS (facts you may use for the Method):
${tables || "(no tables)"}
${texts ? `\n${texts}` : ""}
${raw ? `\nRaw data files: ${raw}` : ""}
${b.project ? `\nApplication project: ${clip(b.project.name, 60)}; ${b.project.files} files; stack: ${arr(b.project.stack).join(", ")}; languages: ${arr(b.project.languages).map((l) => l.lang).join(", ")}; database tables: ${arr(b.project.dbTables).length}` : ""}

${b.execFacts ? `EXECUTION FACTS recorded by the authors during data collection (use them in the ${L.sections[2]} section):\n${clip(b.execFacts, 3000)}\n\n` : ""}${b.deviations?.length ? `DEVIATIONS FROM THE LOCKED RESULTS PLAN (must be disclosed transparently in the ${L.sections[2]} section, in one short paragraph with role "procedure" or "evaluation", naming each deviation and why it may matter; analyses outside the plan are called additional or exploratory):\n${arr(b.deviations).map((d) => `- ${clip(d, 300)}`).join("\n")}` : "No deviations from the results plan were recorded."}

Tasks:
1. "title": {"change": true|false, "proposed": "string", "reason": "Bahasa Indonesia"}. Change only if the current title promises something the results do not show (e.g. "improves" when the gain was not supported) or names a method no longer used.
2. "keywords": {"change": true|false, "proposed": "comma-separated, 3–6 terms, alphabetical", "reason": "..."}.
3. "intro": {"change": true|false, "summary": "what changed and why (Bahasa Indonesia)", "paragraphs": [{"role","text"}]} with roles from ${ROLE_SETS.intro.join(", ")}. Keep context, problem, and gap paragraphs unless wrong; align the objective, research questions or hypotheses, and contribution statements with what the results actually show.
4. "method": the same shape with roles from ${ROLE_SETS.method.join(", ")}. Replace planning placeholders with actual facts from the outputs (number of respondents, records, or test cases; period; tools and versions; split; procedures), keep the remaining placeholders for facts not available, and disclose deviations as instructed.
5. "issues": up to 6 remaining inconsistencies across the whole paper that the authors must fix themselves (Bahasa Indonesia): {"where", "issue", "suggestion"}.
Write all paper text in ${L.name}. If a part needs no change, set "change": false and return its paragraphs unchanged.

JSON schema: {"title":{"change":false,"proposed":"string","reason":"string"},"keywords":{"change":false,"proposed":"string","reason":"string"},"intro":{"change":true,"summary":"string","paragraphs":[{"role":"context","text":"string"}]},"method":{"change":true,"summary":"string","paragraphs":[{"role":"design","text":"string"}]},"issues":[{"where":"string","issue":"string","suggestion":"string"}]}`;
  return { system, user };
}

export function cleanSync(j, b) {
  const validNs = arr(b.papers).map((w) => Number(w.n));
  const srcTexts = [
    ...arr(b.tables).map((t) => [arr(t.headers).join(" "), ...arr(t.rows).map((r) => arr(r).join(" "))].join(" ")),
    ...arr(b.texts).map((t) => t.text), ...arr(b.raw).map((r) => String(r.rows)),
    ...arr(b.sections).flatMap((s) => arr(s.paragraphs)), b.abstract, b.title,
    b.project ? `${b.project.files} ${arr(b.project.dbTables).length} ${b.project.testFiles}` : "",
    arr(b.deviations).join(" "), String(arr(b.deviations).length), String(b.execFacts || ""),
  ];
  const src = sourceNumbers(srcTexts);
  const diffs = diffsOf(tableGroups(arr(b.tables)));
  const part = (x, key, idx) => {
    const cur = arr(b.sections[idx]?.paragraphs);
    const ps = arr(x?.paragraphs).slice(0, 10).map((p) => (typeof p === "string" ? { role: "", text: p } : p))
      .map((p) => ({ role: roleOf(key, p?.role), text: sanitizeCitations(String(p?.text || "").replace(/\s+/g, " ").trim().slice(0, 3000), validNs) }))
      .filter((p) => p.text);
    const change = x?.change !== false && ps.length > 0 && ps.map((p) => p.text).join("\n") !== cur.join("\n");
    return { change, summary: clip(x?.summary, 500), paragraphs: change ? ps : [], flags: change ? ps.map((p) => unmatchedNumbers(p.text, src, diffs)) : [] };
  };
  const one = (x, cur, max) => {
    const proposed = clip(x?.proposed, max);
    return { change: !!x?.change && !!proposed && proposed !== String(cur || "").trim(), proposed, reason: clip(x?.reason, 400) };
  };
  return {
    title: one(j?.title, b.title, 300),
    keywords: one(j?.keywords, b.keywords, 300),
    intro: part(j?.intro, "intro", 0),
    method: part(j?.method, "method", 2),
    issues: arr(j?.issues).slice(0, 6).map((x) => ({ where: clip(x?.where, 80), issue: clip(x?.issue, 400), suggestion: clip(x?.suggestion, 400) })).filter((x) => x.issue),
  };
}
