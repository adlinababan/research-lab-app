// Tugas AI "results": dari hasil analisis milik dosen (tabel, output teks, nama gambar) menyarankan
// gambar dan tabel, lalu menulis Hasil dan Pembahasan, Kesimpulan, dan Abstrak.
// Prinsip: Research Lab tidak mengolah data. Setiap angka di teks AI wajib berasal dari file dosen;
// angka yang tidak ditemukan ditandai (flags) untuk diperiksa manusia.
import { ieeeLabel, ROLE_SETS, sanitizeCitations, LANG, APPROACHES, approachKey } from "./prompts.js";

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const arr = (a) => (Array.isArray(a) ? a : []);
const roleOf = (key, r) => (ROLE_SETS[key].includes(String(r || "").toLowerCase().trim()) ? String(r).toLowerCase().trim() : "");

const MAX_ROWS = 40, MAX_COLS = 12;
const cell = (c) => clip(c, 60);
function tableText(t) {
  const head = arr(t.headers).slice(0, MAX_COLS).map(cell);
  const rows = arr(t.rows).slice(0, MAX_ROWS).map((r) => arr(r).slice(0, MAX_COLS).map(cell));
  return [head.join(" | "), ...rows.map((r) => r.join(" | "))].join("\n") + (arr(t.rows).length > MAX_ROWS ? `\n(… ${arr(t.rows).length - MAX_ROWS} more rows not shown)` : "");
}

const BASE = `You are an IEEE research-writing mentor. An Indonesian lecturer has ALREADY analysed their own data (in Python, SPSS, Excel, or similar) and uploaded the outputs. Your job is to organise those outputs into the paper; you never analyse, recompute, estimate, or invent data.
Hard rules:
- Every number you write must be copied exactly from the uploaded outputs (you may round to fewer decimals, convert a proportion to a percentage, or state the difference between two reported values). Never write a number that is not in the outputs. If a needed value is missing, write a bracketed placeholder such as [p-value] or [nilai p] and list it under "missing".
- Never invent references, studies, or facts about the literature. Compare only with the numbered references given, and only on what their titles or abstracts state; never quote numbers from those papers unless the abstract gives them.
- Never claim statistical significance unless the outputs contain a statistical test (p-value, confidence interval, or test statistic). Report honestly when the proposed method does not win on a metric or when gains are small.
- Never claim absolute novelty. Avoid hype words (novel, groundbreaking, significant step, crucial, paramount, revolutionary).
- Return ONLY valid JSON matching the requested schema. No markdown.`;

export function resultsPrompt(b) {
  const L = LANG[b.lang] || LANG.en;
  const id = b.lang === "id";
  const T = (en, idn) => (id ? idn : en);
  const A = APPROACHES[approachKey(b.approach)];
  const papers = arr(b.papers).slice(0, 30).map((w) => `[${w.n}] Name in text as: ${ieeeLabel(w)}. ${clip(w.title, 200)} (${w.year || "n.d."}). Abstract: ${clip(w.abstract, 350) || "(none)"}`).join("\n");
  const tables = arr(b.tables).slice(0, 15).map((t) => `TABLE FILE id=${t.id} name="${clip(t.name, 120)}" (${arr(t.rows).length} rows):\n${tableText(t)}`).join("\n\n");
  const texts = arr(b.texts).slice(0, 10).map((t) => `TEXT OUTPUT id=${t.id} name="${clip(t.name, 120)}"${t.kind === "code" ? " (source code)" : ""}:\n${String(t.text || "").slice(0, 3500)}`).join("\n\n");
  const figs = arr(b.figures).slice(0, 12).map((f) => `FIGURE id=${f.id} file="${clip(f.name, 120)}" ${f.w}x${f.h}px${f.context ? `; produced by: ${clip(f.context, 300)}` : ""}`).join("\n");
  const raw = arr(b.raw).slice(0, 8).map((r) => `RAW DATA FILE "${clip(r.name, 120)}": ${r.rows} rows; columns: ${arr(r.headers).slice(0, 20).map((h) => clip(h, 40)).join(", ")}`).join("\n");
  const sec = arr(b.sections);
  const para = (i) => arr(sec[i]?.paragraphs).map((p) => clip(p, 1500)).join("\n");
  const user = `Paper language: ${L.name}. Title: ${clip(b.title, 300)}
${A ? `Research approach: ${A.name}.` : ""}
Research gap: ${clip(b.gap, 600)}

CURRENT INTRODUCTION (objective, research questions, contributions):
${clip(para(0), 3500)}

CURRENT METHOD SECTION:
${clip(para(2), 4000)}

CURRENT ABSTRACT (keep background, gap, and objective close to this; rewrite method, results, and contribution from the outputs):
${clip(b.abstract, 2000)}

Numbered references (the only sources you may cite, IEEE style [n], one number per bracket, names WITHOUT years):
${papers || "(none)"}

=== UPLOADED OUTPUTS FROM THE AUTHORS' OWN ANALYSIS ===
${tables || "(no table files)"}

${texts || "(no text outputs)"}

${figs || "(no figures)"}
${raw ? `\n${raw}\n(Raw data is described only; do not report it as a results table.)` : ""}

Tasks:
1. "figures": for EVERY figure id, decide "use" (true if it supports the results or method; false for duplicates, debug plots, or irrelevant images), "placement" ("method" for workflow, architecture, or setup diagrams; otherwise "results"), a concise IEEE caption in ${L.name} without the "Fig. n" prefix (sentence case, describing what is shown and on which data), and "why" (one short sentence in Bahasa Indonesia).
2. "tables": the same for EVERY table file id. Captions in ${L.name}, title case, without the "Table n" prefix.
3. "newTables": optional, at most 3. Only when a TEXT OUTPUT contains tabular results (e.g. a scikit-learn classification_report or a model comparison printed as text), turn it into a table: {"source": text id, "caption", "placement", "headers": [...], "rows": [[...]]}, copying every value exactly. Never build a table from your own numbers.
4. "results": the "${L.sections[3]}" section, 4–6 paragraphs (about 600–1000 words), each {"role","text"} with role from: results, comparison, interpretation, limitation. Organise by research question or scenario; start with the data analysed; report the key values for the proposed approach and every baseline; refer to each used table and figure by its token exactly as {{table:ID}} or {{figure:ID}} (e.g. "${T("as shown in {{table:T1}}", "seperti terlihat pada {{table:T1}}")}"); the app replaces tokens with the correct numbers. Compare with at least two numbered references only under comparable conditions (comparison). Explain why the results occurred and their practical meaning (interpretation). Link each limitation to its effect (limitation).
5. "conclusion": the "${L.sections[4]}" section, 1–2 paragraphs (150–200 words), roles from: answer, contribution, limitation, future. Answer the objective with the main values, contributions within the tested scope, one limitation, one or two next steps. No citations and no numbers that are not already in "results".
6. "abstract": exactly six segments {"role","text"} with roles background, gap, objective, method, results, contribution, forming one paragraph of 150–250 words. The results segment states the main values from the outputs. No citations, no table or figure tokens.
7. "missing": up to 6 short items in Bahasa Indonesia naming what an IEEE reviewer would still ask for and is absent from the outputs (e.g. no baseline, a single run without variance, no statistical test, no per-class metrics, no information on the data split).

${A?.results ? `Expected results for this approach: ${A.results}\n` : ""}Write "results", "conclusion", and "abstract" in ${L.name}; translate terms except proper nouns. Spell out acronyms at first use.

JSON schema: {"figures":[{"id":"F1","use":true,"placement":"results","caption":"string","why":"string"}],"tables":[{"id":"T1","use":true,"placement":"results","caption":"string","why":"string"}],"newTables":[{"source":"X1","caption":"string","placement":"results","headers":["string"],"rows":[["string"]]}],"results":[{"role":"results","text":"string"}],"conclusion":[{"role":"answer","text":"string"}],"abstract":[{"role":"background","text":"string"}],"missing":["string"]}`;
  return { system: BASE, user };
}

// ---------- kunci angka ----------
const NUM_RE = /(?<![\w.,])\d+(?:[.,]\d+)*(?:%)?/g;
// Satu token angka dapat dibaca sebagai format Inggris (1,234.5) atau Indonesia (1.234,5).
function readings(tok) {
  const s = tok.replace(/%$/, "");
  const out = new Set();
  const decOf = (x) => (x.includes(".") ? x.split(".").pop().length : 0);
  const add = (str) => { const v = Number(str); if (Number.isFinite(v)) out.add(JSON.stringify([v, decOf(str)])); };
  if (/^\d+$/.test(s)) add(s);
  else {
    add(s.replace(/,/g, "")); // 1,234.5
    add(s.replace(/\./g, "").replace(",", ".")); // 1.234,5
    if (/^\d+,\d+$/.test(s)) add(s.replace(",", ".")); // 0,897
    if (/^\d+\.\d+$/.test(s)) add(s); // 0.897
  }
  return [...out].map((x) => JSON.parse(x));
}
export function sourceNumbers(texts) {
  const vals = new Set();
  for (const t of texts) {
    const str = String(t || "");
    for (const m of str.matchAll(NUM_RE)) for (const [v] of readings(m[0])) vals.add(v);
    // CSV/teks: "0.91,0.89" juga dibaca sebagai dua angka terpisah.
    for (const m of str.matchAll(/\d+(?:\.\d+)?/g)) vals.add(Number(m[0]));
    for (const m of str.matchAll(/\d+(?:,\d+)?/g)) vals.add(Number(m[0].replace(",", ".")));
  }
  const plain = String(texts.join(" ")).match(/\d+\.\d+e-?\d+/gi) || [];
  for (const x of plain) { const v = Number(x); if (Number.isFinite(v)) vals.add(v); }
  return [...vals];
}
function matches(v, dec, src, diffs) {
  const tol = 0.5 * 10 ** -dec + 1e-9;
  const near = (s) => Math.abs(v - s) <= tol || Math.abs(v - s * 100) <= tol || Math.abs(v - s / 100) <= tol;
  return src.some(near) || diffs.some(near);
}
// Mengembalikan daftar token angka di `text` yang tidak ada di sumber.
export function unmatchedNumbers(text, src, diffs) {
  const t = String(text || "")
    .replace(/\{\{(?:table|figure):[^}]+\}\}/g, " ")
    .replace(/\[\d+\]/g, " ")
    .replace(/\b(?:RQ|H|Fig\.?|Gambar|Table|Tabel)\s*\d+\b/gi, " ");
  const bad = [];
  for (const m of t.matchAll(NUM_RE)) {
    const tok = m[0];
    const rs = readings(tok);
    if (rs.some(([v, d]) => d === 0 && Number.isInteger(v) && v <= 12)) continue; // hitungan kecil: tiga baseline, 5-fold
    if (rs.some(([v, d]) => d === 0 && v >= 1900 && v <= 2100)) continue; // tahun
    if (!rs.some(([v, d]) => matches(v, d, src, diffs))) bad.push(tok);
  }
  return [...new Set(bad)];
}
// Selisih yang sah hanya antarnilai dalam satu kolom (mis. F1 usulan vs baseline) atau satu baris tabel.
const numCell = (c) => { const t = String(c ?? "").trim().replace(/%$/, ""); return /^-?\d+(?:[.,]\d+)?$/.test(t) ? Number(t.replace(",", ".")) : null; };
export function diffsOf(groups) {
  const out = new Set();
  for (const g of groups) {
    const s = g.filter((v) => v !== null && Math.abs(v) < 1e6).slice(0, 60);
    for (let i = 0; i < s.length; i++) for (let k = i + 1; k < s.length; k++) out.add(Math.abs(s[i] - s[k]));
  }
  return [...out];
}
export function tableGroups(tables) {
  const groups = [];
  for (const t of tables) {
    const grid = arr(t.rows).map((r) => arr(r).map(numCell));
    grid.forEach((r) => groups.push(r));
    const cols = Math.max(0, ...grid.map((r) => r.length));
    for (let c = 0; c < cols; c++) groups.push(grid.map((r) => r[c] ?? null));
  }
  return groups;
}

export function cleanResults(j, b) {
  const L = LANG[b.lang] || LANG.en;
  const figIds = new Set(arr(b.figures).map((f) => f.id));
  const tabIds = new Set(arr(b.tables).map((t) => t.id));
  const textIds = new Set(arr(b.texts).map((t) => t.id));
  const validNs = arr(b.papers).map((w) => Number(w.n));
  const place = (p) => (String(p || "").toLowerCase() === "method" ? "method" : "results");
  const pick = (list, ids, fallbackPrefix) => {
    const got = new Map(arr(list).filter((x) => ids.has(String(x?.id))).map((x) => [String(x.id), x]));
    return [...ids].map((id) => {
      const x = got.get(id) || {};
      return { id, use: x.use !== false && got.has(id), placement: place(x.placement), caption: clip(x.caption, 220) || "", why: clip(x.why, 240) };
    });
  };
  const figures = pick(j?.figures, figIds);
  const tables = pick(j?.tables, tabIds);

  // Sumber angka: semua tabel dan output teks milik dosen + teks metode/draf (mis. 5-fold, 80/20) + tahun referensi.
  const srcTexts = [
    ...arr(b.tables).map((t) => [arr(t.headers).join(" "), ...arr(t.rows).map((r) => arr(r).join(" "))].join(" ")),
    ...arr(b.texts).map((t) => t.text),
    ...arr(b.raw).map((r) => `${r.rows} ${arr(r.headers).join(" ")}`),
    ...arr(b.sections).slice(2, 3).flatMap((s) => arr(s.paragraphs)),
  ];
  const src = sourceNumbers(srcTexts);
  const diffs = diffsOf(tableGroups(arr(b.tables)));

  const newTables = arr(j?.newTables).filter((t) => textIds.has(String(t?.source))).slice(0, 3).map((t, i) => {
    const headers = arr(t.headers).slice(0, MAX_COLS).map((h) => clip(h, 60));
    const rows = arr(t.rows).slice(0, MAX_ROWS).map((r) => arr(r).slice(0, headers.length || MAX_COLS).map((c) => clip(c, 60)));
    const srcText = arr(b.texts).find((x) => x.id === String(t.source))?.text || "";
    const own = sourceNumbers([srcText]);
    const flags = unmatchedNumbers(rows.flat().join(" "), own, []);
    return { id: `N${i + 1}`, source: String(t.source), use: flags.length === 0, placement: place(t.placement), caption: clip(t.caption, 220), headers, rows, flags };
  }).filter((t) => t.headers.length && t.rows.length);

  const okIds = new Set([...figIds, ...tabIds, ...newTables.map((t) => t.id)]);
  const tok = (s) => String(s).replace(/\{\{\s*(table|figure)\s*:\s*([A-Za-z0-9_-]+)\s*\}\}/g, (m, k, id) => (okIds.has(id) ? `{{${k}:${id}}}` : ""));
  const paras = (list, key, n, maxLen) => arr(list).slice(0, n).map((p) => (typeof p === "string" ? { role: "", text: p } : p))
    .map((p) => ({ role: roleOf(key, p?.role), text: sanitizeCitations(tok(String(p?.text || "").replace(/\s+/g, " ").trim().slice(0, maxLen)), validNs) }))
    .filter((p) => p.text);
  const results = paras(j?.results, "results", 8, 3000);
  const conclusion = paras(j?.conclusion, "conclusion", 3, 1800).map((p) => ({ ...p, text: p.text.replace(/\s*\[\d+\](,\s*\[\d+\])*/g, "") }));
  const abstract = paras(j?.abstract, "abstract", 8, 1200).map((p) => ({ ...p, text: p.text.replace(/\s*\[\d+\](,\s*\[\d+\])*/g, "").replace(/\{\{[^}]+\}\}/g, "").replace(/\s{2,}/g, " ") }));
  const flag = (ps) => ps.map((p) => unmatchedNumbers(p.text, src, diffs));
  return {
    heading: { results: L.sections[3], conclusion: L.sections[4] },
    figures, tables, newTables, results, conclusion, abstract,
    missing: arr(j?.missing).slice(0, 6).map((x) => clip(x, 240)).filter(Boolean),
    flags: { results: flag(results), conclusion: flag(conclusion), abstract: flag(abstract) },
  };
}
