// Tugas AI "blueprint" (Rencana Hasil): dari judul, gap, dan metode yang dipilih, AI merencanakan hasil apa
// yang harus dilaporkan: pertanyaan penelitian/hipotesis, kerangka tabel dan gambar KOSONG, analisis,
// kriteria keputusan, data yang perlu disiapkan, butir standar minimum yang dipenuhi, dan bahan pembahasan.
// AI hanya merencanakan struktur; tidak ada angka hasil maupun dugaan hasil.
import { ieeeLabel, LANG, APPROACHES, approachKey } from "./prompts.js";
import { standardItems, standardKey, STANDARDS, standardPromptText } from "../public/standards.js";

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const arr = (a) => (Array.isArray(a) ? a : []);

export function blueprintPrompt(b) {
  const L = LANG[b.lang] || LANG.en;
  const A = APPROACHES[approachKey(b.approach)];
  const P = standardKey(b.profile);
  const papers = arr(b.papers).slice(0, 30).map((w) => `[${w.n}] ${ieeeLabel(w)}. ${clip(w.title, 180)} (${w.year || "n.d."}). ${clip(w.abstract, 220)}`).join("\n");
  const system = `You are an IEEE research-methods mentor helping an Indonesian lecturer plan, BEFORE collecting data, exactly which results their paper must report. You plan structure only.
Hard rules:
- Never predict, estimate, or hint at outcomes. No numbers in table cells, no "expected to be supported", no likely values. Thresholds and decision criteria from methodological conventions are allowed.
- Never invent references; use only the numbered list given, and only for what their titles or abstracts state.
- Fit the plan to THIS title, gap, and method; do not produce a generic template. Name the actual constructs, variables, models, features, or themes from the title and method.
- Return ONLY valid JSON matching the schema. No markdown.`;
  const user = `Paper language: ${L.name}. Title: ${clip(b.title, 300)}
Objective: ${clip(b.aim, 600)}
Research gap: ${clip(b.gap, 800)}
${A ? `Research approach: ${A.name}.` : ""}
Type of research: ${STANDARDS[P].name}.
Planned data and method (chosen by the authors):
${clip(b.method, 2500) || "(not specified; infer the most suitable design from the title and gap, and say so in notes)"}
Data the authors have or can obtain: ${clip(b.dataAvail, 600) || "(not specified)"}

Numbered references (for the discussion plan only):
${papers || "(none)"}

${standardPromptText(P, "HP")}

Tasks:
1. "questions": 2–5 research questions or hypotheses derived from the gap and title, each {"id": "RQ1"/"H1", "text"} in ${L.name}. Use hypotheses (H1, H2, …) for confirmatory quantitative designs (e.g. SEM, regression, experiments), research questions otherwise.
2. "items": the ordered list of tables and figures the Results section must contain (5–10 items), each:
   {"id": "B1", "kind": "table" | "figure", "placement": "method" | "results", "question": the RQ/H id it answers or "-" for descriptive items, "caption": IEEE caption in ${L.name} without the "Table n"/"Fig. n" prefix, "analysis": the analysis or procedure that produces it (one sentence, ${L.name}), "columns": for tables, the exact column headers (2–7), "rows": for tables, row labels when they are known from the design (constructs, indicators, models, scenarios, themes; up to 12; otherwise []), "measures": metrics or statistics reported, "criteria": decision rule or conventional threshold, or "" if none, "data": what data, output, or file the authors must prepare (one sentence, Bahasa Indonesia), "standard": ids of the minimum-standard items above that this item satisfies}.
   Start with descriptive items (sample, informants, dataset, or system profile), then one or more items per RQ/H in order. Use "method" placement only for a research model, workflow, or architecture figure. Every REQUIRED Results item of the standard must be covered by at least one item.
3. "discussion": for each RQ/H, {"question", "refs": [reference numbers to compare with, 1–3, only when relevant], "aspect": what to compare or interpret (one sentence, ${L.name})}.
4. "notes": up to 3 short notes in Bahasa Indonesia on design decisions the authors must still make (e.g. minimum sample size, number of runs, which baseline). No outcome predictions.

JSON schema: {"questions":[{"id":"H1","text":"string"}],"items":[{"id":"B1","kind":"table","placement":"results","question":"H1","caption":"string","analysis":"string","columns":["string"],"rows":["string"],"measures":"string","criteria":"string","data":"string","standard":["S6"]}],"discussion":[{"question":"H1","refs":[3],"aspect":"string"}],"notes":["string"]}`;
  return { system, user };
}

const PREDICT = /\b(expected to (be )?(support|reject|accept|show|improve|outperform)|diharapkan (diterima|ditolak|meningkat|lebih baik|signifikan)|kemungkinan besar|likely (to )?(be )?(significant|supported|higher))/i;
export function cleanBlueprint(j, b) {
  const P = standardKey(b.profile);
  const std = standardItems(P);
  const stdIds = new Set(std.map((x) => x.id));
  const validNs = new Set(arr(b.papers).map((w) => Number(w.n)));
  const questions = arr(j?.questions).slice(0, 6).map((q, i) => ({ id: clip(q?.id, 8).toUpperCase() || `RQ${i + 1}`, text: clip(q?.text, 400) })).filter((q) => q.text);
  const qIds = new Set(questions.map((q) => q.id));
  const noNums = (s) => String(s || "").replace(/\b\d+[.,]\d+\b/g, "…"); // sel kerangka tidak boleh berisi angka hasil
  const items = arr(j?.items).slice(0, 12).map((x, i) => {
    const kind = String(x?.kind).toLowerCase() === "figure" ? "figure" : "table";
    const q = clip(x?.question, 8).toUpperCase();
    return {
      id: `B${i + 1}`, kind,
      placement: String(x?.placement).toLowerCase() === "method" ? "method" : "results",
      question: qIds.has(q) ? q : "-",
      caption: clip(x?.caption, 220),
      analysis: clip(x?.analysis, 300),
      columns: kind === "table" ? arr(x?.columns).slice(0, 8).map((c) => clip(noNums(c), 50)).filter(Boolean) : [],
      rows: kind === "table" ? arr(x?.rows).slice(0, 14).map((c) => clip(noNums(c), 60)).filter(Boolean) : [],
      measures: clip(x?.measures, 240),
      criteria: clip(x?.criteria, 200),
      data: clip(x?.data, 260),
      standard: [...new Set(arr(x?.standard).map((s) => clip(s, 6).toUpperCase()).filter((s) => stdIds.has(s)))],
      flag: PREDICT.test(`${x?.caption} ${x?.analysis} ${x?.criteria}`) ? "Mengandung dugaan hasil; sunting atau hapus kalimat itu." : "",
    };
  }).filter((x) => x.caption);
  const discussion = arr(j?.discussion).slice(0, 8).map((d) => ({
    question: qIds.has(clip(d?.question, 8).toUpperCase()) ? clip(d?.question, 8).toUpperCase() : "-",
    refs: arr(d?.refs).map(Number).filter((n) => validNs.has(n)).slice(0, 3),
    aspect: clip(d?.aspect, 300),
  })).filter((d) => d.aspect);
  const covered = new Set(items.flatMap((x) => x.standard));
  const uncovered = std.filter((x) => x.part === "H" && x.level === "wajib" && !covered.has(x.id)).map((x) => x.id);
  return { profile: P, questions, items, discussion, notes: arr(j?.notes).slice(0, 3).map((n) => clip(n, 300)).filter(Boolean), uncovered };
}

// Ringkasan rencana untuk prompt draf, hasil, dan reviewer (bahasa Inggris, tanpa angka).
export function blueprintText(bp, lang) {
  if (!bp || !arr(bp.items).length) return "";
  const id = lang === "id";
  let t = 1, f = 1;
  const lab = (x) => (x.kind === "table" ? `${id ? "Tabel" : "Table"} ${["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII"][t++]}` : `${id ? "Gambar" : "Fig."} ${f++}`);
  const ordered = [...arr(bp.items).filter((x) => x.placement === "method"), ...arr(bp.items).filter((x) => x.placement !== "method")];
  return `RESULTS PLAN agreed by the authors (planned structure only; no results yet):
Questions/hypotheses: ${arr(bp.questions).map((q) => `${q.id}: ${clip(q.text, 300)}`).join(" | ")}
${ordered.map((x) => `- ${lab(x)} [${x.placement}${x.question !== "-" ? `, answers ${x.question}` : ""}]: ${clip(x.caption, 200)}${x.columns?.length ? `; columns: ${x.columns.join(", ")}` : ""}${x.rows?.length ? `; rows: ${x.rows.join(", ")}` : ""}; analysis: ${clip(x.analysis, 200)}${x.criteria ? `; criteria: ${clip(x.criteria, 150)}` : ""}`).join("\n")}
Discussion plan: ${arr(bp.discussion).map((d) => `${d.question}: ${clip(d.aspect, 200)}${d.refs?.length ? ` (compare with ${d.refs.map((n) => `[${n}]`).join(", ")})` : ""}`).join(" | ")}`;
}
