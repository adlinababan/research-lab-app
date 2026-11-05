// Prompt untuk setiap tahap + pembersih keluaran AI.
// Aturan inti: referensi hanya dari daftar OpenAlex, angka hasil tidak boleh dikarang, data yang belum ada = [placeholder].

const LANG = {
  en: { name: "English", sections: ["Introduction", "Related Work", "Research Method", "Expected Results", "Conclusion"] },
  id: { name: "Bahasa Indonesia", sections: ["Pendahuluan", "Tinjauan Pustaka", "Metode Penelitian", "Hasil yang Diharapkan", "Kesimpulan"] },
};
export const CELL_VALUES = ["Ya", "Sebagian", "Belum"];

const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const arr = (a) => (Array.isArray(a) ? a : []);

const BASE_RULES = `You are a research methods mentor helping an Indonesian university lecturer develop their OWN research idea into a paper draft. The lecturer chose the title; never replace it with your own topic.
Hard rules:
- Never invent references, authors, journal names, DOIs, URLs, or statistics.
- Never state numeric results, sample sizes, percentages, or effect sizes that were not given to you. Write a bracketed placeholder instead, e.g. [number of respondents] or [jumlah responden].
- Return ONLY valid JSON matching the requested schema. No markdown, no commentary.`;

const context = ({ title, aim, prodi }) =>
  `Paper title chosen by the participant: ${clip(title, 300)}
${aim ? `Research aim/question from the participant: ${clip(aim, 600)}\n` : ""}${prodi ? `Participant's field (prodi): ${clip(prodi, 80)}\n` : ""}`;

// ---------- Langkah 2: kata kunci pencarian dari judul peserta ----------
export function keywordsPrompt({ title, aim, prodi }) {
  const user = `${context({ title, aim, prodi })}
Task: suggest literature search queries for the OpenAlex database that will find prior studies closest to this title.
- Exactly 3 queries, in English, 3–6 plain words each, no boolean operators, no quotes.
- Query 1: the core topic as a whole. Query 2: the main variable/object plus the method or technology. Query 3: the topic in a broader or regional context.
- Also list 3–6 key concepts (short English phrases) the title contains.

JSON schema: {"queries":["string","string","string"],"concepts":["string"]}`;
  return { system: BASE_RULES, user };
}

export function cleanKeywords(j) {
  return {
    queries: arr(j.queries).slice(0, 3).map((s) => clip(String(s).replace(/["()]/g, "").replace(/\b(AND|OR|NOT)\b/g, " "), 120)).filter(Boolean),
    concepts: arr(j.concepts).slice(0, 6).map((s) => clip(s, 60)).filter(Boolean),
  };
}

// ---------- Langkah 3: matriks gap ----------
export function gapPrompt({ title, aim, prodi, papers }) {
  const list = arr(papers).slice(0, 15).map((w) =>
    `[${w.n}] ${clip(w.title, 250)} (${w.year || "n.d."})\nAbstract: ${clip(w.abstract, 1200) || "(no abstract available)"}`
  ).join("\n\n");
  const user = `${context({ title, aim, prodi })}
Papers (use ONLY these; refer to them by their number n):
${list}

Tasks (write in Bahasa Indonesia):
1. Define exactly 4 short column labels ("aspects", max 3 words each) taken from the participant's title: the main object or variable, the method/approach, the outcome or focus, and the 4th must be "Konteks Indonesia".
2. For EVERY paper listed, fill one row: cells for the 4 aspects, each exactly one of "Ya", "Sebagian", "Belum", judged ONLY from the title and abstract text above. Add a one-sentence note on what the paper does.
3. Propose 2–3 candidate research gaps that the participant's title could fill: combinations of aspects that no listed paper fully covers. For each, list the paper numbers that come closest as evidence. Do not change the participant's topic.

JSON schema:
{"aspects":["string","string","string","Konteks Indonesia"],
 "rows":[{"n":1,"cells":["Ya","Belum","Sebagian","Belum"],"note":"string"}],
 "gaps":[{"statement":"string","evidence":[1,2]}]}`;
  return { system: BASE_RULES, user };
}

export function cleanGap(j, validNs) {
  const ok = new Set(validNs);
  const aspects = arr(j.aspects).slice(0, 4).map((s) => clip(s, 40));
  while (aspects.length < 4) aspects.push(aspects.length === 3 ? "Konteks Indonesia" : `Aspek ${aspects.length + 1}`);
  const norm = (v) => {
    const s = String(v || "").toLowerCase();
    if (s.startsWith("ya") || s === "yes") return "Ya";
    if (s.startsWith("seb") || s.startsWith("part")) return "Sebagian";
    return "Belum";
  };
  const rows = arr(j.rows)
    .filter((r) => ok.has(Number(r?.n)))
    .map((r) => ({ n: Number(r.n), cells: [0, 1, 2, 3].map((i) => norm(arr(r.cells)[i])), note: clip(r.note, 300) }));
  const seen = new Set(rows.map((r) => r.n));
  for (const n of validNs) if (!seen.has(n)) rows.push({ n, cells: ["Belum", "Belum", "Belum", "Belum"], note: "(AI tidak menilai makalah ini; periksa manual)" });
  rows.sort((a, b) => a.n - b.n);
  const gaps = arr(j.gaps).slice(0, 3).map((g) => ({
    statement: clip(g?.statement, 500),
    evidence: arr(g?.evidence).map(Number).filter((n) => ok.has(n)),
  }));
  return { aspects, rows, gaps };
}

// ---------- Tahap 4b: draf paper ----------
export function draftPrompt({ title, aim, gap, prodi, lang, papers, matrix, method }) {
  const L = LANG[lang] || LANG.en;
  const list = arr(papers).slice(0, 15).map((w) =>
    `[${w.n}] ${clip(w.title, 250)}. ${clip((w.authors || []).slice(0, 3).join(", "), 120)}${(w.authors || []).length > 3 ? " et al." : ""} (${w.year || "n.d."}), ${clip(w.venue, 120)}.\nAbstract: ${clip(w.abstract, 900) || "(no abstract available — cite only for its title-level topic)"}`
  ).join("\n\n");
  const matrixText = matrix && arr(matrix.rows).length
    ? `Gap matrix (aspects: ${arr(matrix.aspects).join(" | ")}):\n` + arr(matrix.rows).map((r) => `[${r.n}] ${arr(r.cells).join(" | ")}`).join("\n")
    : "";
  const user = `${context({ title, aim, prodi })}Research gap chosen by the participant: ${clip(gap, 600)}
${method ? `Planned data and method (from the participant): ${clip(method, 600)}` : ""}

Numbered reference list (the ONLY sources you may cite):
${list}

${matrixText}

Write a draft conference paper in ${L.name}, IEEE style, about 1300–1800 words in total, for exactly the title above (do not change the topic).
Citation rules:
- Cite ONLY with IEEE numeric brackets using the numbers above, e.g. [2] or [1], [4]. Never cite a number not in the list. Never mention author names unless they appear above.
- Every statement about prior work must be supported by the cited paper's title or abstract above. Do not overstate what a paper found.
- Try to cite each listed paper at least once, mostly in the first two sections.
Data rules:
- This is a research plan draft: there are NO results yet. Do not invent any numbers, sample sizes, p-values, accuracies, or percentages.
- Wherever specific data, numbers, locations, dates, or findings are needed, write a short bracketed placeholder in ${L.name} describing what must be filled in, e.g. [${lang === "id" ? "jumlah responden" : "number of respondents"}], [${lang === "id" ? "hasil uji statistik" : "statistical test result"}].
Structure:
- "abstract": 150–200 words covering background, gap, objective, method, expected results (placeholders), contribution.
- "keywords": 4–6 keywords for this title.
- "sections": exactly these headings in order: ${L.sections.map((s) => `"${s}"`).join(", ")}. Each section has 2–5 paragraphs. No sub-headings, no bullet lists, no tables, no figure references.

JSON schema: {"abstract":"string","keywords":["string"],"sections":[{"heading":"string","paragraphs":["string"]}]}`;
  return { system: BASE_RULES, user };
}

// Membersihkan sitasi: hanya nomor yang ada di daftar yang dipertahankan; [1,2] -> [1], [2].
export function sanitizeCitations(text, validNs) {
  const ok = new Set(validNs);
  return String(text || "").replace(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, (m, inner) => {
    const nums = [];
    for (const part of inner.split(/\s*,\s*/)) {
      const range = part.split(/\s*[–-]\s*/).map(Number);
      if (range.length === 2 && range[1] >= range[0] && range[1] - range[0] < 20) {
        for (let k = range[0]; k <= range[1]; k++) nums.push(k);
      } else nums.push(Number(range[0]));
    }
    const keep = [...new Set(nums.filter((n) => ok.has(n)))];
    return keep.length ? keep.map((n) => `[${n}]`).join(", ") : "\u0000";
  })
    // rapikan sisa tanda baca setelah sitasi tidak sah dihapus
    .replace(/(,\s*)?\u0000(\s*,)?/g, (m, a, b) => (a && b ? "," : ""))
    .replace(/\(\s*(?:see|lihat|e\.g\.,?|misalnya)?\s*\)/gi, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/,([.;:])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/ {2,}/g, " ")
    .trim();
}

export function cleanDraft(j, validNs, lang) {
  const L = LANG[lang] || LANG.en;
  const byHeading = arr(j.sections);
  const sections = L.sections.map((h, i) => {
    const s = byHeading.find((x) => clip(x?.heading, 80).toLowerCase() === h.toLowerCase()) || byHeading[i] || {};
    return { heading: h, paragraphs: arr(s.paragraphs).slice(0, 6).map((p) => sanitizeCitations(clip(p, 2500), validNs)).filter(Boolean) };
  });
  return {
    abstract: sanitizeCitations(clip(j.abstract, 2000), validNs).replace(/\s*\[\d+\](,\s*\[\d+\])*/g, ""),
    keywords: arr(j.keywords).slice(0, 6).map((s) => clip(s, 60)),
    sections,
  };
}

export { LANG };
