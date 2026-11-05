// Prompt untuk setiap tahap + pembersih keluaran AI.
// Aturan inti: referensi hanya dari daftar OpenAlex, angka hasil tidak boleh dikarang, data yang belum ada = [placeholder].

const LANG = {
  en: { name: "English", sections: ["Introduction", "Related Work", "Research Method", "Expected Results", "Conclusion"] },
  id: { name: "Bahasa Indonesia", sections: ["Pendahuluan", "Tinjauan Pustaka", "Metode Penelitian", "Hasil yang Diharapkan", "Kesimpulan"] },
};
export const CELL_VALUES = ["Yes", "Partial", "No"];

const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const arr = (a) => (Array.isArray(a) ? a : []);

const BASE_RULES = `You are a research methods mentor helping an Indonesian university lecturer develop their OWN research idea into a paper draft. The lecturer chose the title; never replace it with your own topic.
Hard rules:
- Never invent references, authors, journal names, DOIs, URLs, or statistics.
- Never state numeric results, sample sizes, percentages, or effect sizes that were not given to you. Write a bracketed placeholder instead, e.g. [number of respondents] or [jumlah responden].
- Return ONLY valid JSON matching the requested schema. No markdown, no commentary.`;

// prodi = daftar prodi tim penulis (string atau array). Paper ditulis tim multidisiplin.
const prodiList = (prodi) => (Array.isArray(prodi) ? prodi : String(prodi || "").split(/\s*,\s*/)).map((x) => clip(x, 60)).filter(Boolean).slice(0, 6);
const context = ({ title, aim, prodi }) =>
  `Paper title chosen by the participant: ${clip(title, 300)}
${aim ? `Research aim/question from the participant: ${clip(aim, 600)}\n` : ""}${prodiList(prodi).length ? `Author team disciplines (multidisciplinary team): ${prodiList(prodi).join(", ")}\n` : ""}`;
const paperLine = (w) => `[${w.n}]${w.prodi ? ` (reference lens: ${clip(w.prodi, 40)})` : ""} ${clip(w.title, 250)} (${w.year || "n.d."})`;

// Label sitasi naratif dari data penulis dan tahun OpenAlex: "Lee (2021) [3]", "Lee and Kim (2021) [3]", "Lee et al. (2021) [3]".
const surname = (name) => {
  const parts = String(name || "").replace(/[,.]+$/g, "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
};
export function citeLabel(w) {
  const a = arr(w.authors).map(surname).filter(Boolean);
  const who = a.length === 0 ? "" : a.length === 1 ? a[0] : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a[0]} et al.`;
  const yr = w.year ? ` (${w.year})` : "";
  return who ? `${who}${yr} [${w.n}]` : `[${w.n}]`;
}

// ---------- Langkah 2: kata kunci pencarian dari judul peserta ----------
export function keywordsPrompt({ title, aim, prodi }) {
  const team = prodiList(prodi);
  const many = team.length > 1;
  const user = `${context({ title, aim, prodi })}
Represented disciplines (the ONLY disciplines to use): ${team.join(", ") || "(none given)"}.
Task: suggest literature search queries for the OpenAlex database that will find prior studies closest to this title, grounded ONLY in the represented disciplines above. Do not introduce other disciplines.
- "queries": exactly 3 queries, in English, 3–6 plain words each, no boolean operators, no quotes. ${many
    ? `Each query must sit at the INTERSECTION of the represented disciplines (${team.join(" × ")}): combine the title's topic with concepts or methods from at least two of them.`
    : `Each query must stay within ${team[0] || "the title's field"}.`}
- "perProdi": for EACH represented discipline (and only those), one English query (3–6 plain words) that looks at the title's topic through that discipline's lens${many ? " while still connecting to the other represented disciplines" : ""}.
- "concepts": 3–6 key concepts (short English phrases) the title contains.

JSON schema: {"queries":["string","string","string"],"concepts":["string"],"perProdi":[{"prodi":"string","query":"string"}]}`;
  return { system: BASE_RULES, user };
}

export function cleanKeywords(j, body = {}) {
  const team = prodiList(body.prodi);
  return {
    queries: arr(j.queries).slice(0, 3).map((s) => clip(String(s).replace(/["()]/g, "").replace(/\b(AND|OR|NOT)\b/g, " "), 120)).filter(Boolean),
    concepts: arr(j.concepts).slice(0, 6).map((s) => clip(s, 60)).filter(Boolean),
    perProdi: arr(j.perProdi).slice(0, 6).map((x) => ({ prodi: clip(x?.prodi, 60), query: clip(String(x?.query || "").replace(/["()]/g, "").replace(/\b(AND|OR|NOT)\b/g, " "), 120) }))
      .filter((x) => x.prodi && x.query && (!team.length || team.some((t) => t.toLowerCase() === x.prodi.toLowerCase()))),
  };
}

// ---------- Langkah 3: matriks gap (selalu bahasa Inggris, sitasi nama penulis) ----------
export function gapPrompt({ title, aim, prodi, papers }) {
  const list = arr(papers).slice(0, 15).map((w) =>
    `${paperLine(w)}\nCite as: ${citeLabel(w)}\nAbstract: ${clip(w.abstract, 1200) || "(no abstract available)"}`
  ).join("\n\n");
  const user = `${context({ title, aim, prodi })}
Papers (use ONLY these; refer to them by their number n). Each paper may be labelled with the discipline lens it was collected for:
${list}

Tasks (write EVERYTHING in academic English):
1. Define exactly 4 short column labels ("aspects", max 3 words each). The first 3 aspects must each capture the title's topic from a DIFFERENT discipline of the author team (e.g. "Visual Perception (VCD)", "Export Data (Trade)"), so the matrix shows the multidisciplinary intersection. The 4th must be "Indonesian Context".
2. For EVERY paper listed, fill one row: cells for the 4 aspects, each exactly one of "Yes", "Partial", "No", judged ONLY from the title and abstract text above. Add a one-sentence note in English on what the paper does.
3. Propose 2–3 candidate research gaps that the participant's title could fill, preferably at the intersection of two or more disciplines. Each gap statement must be 1–3 sentences in English and must cite the closest papers narratively using EXACTLY their "Cite as" label (author surname, year in parentheses, then number, e.g. "Although Lee et al. (2021) [3] examined ..., and Putri and Hadi (2023) [5] analysed ..., no study has yet ..."). Use only the labels given above; never invent author names. Also list the cited paper numbers as evidence. Do not change the participant's topic.

JSON schema:
{"aspects":["string","string","string","Indonesian Context"],
 "rows":[{"n":1,"cells":["Yes","No","Partial","No"],"note":"string"}],
 "gaps":[{"statement":"string","evidence":[1,2]}]}`;
  return { system: BASE_RULES, user };
}

export function cleanGap(j, validNs) {
  const ok = new Set(validNs);
  const aspects = arr(j.aspects).slice(0, 4).map((s) => clip(s, 40));
  while (aspects.length < 4) aspects.push(aspects.length === 3 ? "Indonesian Context" : `Aspect ${aspects.length + 1}`);
  const norm = (v) => {
    const s = String(v || "").toLowerCase();
    if (s.startsWith("ya") || s.startsWith("yes")) return "Yes";
    if (s.startsWith("seb") || s.startsWith("part")) return "Partial";
    return "No";
  };
  const rows = arr(j.rows)
    .filter((r) => ok.has(Number(r?.n)))
    .map((r) => ({ n: Number(r.n), cells: [0, 1, 2, 3].map((i) => norm(arr(r.cells)[i])), note: clip(r.note, 300) }));
  const seen = new Set(rows.map((r) => r.n));
  for (const n of validNs) if (!seen.has(n)) rows.push({ n, cells: ["No", "No", "No", "No"], note: "(Not assessed by the AI; check manually.)" });
  rows.sort((a, b) => a.n - b.n);
  const gaps = arr(j.gaps).slice(0, 3).map((g) => ({
    statement: clip(g?.statement, 500),
    evidence: arr(g?.evidence).map(Number).filter((n) => ok.has(n)),
  }));
  return { aspects, rows, gaps };
}

// ---------- Langkah 4a: saran judul dan kata kunci (opsional, peserta yang memutuskan) ----------
export function titlesPrompt({ title, aim, prodi, gap, lang }) {
  const L = LANG[lang] || LANG.en;
  const user = `${context({ title, aim, prodi })}Research gap chosen by the participant: ${clip(gap, 600)}

Task: the participant may refine their initial title so it reflects the chosen gap more precisely. Write in ${L.name}.
- Exactly 3 alternative titles. Each MUST keep the participant's topic, main object/variables and context; only sharpen wording, scope, method or setting so the gap is visible. At most 15 words, no question marks, no subtitle unless essential.
- For each title, one short sentence (in Bahasa Indonesia) explaining what it sharpens compared with the initial title.
- Exactly 5 keywords for the paper (in ${L.name}), lowercase unless proper nouns.

JSON schema: {"titles":[{"title":"string","reason":"string"}],"keywords":["string","string","string","string","string"]}`;
  return { system: BASE_RULES, user };
}

export function cleanTitles(j) {
  return {
    titles: arr(j.titles).slice(0, 3).map((t) => (typeof t === "string" ? { title: clip(t, 220), reason: "" } : { title: clip(t?.title, 220), reason: clip(t?.reason, 300) })).filter((t) => t.title),
    keywords: arr(j.keywords).slice(0, 6).map((s) => clip(s, 60)).filter(Boolean),
  };
}

// ---------- Open Contributionship: saran peran CRediT per penulis ----------
export const CREDIT_ROLES = [
  "conceptualization", "data curation", "formal analysis", "funding acquisition", "investigation", "methodology",
  "project administration", "resources", "software", "supervision", "validation", "visualization",
  "writing—original draft", "writing—review and editing",
];
export function contribPrompt({ title, aim, method, authors, lang }) {
  const L = LANG[lang] || LANG.en;
  const list = arr(authors).slice(0, 6).map((a, i) => `${i + 1}. ${clip(a.name, 80) || `Author ${i + 1}`} — discipline: ${clip(a.prodi, 60) || "unspecified"}`).join("\n");
  const user = `Paper title: ${clip(title, 300)}
${aim ? `Aim: ${clip(aim, 400)}\n` : ""}${method ? `Planned data and method: ${clip(method, 500)}\n` : ""}
Authors:
${list}

Task: propose a SUGGESTED division of contributions (the authors will confirm or edit it), following the CRediT taxonomy.
- For each author, choose 2–4 roles ONLY from this list (exact spelling): ${CREDIT_ROLES.join("; ")}.
- Every CRediT role that is clearly needed for this study should be covered by at least one author. Match roles to each author's discipline.
- For each author also add 1 short specific task (2–5 words, in ${L.name}) tied to this study, e.g. "e-commerce sales analysis".

JSON schema: {"authors":[{"i":1,"roles":["string"],"tasks":["string"]}]}`;
  return { system: BASE_RULES, user };
}
export function cleanContrib(j, body) {
  const n = Math.min(arr(body.authors).length, 6);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const a = arr(j.authors).find((x) => Number(x?.i) === i) || arr(j.authors)[i - 1] || {};
    out.push({
      roles: arr(a.roles).map((r) => String(r).toLowerCase().replace(/\s*[–-]\s*/g, "—").replace("review & editing", "review and editing").trim()).filter((r) => CREDIT_ROLES.includes(r)).slice(0, 5),
      tasks: arr(a.tasks).slice(0, 2).map((t) => clip(t, 80)).filter(Boolean),
    });
  }
  return { authors: out };
}

// ---------- Tahap 4b: draf paper ----------
export function draftPrompt({ title, aim, gap, prodi, lang, papers, matrix, method }) {
  const L = LANG[lang] || LANG.en;
  const list = arr(papers).slice(0, 15).map((w) =>
    `[${w.n}]${w.prodi ? ` (lens: ${clip(w.prodi, 40)})` : ""} Cite as: ${citeLabel(w)}. ${clip(w.title, 250)}. ${clip((w.authors || []).slice(0, 3).join(", "), 120)}${(w.authors || []).length > 3 ? " et al." : ""} (${w.year || "n.d."}), ${clip(w.venue, 120)}.\nAbstract: ${clip(w.abstract, 900) || "(no abstract available — cite only for its title-level topic)"}`
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
- Cite ONLY with IEEE numeric brackets using the numbers above, e.g. [2] or [1], [4]. Never cite a number not in the list.
- When a sentence names the authors of a study, use EXACTLY its "Cite as" label (surname, year, number), e.g. "Lee et al. (2021) [3] found ...". Never write any other author names or years.
- Every statement about prior work must be supported by the cited paper's title or abstract above. Do not overstate what a paper found.
- Try to cite each listed paper at least once, mostly in the first two sections.
- The author team is multidisciplinary: in the Introduction and Related Work, explicitly connect the perspectives of the different disciplines (use the reference lenses) and show why their intersection matters.
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
