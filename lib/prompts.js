import { standardPromptText, standardItems, standardKey } from "../public/standards.js";
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
export function draftPrompt({ title, aim, gap, prodi, lang, papers, matrix, method, approach, compact, profile }) {
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

${compact ? "COMPACT MODE: a previous attempt was too long. Keep every section at the LOWER end of its word range, at most 4 paragraphs per section, and the abstract near 150 words.\n" : ""}Write a draft IEEE conference paper in ${L.name}, about ${compact ? "1500–1900" : "2200–2800"} words in total (excluding the abstract), for exactly the title above (do not change the topic). Write it as the FINISHED paper will read after the study is completed (method in past tense), with every finding, number, and quotation as a bracketed placeholder, so the authors only fill the placeholders after their analysis. Do not call it a plan or proposal and do not use "will", "expected", or "if ... then" speculation about results.

Citation rules (IEEE):
- Cite ONLY with IEEE numeric brackets using the numbers above, one number per bracket, e.g. [2] or [1], [4]. Never use ranges such as [2]–[4]; write [2], [3], [4]. Never cite a number not in the list. Place the citation before the closing punctuation.
- When a sentence names authors, use EXACTLY the "Name in text as" label WITHOUT a year, e.g. "${T("Lee et al. [3] showed", "Lee et al. [3] menunjukkan")} ...". Never put years in the text and never invent names.
- Every claim about prior work must be supported by that paper's title or abstract. Do not overstate.
- Cite each listed paper that is genuinely relevant at least once. If a listed paper is only weakly related to this title, cite it at most once, briefly, or not at all; never stretch its relevance.
- A factual claim that none of the listed papers supports gets the placeholder [${T("add reference", "tambahkan referensi")}] instead of an uncited statement.

Writing rules:
- Never mention the author team, departments, study programmes, or faculties. Express the multidisciplinary nature as fields of knowledge (e.g. visual semiotics, information systems for archiving, machine learning), not as names of disciplines in the team.
- Write entirely in ${L.name}; translate any term from another language, except proper nouns.
- Spell out every technical term or acronym at first use. Do not use the words novel, new, revolutionary, first, or highly accurate as claims.
- Contributions must each be traceable to something described in the Method and reported (as placeholders) in the Results. Do not present an integration of existing tools as a new algorithm, and do not treat a different location alone as a scientific contribution.
- Never use "significant" in a statistical sense unless a statistical test is described; report percentage-point changes separately from relative changes.
- Numbering: Table I is the gap matrix. Any new table starts at Table II and any figure at Fig. 1; refer to each one in the text (e.g. "${T("as shown in Table II", "seperti terlihat pada Tabel II")}"). Table and figure placeholders are written in brackets, e.g. [${T("Table II: …", "Tabel II: …")}], [${T("Fig. 1: research workflow", "Gambar 1: alur penelitian")}].

${profile ? `${standardPromptText(profile, "MDHP")}
Every REQUIRED item above must be visibly covered: Method and Data items in the "${L.sections[2]}" section, Results items as the structure of the "${L.sections[3]}" section (with numbered bracketed placeholders for values not yet available, e.g. "[Table II: ...]"), and Discussion items in its comparison, interpretation, and limitation paragraphs. Do not use a numbered list; weave the items into prose.

` : ""}Section requirements ("sections": exactly these headings in order: ${L.sections.map((x) => `"${x}"`).join(", ")}; no sub-headings, no bullet lists, no real tables). Every paragraph is an object {"role", "text"} whose "role" names its main function, chosen ONLY from the roles listed for that section:
- "${L.sections[0]}" (about 400–600 words, 5–6 paragraphs, roles in this order: context, problem, gap, objective, contribution, organization): context of the specific problem supported by citations; the concrete problem and its consequences; the closest prior approaches and the gap they leave, framed relative to the reviewed studies; the objective and 1–3 research questions; 2–4 contributions enumerated as (1), (2), (3) in one paragraph; one short sentence on the paper's organisation ("${T("The remainder of this paper is organized as follows: Section II …", "Sisa makalah ini disusun sebagai berikut: Bagian II …")}").
- "${L.sections[1]}" (about 250–400 words, 3 paragraphs, roles: theme, comparison, positioning): group the studies by approach, evaluation design, context, or finding (theme), citing several papers per paragraph; compare their similarities, differences, and limitations without comparing numbers across different datasets as if equivalent, distinguishing limitations stated by the authors from your interpretation (comparison); refer explicitly to Table I ("${T("Table I summarizes the reviewed studies", "Tabel I merangkum studi terdahulu")}") and close with the specific gap and why this study's design addresses it (positioning).
- "${L.sections[2]}" (about 700–1000 words, 4–6 paragraphs, roles: design, data, procedure, evaluation, ethics; a role may repeat): research design, research questions, unit of analysis, variables or system boundaries (design); data or participants: source, period, number before and after selection as placeholders, inclusion and exclusion criteria, labelling, handling of missing data (data); the proposed approach or system: inputs, outputs, components, data flow, algorithm steps, parameters and why they were chosen (procedure); evaluation setup and measures: baselines or comparison, test conditions, data split, repetitions, hardware and software, metric definitions and statistical analysis (evaluation); ethics, permissions, and reproducibility: code, configuration, dataset version, seed (ethics). ${A ? A.method : ""} Use terminology that fits THIS study. For computational, machine-learning, or system studies, do not use survey terms such as population, instrument, or respondents; check for data leakage in preprocessing and feature selection and keep training and test units independent. For application or information-system development, link requirements, design, implementation, and evaluation with tasks, scenarios, and success criteria; screenshots or features alone are not evidence of improved efficiency or satisfaction. Include a placeholder for [${T("Fig. 1: research workflow", "Gambar 1: alur penelitian")}] and refer to it.
- "${L.sections[3]}" (about 750–1150 words, 4–6 paragraphs, roles: results, comparison, interpretation, limitation): ${A ? A.results : "Results: each table or figure as a numbered bracketed placeholder. Discussion: compare the placeholder outcomes with the cited prior studies, explain why, and state implications."} Organise the results by research question or evaluation scenario, starting with the number of units analysed as a placeholder (results). Table and figure labels must match the methods actually described (e.g. a machine-learning study reports per-class metrics and a confusion matrix, not survey validity tests). Compare with at least two listed studies by their "Name in text as" labels only under comparable conditions, phrased so the authors can complete it, e.g. "[${T("main finding", "temuan utama")}] ${T("is consistent with", "sejalan dengan")} Lee et al. [3] ..." (comparison). Explain practical consequences and trade-offs as interpretation, not proof (interpretation). Link each limitation to its effect, e.g. a single site limits generalisation (limitation).
- "${L.sections[4]}" (about 150–200 words, 1–2 paragraphs, roles: answer, contribution, limitation, future; one paragraph may combine roles, then give its main role): answer the objective directly with placeholders for the main findings, state the contributions within the tested scope, one main limitation, and one or two concrete next steps. No citations, no new numbers or claims, do not copy the abstract.

Abstract and keywords:
- "abstract": ONE paragraph of 150–250 words, written as an ordered list of exactly six segments {"role", "text"} that read as one continuous paragraph when joined: background (20–30 words, context and concrete problem), gap (20–30 words), objective (15–25 words), method (40–60 words: design, data or object, approach, key evaluation), results (35–70 words, findings and metrics as placeholders, e.g. "${T("achieved [macro-F1]", "mencapai [macro-F1]")}"), contribution (20–35 words, meaning of the findings within the supported scope). No citations, footnotes, equations, or undefined acronyms; no mention of the author team or disciplines; do not claim the method "succeeded" without the basis.
- "keywords": 4–6 terms in alphabetical order (IEEE Thesaurus style); at least 3 must not merely repeat words of the title; avoid overly generic terms.

JSON schema: {"abstract":[{"role":"background|gap|objective|method|results|contribution","text":"string"}],"keywords":["string"],"sections":[{"heading":"string","paragraphs":[{"role":"string","text":"string"}]}]}`;
  return { system: BASE_RULES, user };
}

// ---------- Peran (komponen) tiap bagian untuk pewarnaan struktur di aplikasi ----------
export const ROLE_SETS = {
  abstract: ["background", "gap", "objective", "method", "results", "contribution"],
  intro: ["context", "problem", "gap", "objective", "contribution", "organization"],
  related: ["theme", "comparison", "positioning"],
  method: ["design", "data", "procedure", "evaluation", "ethics"],
  results: ["results", "comparison", "interpretation", "limitation"],
  conclusion: ["answer", "contribution", "limitation", "future"],
};
const SECTION_ROLE_KEYS = ["intro", "related", "method", "results", "conclusion"];
const roleOf = (key, r) => (ROLE_SETS[key].includes(String(r || "").toLowerCase().trim()) ? String(r).toLowerCase().trim() : "");

// ---------- Review sebagai reviewer IEEE ----------
export const REVIEW_SECTIONS = ["Title", "Authors", "Abstract", "Keywords", "Introduction", "Related Work", "Method", "Results and Discussion", "Conclusion", "Statements", "References", "Format"];
export const REVIEW_CHECKS = ["objective_answered", "method_traceable", "numbers_consistent", "contributions_supported", "references_support", "no_template_text"];
export function reviewPrompt({ title, abstract, keywords, sections, references, authors, lang, approach, acknowledgment, contributionship, openData, media, profile }) {
  const A = APPROACHES[approachKey(approach)];
  const body = arr(sections).slice(0, 6).map((sec, i) => `${["I", "II", "III", "IV", "V", "VI"][i]}. ${clip(sec?.heading, 80)}\n${arr(sec?.paragraphs).map((p) => clip(p, 2500)).join("\n\n")}`).join("\n\n");
  const refs = arr(references).slice(0, 30).map((r) => `[${r.n}] ${clip(r.title, 200)} (${r.year || "n.d."}), ${clip(r.venue, 100)}${r.complete ? "" : " — volume/pages missing"}`).join("\n");
  const au = arr(authors).slice(0, 6).map((a, i) => `${i + 1}. ${[a.name, a.dept, a.faculty, a.org, a.city, a.email].map((x) => clip(x, 120)).filter(Boolean).join(" | ")}`).join("\n");
  const system = `You are an experienced reviewer for IEEE conferences. You review a DRAFT written by Indonesian lecturers with AI assistance in a training session. ${media ? "The authors have analysed their own data and supplied the results tables and figures listed in the paper; judge whether the text reports those numbers consistently and draws justified conclusions. Remaining bracketed placeholders are acceptable only where data is still missing." : "Data collection has not happened yet, so bracketed placeholders such as [number of images] or [Table II: ...] are EXPECTED and must not be criticised as such; criticise only placeholders that are inconsistent, mislabelled, or missing where a number or source is needed."}
Hard rules:
- Judge ONLY the text given. Never invent content, references, or facts about the literature; you may say "check whether studies on X exist" but never claim they do.
- Be specific: for every finding, "quote" must be a short excerpt (max 15 words) copied VERBATIM from the draft text, never from these instructions. If the problem is that something is missing, quote the nearest sentence where it should appear.
- Report a problem only if the draft actually violates the rule. Before writing a finding, re-read the quoted excerpt and confirm it shows the violation; if the draft already complies, do not report it. Never give a suggestion whose example is identical to the quoted text.
- Never state or promise that the paper will be accepted, and never present yourself as an official IEEE editor.
- Distinguish venue-format compliance (not verifiable here because no venue is given) from scientific adequacy.
- Return ONLY valid JSON matching the requested schema. No markdown.`;
  const user = `Paper language: ${lang === "id" ? "Bahasa Indonesia" : "English"}${A ? `; research approach: ${A.name}` : ""}.

TITLE: ${clip(title, 300)}
AUTHORS (as printed):
${au || "(none)"}
ABSTRACT: ${clip(abstract, 2500)}
KEYWORDS: ${clip(arr(keywords).join(", ") || keywords, 300)}

${body}
${media ? `\nTABLES AND FIGURES (results supplied by the authors from their own analysis; numbers are real, so check that the text reports them consistently):\n${String(media).slice(0, 6000)}\n` : ""}
ACKNOWLEDGMENT: ${clip(acknowledgment, 1200) || "(none)"}
OPEN CONTRIBUTIONSHIP: ${clip(contributionship, 1000) || "(none)"}
OPEN DATA: ${clip(openData, 600) || "(none)"}

REFERENCES (${arr(references).length}):
${refs || "(none)"}

Review this draft against IEEE conference expectations (IEEE Author Center "Structure your article/paper" and the IEEE Editorial Style Manual):
- Title: names the object or problem, main approach, and tested context; no subtitle, special symbols, promotional words (novel, new, revolutionary, highly accurate), or unproven priority claims; no typos.
- Authors: name; department and faculty; organisation; "City, Country"; email or ORCID; consistent spelling; affiliations in the paper language (institution names may stay original); no academic titles in the byline.
- Abstract: one self-contained paragraph of 150–250 words with background, gap, objective, method, results (placeholders allowed), and contribution; no citations, footnotes, equations, or undefined acronyms; no mention of the author team; no claim of success without its basis.
- Keywords: 3–6 relevant terms in alphabetical order, not merely repeating the title, not overly generic.
- Introduction: cited context, concrete problem, closest prior work and a gap relative to the reviewed studies (no "never studied" or "first" claims, and a different location alone is not a contribution), objective and research questions, 2–4 contributions each traceable to Method and Results, short paper organisation.
- Related Work: grouped by approach, evaluation, context, or finding rather than one paper per paragraph; no cross-dataset numeric comparison as if equivalent; explicit reference to Table I; closes with the specific gap; author names cited with the number only (correct: Lee et al. [3]; wrong only if a year appears, such as Lee et al. (2021) or Lee, 2021).
- Method: enough detail to reconstruct the work: design, data or participants (source, period, counts, selection criteria), approach or system, evaluation setup (baselines, split, repetitions, hardware/software), metric definitions, reproducibility; terminology that fits the study type (machine learning: leakage-free split and independent units; system development: requirements-design-implementation-evaluation with measured outcomes, screenshots are not evidence; human studies: sampling and ethics); workflow figure referenced.
- Results and Discussion: organised by research question or scenario; numbered tables and figures starting at Table II and Fig. 1, labels consistent with the method; no "significant" without a test; discussion interprets rather than repeats, compares with at least two cited studies under comparable conditions, links limitations to their effects, and avoids over-generalisation.
- Conclusion: answers the objective directly, contributions within the tested scope, limitation, one or two next steps; no new numbers, claims, or citations; does not copy the abstract.
- Statements: AI disclosure names the system, the affected sections, and the extent of use; contributionship and open data are consistent with the method; no invented ethics approvals, funding, or grant numbers.
- References: numeric IEEE style, one number per bracket (no ranges such as [2]–[4]), numbered in order of first citation, every reference cited and relevant to the claims, complete metadata. Judge whether the references are sufficient for the argument; do not cite a fixed minimum number as an IEEE rule.
- Format and consistency: every table and figure referenced in the text, consistent terminology and numbers across sections, no mixed languages, no leftover template instructions.

Also assess these six consistency checks, each "ok", "warn", or "fail" with a short note in Bahasa Indonesia: objective_answered (the objective in the Introduction is answered by the evaluation and results), method_traceable (every claimed method has an implementation or analysis trace), numbers_consistent (key numbers or placeholders are consistent across abstract, body, tables, and conclusion), contributions_supported (contributions do not exceed the evidence and baselines), references_support (references support the claims and are numbered consistently), no_template_text (no template instructions or essential non-placeholder gaps remain).

${profile ? `Also assess the paper against this minimum reporting standard. For EVERY item id give "status": "met" (clearly present), "partial" (mentioned but incomplete or only as a placeholder that still needs the authors' data), or "missing" (absent), with a short "note" in Bahasa Indonesia saying where it is or what to add.
${standardPromptText(profile, "MDHP")}

` : ""}Write "summary", "issue", and "suggestion" in Bahasa Indonesia (the participants are Indonesian). Give 6–10 findings, the most important first; "major" means it would likely cause rejection or a major revision. Each "suggestion" must be a concrete fix the authors can apply in this draft.

JSON schema: {"verdict":"major revision|minor revision|ready after data","summary":"2–3 sentences","strengths":["string"],"checks":[{"id":"objective_answered","status":"ok|warn|fail","note":"string"}],${profile ? `"standard":[{"id":"C1","status":"met|partial|missing","note":"string"}],` : ""}"findings":[{"section":"one of: ${REVIEW_SECTIONS.join(", ")}","severity":"major|minor","quote":"string","issue":"string","suggestion":"string"}]}`;
  return { system, user };
}
// Teks paper untuk memverifikasi kutipan reviewer.
const normTxt = (x) => String(x || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\[\]]+/g, " ").trim();
function paperText(b) {
  if (!b) return "";
  const secs = arr(b.sections).map((s) => [s?.heading, ...arr(s?.paragraphs)].join(" ")).join(" ");
  const refs = arr(b.references).map((r) => [r?.title, r?.venue, r?.year].join(" ")).join(" ");
  const au = arr(b.authors).map((a) => [a?.name, a?.dept, a?.faculty, a?.org, a?.city, a?.email].join(" ")).join(" ");
  return normTxt([b.title, au, b.abstract, arr(b.keywords).join(" ") || b.keywords, secs, b.media, b.acknowledgment, b.contributionship, b.openData, refs].join(" "));
}
// true jika kutipan benar-benar ada di paper (persis, atau ≥80% kata dalam urutan berdekatan).
export function quoteInPaper(quote, text) {
  const q = normTxt(quote).replace(/\s*\.\.\.\s*/g, " ");
  if (!q || !text) return true;
  if (text.includes(q)) return true;
  const qw = q.split(" ").filter(Boolean);
  if (qw.length < 3) return text.includes(q);
  const tw = text.split(" ");
  const need = Math.ceil(qw.length * 0.8), win = qw.length + 4;
  const qs = new Set(qw);
  for (let i = 0; i + 1 < tw.length; i++) {
    if (!qs.has(tw[i])) continue;
    const seen = new Set();
    for (let k = i; k < Math.min(tw.length, i + win); k++) if (qs.has(tw[k])) seen.add(tw[k]);
    if (seen.size >= Math.min(need, qs.size)) return true;
  }
  return false;
}
function cleanStandard(j, profile) {
  if (!profile) return null;
  const got = new Map(arr(j?.standard).map((x) => [String(x?.id || "").toUpperCase(), x]));
  return standardItems(profile).map((it) => {
    const x = got.get(it.id) || {};
    const st = String(x.status || "").toLowerCase();
    return { id: it.id, status: ["met", "partial", "missing"].includes(st) ? st : "missing", note: clip(x.note, 260), unrated: !got.has(it.id) };
  });
}
export function cleanReview(j, body) {
  const text = paperText(body);
  const verdicts = ["major revision", "minor revision", "ready after data"];
  const v = String(j?.verdict || "").toLowerCase();
  const sev = (x) => (String(x || "").toLowerCase().startsWith("maj") ? "major" : "minor");
  const sec = (x) => REVIEW_SECTIONS.find((r) => r.toLowerCase() === String(x || "").toLowerCase()) || clip(x, 40) || "Format";
  const findings = arr(j?.findings).slice(0, 12).map((f) => ({
    section: sec(f?.section), severity: sev(f?.severity), quote: clip(f?.quote, 200), issue: clip(f?.issue, 500), suggestion: clip(f?.suggestion, 600),
  })).filter((f) => f.issue)
    // Buang temuan yang kutipannya tidak ada di paper (misalnya mengutip instruksi reviewer sendiri).
    .filter((f) => !text || quoteInPaper(f.quote, text));
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "major" ? -1 : 1));
  return {
    verdict: verdicts.find((x) => v.startsWith(x.split(" ")[0])) || "major revision",
    summary: clip(j?.summary, 700),
    strengths: arr(j?.strengths).slice(0, 4).map((x) => clip(x, 300)).filter(Boolean),
    checks: REVIEW_CHECKS.map((id) => {
      const c = arr(j?.checks).find((x) => String(x?.id || "").toLowerCase() === id) || {};
      const st = String(c.status || "").toLowerCase();
      return { id, status: ["ok", "warn", "fail"].includes(st) ? st : "warn", note: clip(c.note, 300) };
    }),
    standard: cleanStandard(j, body?.profile ? standardKey(body.profile) : ""),
    profile: body?.profile ? standardKey(body.profile) : "",
    findings,
  };
}

// Membersihkan sitasi: hanya nomor yang ada di daftar yang dipertahankan; [1,2] -> [1], [2].
export function sanitizeCitations(text, validNs) {
  const ok = new Set(validNs);
  // "[2]–[4]" (rentang antarkurung) diubah menjadi "[2–4]" agar dipecah menjadi [2], [3], [4] (IEEE: satu nomor per kurung).
  const t0 = String(text || "").replace(/\[(\d+)\]\s*[–—-]\s*\[(\d+)\]/g, "[$1–$2]");
  return t0.replace(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, (m, inner) => {
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
  const asPara = (p) => (typeof p === "string" ? { role: "", text: p } : { role: p?.role, text: p?.text });
  const sections = L.sections.map((h, i) => {
    const s = byHeading.find((x) => clip(x?.heading, 80).toLowerCase() === h.toLowerCase()) || byHeading[i] || {};
    const paras = arr(s.paragraphs).slice(0, 8).map(asPara)
      .map((p) => ({ role: roleOf(SECTION_ROLE_KEYS[i], p.role), text: sanitizeCitations(clip(p.text, 2500), validNs) }))
      .filter((p) => p.text);
    return { heading: h, paragraphs: paras.map((p) => p.text), roles: paras.map((p) => p.role) };
  });
  const noCite = (t) => sanitizeCitations(clip(t, 1200), validNs).replace(/\s*\[\d+\](,\s*\[\d+\])*/g, "");
  let abstractParts;
  if (Array.isArray(j.abstract)) {
    abstractParts = j.abstract.slice(0, 10).map((p) => ({ role: roleOf("abstract", p?.role), text: noCite(p?.text) })).filter((p) => p.text);
  } else {
    abstractParts = [{ role: "", text: noCite(j.abstract) }].filter((p) => p.text);
  }
  return {
    abstract: abstractParts.map((p) => p.text).join(" "),
    abstractParts,
    keywords: arr(j.keywords).slice(0, 6).map((s) => clip(s, 60)),
    sections,
  };
}

export { LANG };
