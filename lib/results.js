import { blueprintText } from "./blueprint.js";
import { standardPromptText } from "../public/standards.js";
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

// Jenis analisis menentukan susunan Hasil dan Pembahasan, aturan, dan pemeriksaan otomatis.
export const PROFILES = {
  ml: {
    name: "Komputasional / machine learning",
    rules: `Organise the results by research question or evaluation scenario: data and setup actually used, the proposed approach against every baseline on the same split, per-class or per-condition behaviour, error analysis, and cost (time, size) if reported. Report mean ± standard deviation when several runs are given. Report honestly when the proposed approach does not win on a metric or when gains are small.`,
    missing: "no baseline, a single run without variance, no statistical test, no per-class metrics, no information on the data split",
  },
  sem: {
    name: "SEM-PLS / CB-SEM (SmartPLS, AMOS, lavaan)",
    rules: `Organise the results as: respondent profile (if given); MEASUREMENT MODEL: indicator outer loadings, internal consistency reliability (Cronbach's alpha, composite reliability rho_a/rho_c), convergent validity (AVE), discriminant validity (HTMT, or Fornell-Larcker and cross-loadings); then STRUCTURAL MODEL: collinearity (inner VIF), path coefficients with t statistics and p values from bootstrapping, hypothesis decisions, R², and f² or Q² if given. Name commonly used thresholds (e.g. loading ≥ 0.70, AVE ≥ 0.50, composite reliability ≥ 0.70, HTMT < 0.90, VIF < 5) as conventions and add the placeholder [add reference] unless a numbered reference states them. Report every value that falls short of a threshold, and say an indicator was removed only if the outputs show a re-estimated model. A hypothesis is "supported" only when its p value or t statistic is in the outputs; state the decision for every hypothesis.`,
    missing: "no bootstrapping p values, no HTMT or Fornell-Larcker, no R²/f², no respondent profile, indicators below thresholds without re-estimation",
  },
  stats: {
    name: "Statistik survei / eksperimen (SPSS, JASP, Jamovi, R)",
    rules: `Organise the results as: respondent or sample profile; instrument validity (item-total correlation or r count versus r table) and reliability (Cronbach's alpha); assumption tests if present (normality, multicollinearity, heteroscedasticity, homogeneity); hypothesis tests (coefficients, t or F, degrees of freedom when given, significance, R² or effect size); then the decision for each hypothesis. Name conventional cut-offs (e.g. alpha ≥ 0.70, significance level 0.05) with [add reference] unless a numbered reference states them. Never claim causality from a correlational design.`,
    missing: "no reliability test, no assumption tests for regression, no effect size, missing degrees of freedom, no respondent profile",
  },
  qual: {
    name: "Kualitatif (wawancara, FGD, NVivo, ATLAS.ti)",
    rules: `Organise the results as: informant profile using anonymised codes only (e.g. I1, I2; never real names), then each main theme with its sub-themes, each supported by one or two short verbatim quotations copied EXACTLY, character for character, from the transcripts given, in double quotation marks followed by the informant code, e.g. "…" (I3). Never alter, translate inside the quotation marks, merge, or invent quotations; if the paper language differs from the transcript, keep the original quotation and add a translation outside the quotation marks. Do not report counts or percentages unless the codebook gives them. Discuss each theme against the numbered references. Address trustworthiness only as far as the outputs or method describe it (e.g. member checking, triangulation).`,
    missing: "transcripts or codebook missing, informant profile missing, no description of the coding process, no trustworthiness procedure",
  },
  mixed: {
    name: "Metode campuran",
    rules: `Report the quantitative strand (profile, validity and reliability, hypothesis or model tests) and the qualitative strand (themes with exact verbatim quotations from the transcripts, informant codes only), then integrate them explicitly: where the qualitative findings explain, confirm, or contradict the quantitative results (a joint display table is welcome if the outputs allow it). Apply the rules of both strands: numbers only from the outputs; quotations copied exactly from the transcripts.`,
    missing: "no integration of strands, transcripts missing, no reliability test, no hypothesis test values",
  },
  dsr: {
    name: "Rekayasa / pengembangan aplikasi (design science)",
    rules: `Organise the results as: the problem and measurable objectives; functional and non-functional requirements and how they were obtained (if given); design artefacts (architecture, use case, ERD, flowchart figures); implementation (technology stack, main modules and database entities from the PROJECT SUMMARY; screenshots as figures that illustrate the interface only); then EVALUATION: functional testing (black-box test cases with passed and failed counts, automated test reports), usability (e.g. System Usability Scale: number of participants, mean score, and its interpretation against a cited benchmark with [add reference]), performance, security, or acceptance results if given; a before–after comparison or a comparison with the existing or an alternative system using the same measures; and discussion of how the artefact addresses the problem compared with the numbered references, stating the type of contribution explicitly (a new artefact, an improved design, or a known solution applied to a new context). Screenshots and feature lists are not evidence of effectiveness; claim improvements only from measured evaluation outputs. Do not describe code you have not been given; use only the project summary.`,
    missing: "no measurable objective, no non-functional requirements, no black-box or automated test results, no usability (SUS) or user evaluation, no before–after or existing-system comparison, no requirement-to-test traceability, no performance or security check",
  },
};
export function profileKey(k) { return PROFILES[k] ? k : "ml"; }

const BASE = `You are an IEEE research-writing mentor. An Indonesian lecturer has ALREADY analysed their own data or built their own system (with Python, SPSS, SmartPLS, NVivo, Excel, or similar) and uploaded the outputs. Your job is to organise those outputs into the paper; you never analyse, recompute, estimate, or invent data.
Hard rules:
- Every number you write must be copied exactly from the uploaded outputs (you may round to fewer decimals, convert a proportion to a percentage, or state the difference between two reported values). Never write a number that is not in the outputs. If a needed value is missing, write a bracketed placeholder such as [p-value] or [nilai p] and list it under "missing".
- Every text in double quotation marks presented as a participant's words must be copied exactly from an uploaded transcript. Never invent or paraphrase inside quotation marks.
- Never invent references, studies, or facts about the literature. Compare only with the numbered references given, and only on what their titles or abstracts state; never quote numbers from those papers unless the abstract gives them.
- Never claim statistical significance unless the outputs contain a statistical test (p-value, confidence interval, or test statistic).
- Never claim absolute novelty. Avoid hype words (novel, groundbreaking, significant step, crucial, paramount, revolutionary).
- Return ONLY valid JSON matching the requested schema. No markdown.`;

function projectText(p) {
  if (!p) return "";
  return `PROJECT SUMMARY (application source folder; code itself not shown):
name: ${clip(p.name, 80)}; files analysed: ${p.files}; test files: ${p.testFiles}
languages: ${arr(p.languages).map((l) => `${clip(l.lang, 30)} (${l.files} files)`).join(", ")}
detected stack: ${arr(p.stack).map((s) => clip(s, 40)).join(", ") || "(unknown)"}
dependencies: ${arr(p.deps).slice(0, 50).map((s) => clip(s, 50)).join(", ")}
database tables: ${arr(p.dbTables).slice(0, 50).map((s) => clip(s, 40)).join(", ") || "(none found)"}
folders: ${arr(p.tree).slice(0, 30).map((s) => clip(s, 80)).join("; ")}`;
}

export function resultsPrompt(b) {
  const L = LANG[b.lang] || LANG.en;
  const id = b.lang === "id";
  const T = (en, idn) => (id ? idn : en);
  const A = APPROACHES[approachKey(b.approach)];
  const P = PROFILES[profileKey(b.profile)];
  const qual = ["qual", "mixed"].includes(profileKey(b.profile));
  const papers = arr(b.papers).slice(0, 30).map((w) => `[${w.n}] Name in text as: ${ieeeLabel(w)}. ${clip(w.title, 200)} (${w.year || "n.d."}). Abstract: ${clip(w.abstract, 350) || "(none)"}`).join("\n");
  const tables = arr(b.tables).slice(0, 25).map((t) => `TABLE FILE id=${t.id} name="${clip(t.name, 140)}" (${arr(t.rows).length} rows):\n${tableText(t)}`).join("\n\n");
  let budget = qual ? 45000 : 16000;
  const texts = arr(b.texts).slice(0, 12).map((t) => {
    const lim = Math.max(0, Math.min(t.kind === "transcript" || qual ? 12000 : 3500, budget));
    budget -= lim;
    return lim ? `TEXT OUTPUT id=${t.id} name="${clip(t.name, 120)}"${t.kind === "code" ? " (source code)" : t.kind === "transcript" ? " (transcript)" : ""}:\n${String(t.text || "").slice(0, lim)}` : "";
  }).filter(Boolean).join("\n\n");
  const figs = arr(b.figures).slice(0, 12).map((f) => `FIGURE id=${f.id} file="${clip(f.name, 140)}" ${f.w}x${f.h}px${f.context ? `; produced by: ${clip(f.context, 300)}` : ""}`).join("\n");
  const raw = arr(b.raw).slice(0, 8).map((r) => `RAW DATA FILE "${clip(r.name, 120)}": ${r.rows} rows; columns: ${arr(r.headers).slice(0, 20).map((h) => clip(h, 40)).join(", ")}`).join("\n");
  const checks = autoChecks(b).checks.map((c) => `- ${c.text}`).join("\n");
  const sec = arr(b.sections);
  const para = (i) => arr(sec[i]?.paragraphs).map((p) => clip(p, 1500)).join("\n");
  const user = `Paper language: ${L.name}. Title: ${clip(b.title, 300)}
${A ? `Research approach: ${A.name}.` : ""}
Type of analysis: ${P.name}.
Research gap: ${clip(b.gap, 600)}

CURRENT INTRODUCTION (objective, research questions or hypotheses, contributions):
${clip(para(0), 3500)}

CURRENT METHOD SECTION:
${clip(para(2), 4000)}

CURRENT ABSTRACT (keep background, gap, and objective close to this; rewrite method, results, and contribution from the outputs):
${clip(b.abstract, 2000)}

Numbered references (the only sources you may cite, IEEE style [n], one number per bracket, names WITHOUT years):
${papers || "(none)"}

=== UPLOADED OUTPUTS FROM THE AUTHORS' OWN WORK ===
${projectText(b.project)}

${tables || "(no table files)"}

${texts || "(no text outputs)"}

${figs || "(no figures)"}
${raw ? `\n${raw}\n(Raw data is described only; do not report it as a results table.)` : ""}
${checks ? `\nAutomatic checks the app ran on these files (facts you may use; do not contradict them):\n${checks}\n` : ""}
How to write the results for this type of analysis:
${P.rules}

${standardPromptText(profileKey(b.profile), "HP")}
${blueprintText(b.blueprint, b.lang) ? `\n${blueprintText(b.blueprint, b.lang)}\nMatch the uploaded outputs to this plan: report the planned items in the planned order using the uploaded tables and figures that correspond to them; for every planned item with no corresponding output, write a bracketed placeholder and add it to "missing" (e.g. "Belum ada output untuk rencana: <caption>").` : ""}
Cover every REQUIRED Results and Discussion item that the outputs support; for a required item the outputs cannot support, write a bracketed placeholder and add it to "missing".

Tasks:
1. "figures": for EVERY figure id, decide "use" (true if it supports the results or method; false for duplicates, debug plots, logos, or irrelevant images), "placement" ("method" for workflow, research design, architecture, use case, ERD, or research model diagrams; otherwise "results"), a concise IEEE caption in ${L.name} without the "Fig. n" prefix (sentence case, describing what is shown and on which data), and "why" (one short sentence in Bahasa Indonesia).
2. "tables": the same for EVERY table file id. Prefer the tables a reviewer expects for this type of analysis; set "use": false for duplicates, raw listings, and configuration dumps that belong in text. Captions in ${L.name}, title case, without the "Table n" prefix.
3. "newTables": optional, at most 3. Only when a TEXT OUTPUT contains tabular results (e.g. a classification report, an SPSS table pasted as text, or a list of test cases), turn it into a table: {"source": text id, "caption", "placement", "headers": [...], "rows": [[...]]}, copying every value exactly. Never build a table from your own numbers.
4. "results": the "${L.sections[3]}" section, 4–7 paragraphs (about 600–1100 words), each {"role","text"} with role from: results, comparison, interpretation, limitation. Follow the structure above. Refer to each used table and figure by its token exactly as {{table:ID}} or {{figure:ID}} (e.g. "${T("as shown in {{table:T1}}", "seperti terlihat pada {{table:T1}}")}"); the app replaces tokens with the correct numbers. Compare with at least two numbered references only under comparable conditions (comparison). Explain why the results occurred and their practical meaning (interpretation). Link each limitation to its effect (limitation).
5. "conclusion": the "${L.sections[4]}" section, 1–2 paragraphs (150–200 words), roles from: answer, contribution, limitation, future. Answer the objective or hypotheses with the main values, contributions within the tested scope, one limitation, one or two next steps. No citations, no quotations, and no numbers that are not already in "results".
6. "abstract": exactly six segments {"role","text"} with roles background, gap, objective, method, results, contribution, forming one paragraph of 150–250 words. The results segment states the main values from the outputs. No citations, no quotations, no table or figure tokens.
7. "missing": up to 6 short items in Bahasa Indonesia naming what an IEEE reviewer would still ask for and is absent from the outputs (for this type of analysis, typically: ${P.missing}).

${A?.results ? `Expected results for this approach: ${A.results}\n` : ""}Write "results", "conclusion", and "abstract" in ${L.name}; translate terms except proper nouns and verbatim quotations. Spell out acronyms at first use.

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
    for (const m of str.matchAll(/(?<![\d])[.,](\d+)/g)) vals.add(Number(`0.${m[1]}`)); // .843 (SPSS)
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
// Termasuk gaya SPSS tanpa nol di depan (.843, -.051).
const numCell = (c) => { const t = String(c ?? "").trim().replace(/%$/, ""); return /^-?\d*[.,]?\d+$/.test(t) && /\d/.test(t) ? Number(t.replace(",", ".").replace(/^(-?)[.]/, "$10.")) : null; };
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
  const { checks, extra } = autoChecks(b);
  const src = [...sourceNumbers(srcTexts), ...extra];
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
  const corpus = quoteCorpus(b);
  const qflag = (ps) => ps.map((p) => unmatchedQuotes(p.text, corpus));
  return {
    heading: { results: L.sections[3], conclusion: L.sections[4] },
    figures, tables, newTables, results, conclusion, abstract,
    missing: arr(j?.missing).slice(0, 6).map((x) => clip(x, 240)).filter(Boolean),
    flags: { results: flag(results), conclusion: flag(conclusion), abstract: flag(abstract) },
    quotes: { results: qflag(results), conclusion: qflag(conclusion), abstract: qflag(abstract) },
    checks, profile: profileKey(b.profile),
  };
}

// ---------- pemeriksaan otomatis atas file (tanpa mengolah data) ----------
// Hanya membandingkan nilai yang sudah dilaporkan dengan ambang yang lazim, atau menghitung baris berstatus
// lulus/gagal. Hasilnya ditampilkan ke dosen dan diberikan ke AI sebagai fakta.
const fmt = (v) => String(Math.round(v * 1000) / 1000).replace(".", ",");
const hdrIdx = (t, re) => arr(t.headers).findIndex((h) => re.test(String(h)));
const rowName = (r) => clip(arr(r)[0], 40);
function numericCells(t) {
  const out = [];
  arr(t.rows).forEach((r) => arr(r).forEach((c, j) => { if (j > 0) { const v = numCell(c); if (v !== null) out.push({ v, row: rowName(r), col: clip(arr(t.headers)[j], 40) }); } }));
  return out;
}
function colValues(t, re) {
  const j = hdrIdx(t, re); if (j < 0) return [];
  return arr(t.rows).map((r) => ({ v: numCell(arr(r)[j]), row: rowName(r) })).filter((x) => x.v !== null);
}
const listShort = (xs) => xs.slice(0, 6).map((x) => `${x.row}${x.col && x.col !== x.row ? ` – ${x.col}` : ""} (${fmt(x.v)})`).join(", ") + (xs.length > 6 ? `, dan ${xs.length - 6} lainnya` : "");
const tname = (t) => String(t.name || "");

export function autoChecks(b) {
  const prof = profileKey(b.profile);
  const tables = arr(b.tables);
  const out = []; const extra = [];
  const add = (status, text) => out.push({ status, text });
  if (prof === "sem" || prof === "stats" || prof === "mixed") {
    const loads = tables.filter((t) => /outer.?loading|factor loading|loading faktor/i.test(tname(t) + " " + arr(t.headers).join(" ")) && !/cross/i.test(tname(t)));
    if (loads.length) {
      // Tabel bootstrapping (Mean, STDEV, T, p) hanya dibaca kolom sampel aslinya.
      const vals = loads.flatMap((t) => (hdrIdx(t, /p.?value|t.?stat|t.?value|stdev|std\b/i) >= 0 ? colValues(t, /original sample|\(o\)|^loading/i) : numericCells(t)));
      const low = vals.filter((x) => x.v > 0 && x.v < 0.7 && Math.abs(x.v) <= 1);
      add(low.length ? "warn" : "ok", low.length ? `${low.length} outer loading di bawah 0,70: ${listShort(low)}. Laporkan, dan sebut indikator dihapus hanya bila ada model yang diestimasi ulang.` : "Semua outer loading ≥ 0,70.");
    }
    const pairs = [[/average variance|\bave\b/i, 0.5, "AVE"], [/composite reliab|rho_?c|rho_?a|\bcr\b/i, 0.7, "Reliabilitas komposit"], [/cronbach/i, 0.7, "Cronbach's alpha"]];
    for (const [re, th, label] of pairs) {
      const vals = tables.flatMap((t) => colValues(t, re));
      if (!vals.length) continue;
      const low = vals.filter((x) => x.v < th);
      add(low.length ? "warn" : "ok", low.length ? `${label} di bawah ${fmt(th)}: ${listShort(low)}.` : `${label} semua ≥ ${fmt(th)} (${vals.length} nilai).`);
    }
    const htmt = tables.filter((t) => /htmt|heterotrait/i.test(tname(t) + " " + arr(t.headers).join(" ")));
    if (htmt.length) {
      const hi = htmt.flatMap(numericCells).filter((x) => x.v >= 0.9 && x.v < 1.5);
      add(hi.length ? "warn" : "ok", hi.length ? `HTMT ≥ 0,90 (validitas diskriminan bermasalah): ${listShort(hi)}.` : "Semua HTMT < 0,90.");
    }
    const vifT = tables.filter((t) => /\bvif\b|collinearity|kolinearitas/i.test(tname(t) + " " + arr(t.headers).join(" ")));
    if (vifT.length) {
      const vals = vifT.flatMap((t) => (hdrIdx(t, /\bvif\b/i) >= 0 ? colValues(t, /\bvif\b/i) : numericCells(t)));
      const hi = vals.filter((x) => x.v >= 5);
      add(hi.length ? "warn" : "ok", hi.length ? `VIF ≥ 5: ${listShort(hi)}.` : `Semua VIF < 5 (${vals.length} nilai).`);
    }
    const pT = tables.filter((t) => hdrIdx(t, /^p.?values?$|^p$|p.?value|^sig\.?|signif/i) >= 0);
    for (const t of pT.slice(0, 4)) {
      const ps = colValues(t, /^p.?values?$|^p$|p.?value|^sig\.?|signif/i).filter((x) => x.v >= 0 && x.v <= 1);
      if (!ps.length) continue;
      const k = ps.filter((x) => x.v < 0.05).length;
      extra.push(ps.length, k, ps.length - k);
      add("info", `${tname(t)}: ${k} dari ${ps.length} baris memiliki p < 0,05${ps.length - k ? `; ${ps.length - k} tidak (≥ 0,05): ${listShort(ps.filter((x) => x.v >= 0.05))}` : ""}.`);
    }
    if (prof === "sem" && !pT.length) add("warn", "Belum ada tabel p value/t statistik hasil bootstrapping; keputusan hipotesis belum bisa ditulis.");
    if (prof === "sem" && !htmt.length && !tables.some((t) => /fornell/i.test(tname(t)))) add("warn", "Belum ada tabel HTMT atau Fornell-Larcker untuk validitas diskriminan.");
  }
  if (prof === "dsr") {
    const p = b.project;
    if (p) add("info", `Proyek ${clip(p.name, 60)}: ${p.files} file; ${arr(p.stack).join(", ") || "stack belum terdeteksi"}; ${arr(p.dbTables).length} tabel basis data; ${p.testFiles} file uji otomatis.${p.secretsSkipped ? ` ${p.secretsSkipped} berkas rahasia (.env, kunci) dilewati dan tidak dibaca.` : ""}`);
    else add("warn", "Folder proyek aplikasi belum diunggah; bagian implementasi hanya dari teks metode.");
    const bb = tables.filter((t) => /black.?box|test.?case|skenario|pengujian|kasus uji|uji fungsional|functional test/i.test(tname(t) + " " + arr(t.headers).join(" ")));
    let pass = 0, fail = 0, n = 0;
    const FAIL = /^(gagal|fail(ed)?|tidak\b.*|error|ditolak|invalid|not\b.*|✗|×|x)$/i, PASS = /^(berhasil|sesuai|pass(ed)?|valid|ok|diterima|success(ful)?|lulus|✓|✔|v)$/i;
    for (const t of bb) {
      // Kolom status = kolom berjudul hasil/status yang isinya paling banyak berupa lulus/gagal.
      let best = null;
      arr(t.headers).forEach((h, j) => {
        if (!/hasil|status|result|kesimpulan|keterangan|conclusion|valid/i.test(String(h))) return;
        const vals = arr(t.rows).map((r) => String(arr(r)[j] || "").trim());
        const k = vals.filter((c) => FAIL.test(c) || PASS.test(c)).length;
        if (k && (!best || k > best.k)) best = { j, k, vals };
      });
      if (!best) continue;
      for (const c of best.vals) { if (FAIL.test(c)) { fail++; n++; } else if (PASS.test(c)) { pass++; n++; } }
    }
    if (n) { extra.push(n, pass, fail); add(fail ? "warn" : "ok", `Pengujian black-box: ${n} skenario, ${pass} berhasil, ${fail} gagal.`); }
    const junit = tables.filter((t) => t.source === "junit");
    if (junit.length) {
      let tt = 0, ff = 0;
      for (const t of junit) for (const r of arr(t.rows)) { tt += numCell(r[1]) || 0; ff += (numCell(r[2]) || 0) + (numCell(r[3]) || 0); }
      extra.push(tt, ff, tt - ff); add(ff ? "warn" : "ok", `Pengujian otomatis: ${tt} test, ${ff} gagal/error.`);
    }
    if (!n && !junit.length) add("warn", "Belum ada hasil pengujian (tabel black-box atau laporan unit test).");
    if (!tables.some((t) => /\bsus\b|usability|kegunaan/i.test(tname(t) + " " + arr(t.headers).join(" ")))) add("info", "Belum ada tabel evaluasi pengguna (mis. SUS). Tanpa itu, klaim kemudahan atau kepuasan tidak didukung.");
    if (!arr(b.figures).length) add("info", "Belum ada screenshot atau diagram rancangan.");
  }
  if (prof === "qual" || prof === "mixed") {
    const tr = arr(b.texts).filter((t) => t.kind === "transcript" || (t.kind === "text" && String(t.text || "").length > 2000));
    add(tr.length ? "ok" : "warn", tr.length ? `${tr.length} transkrip/teks panjang terbaca; setiap kutipan di teks akan dicocokkan kata per kata.` : "Belum ada transkrip (DOCX/TXT). Kutipan informan tidak bisa diverifikasi.");
    if (!tables.some((t) => /code|kode|tema|theme|node|kategori/i.test(tname(t) + " " + arr(t.headers).join(" ")))) add("info", "Belum ada codebook atau daftar tema (ekspor NVivo/ATLAS.ti ke Excel).");
  }
  if (prof === "ml") {
    const metric = tables.filter((t) => hdrIdx(t, /accuracy|akurasi|\bf1|precision|recall|auc|rmse|mae|mape|\bmap\b|bleu|iou|r2|r²/i) >= 0);
    if (metric.length) {
      const maxRows = Math.max(...metric.map((t) => arr(t.rows).length));
      add(maxRows >= 2 ? "ok" : "warn", maxRows >= 2 ? `Tabel metrik memuat ${maxRows} baris (model/konfigurasi).` : "Tabel metrik hanya satu model; reviewer akan meminta perbandingan dengan baseline.");
      const hasStd = tables.some((t) => hdrIdx(t, /std|\bsd\b|±|stdev|ci/i) >= 0) || arr(b.texts).some((t) => /±|std/i.test(t.text || ""));
      add(hasStd ? "ok" : "info", hasStd ? "Ada simpangan baku/variasi antar-run." : "Belum ada simpangan baku dari beberapa run atau uji statistik antar model.");
    } else add("warn", "Belum ada tabel metrik kinerja (accuracy, F1, RMSE, dan sejenisnya).");
  }
  return { checks: out.slice(0, 14), extra };
}

// ---------- kunci kutipan ----------
const normQ = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function quoteCorpus(b) {
  return normQ([...arr(b.texts).map((t) => t.text), ...arr(b.tables).map((t) => arr(t.rows).flat().join(" "))].join(" \n "));
}
// Kutipan (≥ 5 kata) dalam tanda petik yang tidak ditemukan kata per kata di transkrip/tabel.
export function unmatchedQuotes(text, corpus) {
  const bad = [];
  for (const m of String(text || "").matchAll(/[“"]([^”"]{12,900})[”"]/g)) {
    const segs = m[1].split(/\.{3}|…|\[\.\.\.\]/).map(normQ).filter((s) => s.split(" ").length >= 3);
    if (!segs.length || m[1].trim().split(/\s+/).length < 5) continue;
    if (!segs.every((s) => corpus.includes(s))) bad.push(clip(m[1], 90));
  }
  return bad;
}
