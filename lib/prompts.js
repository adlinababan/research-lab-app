// Prompt untuk setiap tahap + pembersih keluaran AI.
// Aturan inti: referensi hanya dari daftar OpenAlex, angka hasil tidak boleh dikarang, data yang belum ada = [placeholder].

const LANG = {
  en: { name: "English", sections: ["Introduction", "Related Work", "Research Method", "Results and Discussion", "Conclusion"] },
  id: { name: "Bahasa Indonesia", sections: ["Pendahuluan", "Tinjauan Pustaka", "Metode Penelitian", "Hasil dan Pembahasan", "Kesimpulan"] },
};
export const CELL_VALUES = ["Yes", "Partial", "No"];

const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const arr = (a) => (Array.isArray(a) ? a : []);

const BASE_RULES = `You are a research methods mentor helping an Indonesian university lecturer develop their OWN research idea into a paper draft. The lecturer chose the title; never replace it with your own topic.
Hard rules:
- Never invent references, authors, journal names, DOIs, URLs, or statistics.
- Never state numeric results, sample sizes, percentages, or effect sizes that were not given to you. Write a bracketed placeholder instead, e.g. [number of respondents] or [jumlah responden].
- Never claim absolute novelty ("no study has ever", "first ever"). Frame gaps relative to the reviewed studies, e.g. "among the reviewed studies" or "to the best of our knowledge".
- Academic, concise style. Avoid hype and filler words such as unprecedented, paramount, crucial, critical, novel, groundbreaking, significant step, plays a vital role, in today's digital era.
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
  const b = a.map(fixNameCaps);
  const who = b.length === 0 ? "" : b.length === 1 ? b[0] : b.length === 2 ? `${b[0]} and ${b[1]}` : `${b[0]} et al.`;
  const yr = w.year ? ` (${w.year})` : "";
  return who ? `${who}${yr} [${w.n}]` : `[${w.n}]`;
}

// Gaya IEEE di badan paper: nama penulis tanpa tahun, mis. "Lee et al. [3]".
export function ieeeLabel(w) {
  const a = arr(w.authors).map(surname).filter(Boolean).map(fixNameCaps);
  const who = a.length === 0 ? "" : a.length === 1 ? a[0] : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a[0]} et al.`;
  return who ? `${who} [${w.n}]` : `[${w.n}]`;
}
// Metadata OpenAlex kadang huruf kapital semua ("LIU"): rapikan agar sesuai gaya IEEE.
export const fixNameCaps = (n) => String(n || "").replace(/\b([A-Z])([A-Z]{2,})\b/g, (m, a, b) => a + b.toLowerCase());

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
- "noveltyQuery": one extra NARROW English query (2–4 words) combining the title's most specific object or setting with its core method (e.g. "ulos motif classification"), used to check whether the exact idea already exists.
- "perProdi": for EACH represented discipline (and only those), one English query (3–6 plain words) that looks at the title's topic through that discipline's lens${many ? " while still connecting to the other represented disciplines" : ""}.
- "concepts": 3–6 key concepts (short English phrases) the title contains.

JSON schema: {"queries":["string","string","string"],"noveltyQuery":"string","concepts":["string"],"perProdi":[{"prodi":"string","query":"string"}]}`;
  return { system: BASE_RULES, user };
}

export function cleanKeywords(j, body = {}) {
  const team = prodiList(body.prodi);
  const q = (s) => clip(String(s || "").replace(/["()]/g, "").replace(/\b(AND|OR|NOT)\b/g, " "), 120);
  const nov = q(j.noveltyQuery);
  const base = arr(j.queries).slice(0, 3).map(q).filter(Boolean);
  return {
    queries: base,
    // Kueri cek kebaruan (objek spesifik + metode): peserta memeriksa apakah ide yang persis sama sudah ada.
    novelty: nov,
    concepts: arr(j.concepts).slice(0, 6).map((s) => clip(s, 60)).filter(Boolean),
    perProdi: arr(j.perProdi).slice(0, 6).map((x) => ({ prodi: clip(x?.prodi, 60), query: clip(String(x?.query || "").replace(/["()]/g, "").replace(/\b(AND|OR|NOT)\b/g, " "), 120) }))
      .filter((x) => x.prodi && x.query && (!team.length || team.some((t) => t.toLowerCase() === x.prodi.toLowerCase()))),
  };
}

// ---------- Langkah 3: matriks gap (selalu bahasa Inggris, sitasi nama penulis) ----------
export function gapPrompt({ title, aim, prodi, papers }) {
  const ps = arr(papers).slice(0, 30);
  const absLen = ps.length > 15 ? 600 : 1200;
  const list = ps.map((w) =>
    `${paperLine(w)}\nCite as: ${citeLabel(w)}\nAbstract: ${clip(w.abstract, absLen) || "(no abstract available)"}`
  ).join("\n\n");
  const user = `${context({ title, aim, prodi })}
Papers (use ONLY these; refer to them by their number n). Each paper may be labelled with the discipline lens it was collected for:
${list}

Tasks (write EVERYTHING in academic English):
1. Define exactly 4 short column labels ("aspects", max 4 words each including the tag). The first 3 aspects must each capture the title's SPECIFIC topic (its specific object or setting, not just a generic field) from a DIFFERENT discipline of the author team, so the matrix shows both the multidisciplinary intersection and the gap. Add a short discipline tag in parentheses using only these tags: CS, IS, DB, VCD, IT (Computer Science, Information Systems, Digital Business, Visual Communication Design, International Trade); for any other discipline use one plain English word, never an invented acronym. Examples: "Ulos Motif Semantics (VCD)", "Motif Classification Model (CS)", "Heritage Archive System (IS)". The 4th must be "Indonesian Context".
2. For EVERY paper listed, fill one row: cells for the 4 aspects, each exactly one of "Yes", "Partial", "No", judged ONLY from the title and abstract text above. "Yes" only when the abstract explicitly addresses that aspect for the SAME specific object or setting; a related but different object (e.g. batik instead of ulos) is "Partial". A row with all "Yes" would mean the gap is already filled, so check it strictly. Add a one-sentence note in English on what the paper does.
3. Propose 2–3 candidate research gaps that the participant's title could fill, preferably at the intersection of two or more disciplines. Each gap statement must be 1–3 sentences in English and must cite the closest papers narratively using EXACTLY their "Cite as" label (author surname, year in parentheses, then number, e.g. "Although Lee et al. (2021) [3] examined ..., and Putri and Hadi (2023) [5] analysed ..., none of the reviewed studies has ..."). Use only the labels given above; never invent author names. Frame novelty relative to the reviewed studies, never as an absolute claim. Also list the cited paper numbers as evidence. Do not change the participant's topic.

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
- Exactly 5 keywords for the paper (in ${L.name}), lowercase unless proper nouns, in alphabetical order. At least 3 of them must NOT simply repeat words of the title: add the method, data type, setting, or established field terms (as in the IEEE Thesaurus).

JSON schema: {"titles":[{"title":"string","reason":"string"}],"keywords":["string","string","string","string","string"]}`;
  return { system: BASE_RULES, user };
}

export function cleanTitles(j) {
  return {
    titles: arr(j.titles).slice(0, 3).map((t) => (typeof t === "string" ? { title: clip(t, 220), reason: "" } : { title: clip(t?.title, 220), reason: clip(t?.reason, 300) })).filter((t) => t.title),
    keywords: arr(j.keywords).slice(0, 6).map((s) => clip(s, 60)).filter(Boolean),
  };
}

// ---------- Pendekatan penelitian (dipilih peserta sebelum AI menyarankan metode) ----------
export const APPROACHES = {
  quant: {
    name: "quantitative",
    desc: "quantitative (survey, experiment, secondary data, or computational experiment with statistical or performance analysis)",
    method: "For survey or experimental studies with people: research design; population and sample (sampling technique, [sample size]); instrument and variable operationalisation; data collection; validity and reliability tests; statistical analysis technique and software. For computational or machine-learning experiments, use the dataset-and-evaluation terminology given below instead.",
    results: "Results for survey/experimental studies: sample profile [Table II: descriptive statistics]; measurement validity and reliability [Table III]; hypothesis or model test results [Table IV]. For computational studies: dataset summary per class [Table II], performance per model against the baseline [Table III], confusion matrix [Fig. 2], and error analysis. Discussion: for each hypothesis, compare the placeholder outcome with the cited prior studies (consistent with / differs from), explain why, and state theoretical and practical implications.",
  },
  qual: {
    name: "qualitative",
    desc: "qualitative (interviews, focus groups, case study, content analysis, or ethnography)",
    method: "Research design and rationale; informants or cases and purposive selection criteria ([number of informants]); data collection (interview guide, observation, documents); thematic or content analysis procedure; trustworthiness (credibility, triangulation, member checking); research ethics and informed consent.",
    results: "Results: informant profile [Table II: informant profile]; main themes, each with a placeholder for an illustrative quotation [quotation from informant]; [Fig. 2: thematic map]. Discussion: relate each theme to the cited prior studies, explain new insights, and state implications. Never invent quotations.",
  },
  mixed: {
    name: "mixed methods",
    desc: "mixed methods (combining quantitative and qualitative strands, e.g. explanatory sequential)",
    method: "Mixed-methods design and sequence (e.g. explanatory sequential); quantitative strand (sample, instrument, analysis); qualitative strand (informants, data collection, thematic analysis); how the two strands are integrated.",
    results: "Results: quantitative findings [Table II: statistical results]; qualitative themes with placeholder quotations [quotation from informant]; integration of both strands [Table III: joint display]. Discussion: explain how the strands confirm, expand, or contradict each other, compare with the cited prior studies, and state implications.",
  },
  dsr: {
    name: "design science / engineering",
    desc: "design science or engineering research (building and evaluating an artefact: model, system, prototype, algorithm, or design work)",
    method: "Design science research steps: problem identification and objectives; design and development of the artefact (architecture, data, tools); demonstration; evaluation (metrics such as accuracy/F1 against a baseline, usability such as SUS, or expert/user testing, with [number of participants]).",
    results: "Results: the artefact [Fig. 2: system architecture or design]; evaluation results [Table II: evaluation metrics compared with baseline]; user or expert evaluation [Table III: usability or expert assessment]. Discussion: compare performance or reception with the cited prior studies, explain strengths and limitations of the artefact, and state implications.",
  },
};
export const approachKey = (k) => (APPROACHES[k] ? k : "auto");

// ---------- Tahap 4a: saran rencana data dan metode (setelah gap dipilih) ----------
export function methodPrompt({ title, aim, prodi, gap, papers, matrix, lang, approach, dataAvail }) {
  const L = LANG[lang] || LANG.en;
  const list = arr(papers).slice(0, 12).map((w) => `[${w.n}] Cite as: ${citeLabel(w)}. ${clip(w.title, 200)}. Abstract: ${clip(w.abstract, 400) || "(none)"}`).join("\n");
  const aspects = arr(matrix?.aspects).slice(0, 4).join("; ");
  const user = `${context({ title, aim, prodi })}Research gap chosen by the participant: ${clip(gap, 600)}
${aspects ? `Gap matrix aspects: ${aspects}\n` : ""}
Reviewed studies (for knowing which methods are already common):
${list || "(none)"}

${dataAvail ? `Data or access the team ALREADY HAS: ${clip(dataAvail, 500)}\n` : ""}
Task: propose exactly 3 DIFFERENT, feasible research designs (data + method) that would directly answer the chosen gap. The authors will choose one and edit it.
${APPROACHES[approachKey(approach)]
  ? `- The authors chose a ${APPROACHES[approach].desc} approach. ALL 3 options MUST use this approach; make them distinct variations within it. Set "approach" to "${approach}" for every option.`
  : `- The authors have not chosen an approach: give 3 options from DIFFERENT approaches among quant (quantitative), qual (qualitative), mixed (mixed methods), and dsr (design science / engineering), and set "approach" to that code.`}
${dataAvail ? "- Build at least two options around the data or access the team already has." : ""}
- Each option must be doable by a lecturer team within 6–12 months on a small budget.
- Prefer designs that combine the represented disciplines (multidisciplinary team).
- Data: describe the type, source and rough size. Name a data source only if it is a well-known public source; otherwise describe it generically (e.g. "[number of respondents]"). Never invent dataset names, statistics or results.
- Analysis: concrete techniques (e.g. SEM-PLS, thematic analysis, random forest with 5-fold cross-validation).
- Evaluation: how success or validity will be judged (metrics, reliability/validity tests).
- why: one sentence on how this design answers the gap and how it differs from the reviewed studies; you may cite them with the exact "Cite as" labels.
- Write every field in ${L.name}. Keep each field to one or two sentences.

JSON schema: {"options":[{"approach":"quant|qual|mixed|dsr","label":"short name (max 6 words)","design":"string","data":"string","analysis":"string","evaluation":"string","why":"string"}]}`;
  return { system: BASE_RULES, user };
}
export function cleanMethod(j, body = {}) {
  const fixed = APPROACHES[body.approach] ? body.approach : "";
  return {
    options: arr(j.options).slice(0, 3).map((o) => ({
      approach: fixed || (APPROACHES[o?.approach] ? o.approach : ""),
      label: clip(o?.label, 80), design: clip(o?.design, 400), data: clip(o?.data, 400),
      analysis: clip(o?.analysis, 400), evaluation: clip(o?.evaluation, 400), why: clip(o?.why, 500),
    })).filter((o) => o.design || o.data || o.analysis),
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
export function draftPrompt({ title, aim, gap, prodi, lang, papers, matrix, method, approach }) {
  const L = LANG[lang] || LANG.en;
  const A = APPROACHES[approachKey(approach)];
  const id = lang === "id";
  const ps = arr(papers).slice(0, 30);
  const absLen = ps.length > 15 ? 550 : 900;
  const list = ps.map((w) =>
    `[${w.n}]${w.prodi ? ` (lens: ${clip(w.prodi, 40)})` : ""} Name in text as: ${ieeeLabel(w)}. ${clip(w.title, 250)}. ${clip((w.authors || []).slice(0, 3).join(", "), 120)}${(w.authors || []).length > 3 ? " et al." : ""} (${w.year || "n.d."}), ${clip(w.venue, 120)}.\nAbstract: ${clip(w.abstract, absLen) || "(no abstract available — cite only for its title-level topic)"}`
  ).join("\n\n");
  const matrixText = matrix && arr(matrix.rows).length
    ? `Gap matrix, shown in the paper as Table I (aspects: ${arr(matrix.aspects).join(" | ")}):\n` + arr(matrix.rows).map((r) => `[${r.n}] ${arr(r.cells).join(" | ")}`).join("\n")
    : "";
  const T = (en, idn) => (id ? idn : en);
  const user = `${context({ title, aim, prodi })}Research gap chosen by the participant: ${clip(gap, 600)}
${method ? `Planned data and method (from the participant): ${clip(method, 600)}` : ""}
${A ? `Research approach chosen by the authors: ${A.desc}.` : ""}

Numbered reference list (the ONLY sources you may cite):
${list}

${matrixText}

Write a draft IEEE conference paper in ${L.name}, about 1800–2300 words in total, for exactly the title above (do not change the topic). Write it as the FINISHED paper will read after the study is completed (method in past tense), with every finding, number, and quotation as a bracketed placeholder, so the authors only fill the placeholders after their analysis. Do not call it a plan or proposal and do not use "will", "expected", or "if ... then" speculation about results.

Citation rules (IEEE):
- Cite ONLY with IEEE numeric brackets using the numbers above, e.g. [2] or [1], [4]. Never cite a number not in the list.
- When a sentence names authors, use EXACTLY the "Name in text as" label WITHOUT a year, e.g. "${T("Lee et al. [3] showed", "Lee et al. [3] menunjukkan")} ...". Never put years in the text and never invent names.
- Every claim about prior work must be supported by that paper's title or abstract. Do not overstate.
- Cite each listed paper that is genuinely relevant at least once. If a listed paper is only weakly related to this title, cite it at most once, briefly, or not at all; never stretch its relevance.
- A factual claim that none of the listed papers supports gets the placeholder [${T("add reference", "tambahkan referensi")}] instead of an uncited statement.

Writing rules:
- Never mention the author team, departments, study programmes, or faculties. Express the multidisciplinary nature as fields of knowledge (e.g. visual semiotics, information systems for archiving, machine learning), not as names of disciplines in the team.
- Write entirely in ${L.name}; translate any term from another language, except proper nouns.
- Numbering: Table I is the gap matrix. Any new table starts at Table II and any figure at Fig. 1; refer to each one in the text (e.g. "${T("as shown in Table II", "seperti terlihat pada Tabel II")}"). Table and figure placeholders are written in brackets, e.g. [${T("Table II: …", "Tabel II: …")}], [${T("Fig. 1: research workflow", "Gambar 1: alur penelitian")}].

Section requirements ("sections": exactly these headings in order: ${L.sections.map((x) => `"${x}"`).join(", ")}; no sub-headings, no bullet lists, no real tables):
- "${L.sections[0]}" (4–5 paragraphs): (1) context supported by citations; (2) the specific problem with evidence; (3) what the reviewed studies have done and the gap, framed relative to them; (4) the objective and 1–3 research questions; (5) the contributions in one sentence enumerated as (1), (2), (3), followed by one sentence on the paper's organisation ("${T("The remainder of this paper is organized as follows: Section II …", "Sisa makalah ini disusun sebagai berikut: Bagian II …")}").
- "${L.sections[1]}" (3–4 paragraphs): synthesise by THEME (2–3 themes), not one paper per paragraph; compare approaches and limitations, citing several papers per paragraph; refer explicitly to Table I ("${T("Table I summarizes the reviewed studies", "Tabel I merangkum studi terdahulu")}"); end by positioning this study against the gap.
- "${L.sections[2]}" (3–5 paragraphs): ${A ? A.method : "design and rationale; data source, sample or informants; data collection; analysis technique and tools; ethics if humans are involved."} Use terminology that fits THIS study. For computational, machine-learning, or system studies, do not use survey terms such as population, instrument, or respondents; describe instead: dataset (source, classes or labels, [number] per class, licence or permission), annotation procedure and agreement, preprocessing and augmentation, train/validation/test split that avoids leakage, models and at least one baseline, hyperparameters, evaluation metrics (e.g. macro-F1 for imbalanced classes) with repeated runs or k-fold, and hardware/software. Include a placeholder for [${T("Fig. 1: research workflow", "Gambar 1: alur penelitian")}] and refer to it.
- "${L.sections[3]}" (3–5 paragraphs): ${A ? A.results : "Results: each table or figure as a numbered bracketed placeholder. Discussion: compare the placeholder outcomes with the cited prior studies, explain why, and state implications."} Table and figure labels must match the methods actually described (e.g. a machine-learning study reports per-class metrics and a confusion matrix, not survey validity tests). The discussion MUST compare with at least two listed studies by their "Name in text as" labels, phrased so the authors can complete it, e.g. "[${T("main finding", "temuan utama")}] ${T("is consistent with", "sejalan dengan")} Lee et al. [3] ...". End with one sentence on limitations.
- "${L.sections[4]}" (1–2 paragraphs, at most 200 words): answer the objective with placeholders for the main findings, state the contributions, one limitation, and concrete future work. No citations, no repetition of the introduction, no new information.

Abstract and keywords:
- "abstract": ONE paragraph, 150–250 words: background (1 sentence), gap, objective, method (data and technique), results as placeholders (e.g. "${T("achieved [macro-F1]", "mencapai [macro-F1]")}"), and contribution. No citations, no undefined acronyms, no mention of the author team or disciplines.
- "keywords": 4–6 terms in alphabetical order; at least 3 must not merely repeat words of the title.

JSON schema: {"abstract":"string","keywords":["string"],"sections":[{"heading":"string","paragraphs":["string"]}]}`;
  return { system: BASE_RULES, user };
}

// ---------- Review sebagai reviewer IEEE ----------
export const REVIEW_SECTIONS = ["Title", "Authors", "Abstract", "Keywords", "Introduction", "Related Work", "Method", "Results and Discussion", "Conclusion", "References", "Format"];
export function reviewPrompt({ title, abstract, keywords, sections, references, authors, lang, approach }) {
  const A = APPROACHES[approachKey(approach)];
  const body = arr(sections).slice(0, 6).map((sec, i) => `${["I", "II", "III", "IV", "V", "VI"][i]}. ${clip(sec?.heading, 80)}\n${arr(sec?.paragraphs).map((p) => clip(p, 2500)).join("\n\n")}`).join("\n\n");
  const refs = arr(references).slice(0, 30).map((r) => `[${r.n}] ${clip(r.title, 200)} (${r.year || "n.d."}), ${clip(r.venue, 100)}${r.complete ? "" : " — volume/pages missing"}`).join("\n");
  const au = arr(authors).slice(0, 6).map((a, i) => `${i + 1}. ${[a.name, a.dept, a.faculty, a.org, a.city, a.email].map((x) => clip(x, 120)).filter(Boolean).join(" | ")}`).join("\n");
  const system = `You are an experienced reviewer for IEEE conferences. You review a DRAFT written by Indonesian lecturers with AI assistance in a training session. Data collection has not happened yet, so bracketed placeholders such as [number of images] or [Table II: ...] are EXPECTED and must not be criticised as such; criticise only placeholders that are inconsistent, mislabelled, or missing where a number or source is needed.
Hard rules:
- Judge ONLY the text given. Never invent content, references, or facts about the literature; you may say "check whether studies on X exist" but never claim they do.
- Be specific: quote a short excerpt (max 15 words, original language) for every finding.
- Return ONLY valid JSON matching the requested schema. No markdown.`;
  const user = `Paper language: ${lang === "id" ? "Bahasa Indonesia" : "English"}${A ? `; research approach: ${A.name}` : ""}.

TITLE: ${clip(title, 300)}
AUTHORS (as printed):
${au || "(none)"}
ABSTRACT: ${clip(abstract, 2500)}
KEYWORDS: ${clip(arr(keywords).join(", ") || keywords, 300)}

${body}

REFERENCES (${arr(references).length}):
${refs || "(none)"}

Review this draft against IEEE conference expectations:
- Title: specific, no subtitle or special symbols, about 10–15 words, no typos.
- Authors: name; department and faculty; organisation; "City, Country"; email or ORCID; affiliations in the paper language (institution names may stay original).
- Abstract: one paragraph, 150–250 words, background, gap, objective, method, results (placeholders allowed), contribution; no citations; no mention of the author team or study programmes; no hype.
- Keywords: 3–6, alphabetical, not merely repeating the title.
- Introduction: cited context, specific problem, gap relative to reviewed studies (no absolute novelty claims), objective and research questions, explicit contributions, paper organisation.
- Related Work: synthesis by theme, comparison, explicit reference to Table I, positioning against the gap; IEEE in-text style "Lee et al. [3]" without years.
- Method: terminology that fits the study type (e.g. machine-learning studies need dataset per class, annotation, leakage-free split, baseline, suitable metrics; human studies need sampling and ethics); replicable detail; workflow figure referenced.
- Results and Discussion: numbered tables/figures starting at Table II and Fig. 1, labels consistent with the method, discussion compares with at least two cited studies, limitations.
- Conclusion: 1–2 paragraphs, answers the objective, contributions, limitation, future work, no new citations.
- References: enough for a conference paper (typically 15–30), all relevant to the topic, complete metadata; every reference cited in the text.
- Format and consistency: tables and figures referenced in text, consistent terminology, no mixed languages, consistency between Method and the planned data.

Write "summary", "issue", and "suggestion" in Bahasa Indonesia (the participants are Indonesian). Give 6–10 findings, the most important first; "major" means it would likely cause rejection or a major revision. Each "suggestion" must be a concrete fix the authors can apply in this draft.

JSON schema: {"verdict":"major revision|minor revision|ready after data","summary":"2–3 sentences","strengths":["string"],"findings":[{"section":"one of: ${REVIEW_SECTIONS.join(", ")}","severity":"major|minor","quote":"string","issue":"string","suggestion":"string"}]}`;
  return { system, user };
}
export function cleanReview(j) {
  const verdicts = ["major revision", "minor revision", "ready after data"];
  const v = String(j?.verdict || "").toLowerCase();
  const sev = (x) => (String(x || "").toLowerCase().startsWith("maj") ? "major" : "minor");
  const sec = (x) => REVIEW_SECTIONS.find((r) => r.toLowerCase() === String(x || "").toLowerCase()) || clip(x, 40) || "Format";
  const findings = arr(j?.findings).slice(0, 12).map((f) => ({
    section: sec(f?.section), severity: sev(f?.severity), quote: clip(f?.quote, 200), issue: clip(f?.issue, 500), suggestion: clip(f?.suggestion, 600),
  })).filter((f) => f.issue);
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "major" ? -1 : 1));
  return {
    verdict: verdicts.find((x) => v.startsWith(x.split(" ")[0])) || "major revision",
    summary: clip(j?.summary, 700),
    strengths: arr(j?.strengths).slice(0, 4).map((x) => clip(x, 300)).filter(Boolean),
    findings,
  };
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
