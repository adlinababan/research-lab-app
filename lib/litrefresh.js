// Pembaruan literatur sebelum pembahasan final (Fase B):
// - "litq": dari temuan sebenarnya, AI menyusun kueri OpenAlex untuk mencari studi pembanding per temuan.
// - "discuss": setelah referensi baru ditambahkan, AI memperbarui paragraf pembanding dan interpretasi di
//   Hasil dan Pembahasan; paragraf hasil dan angka tidak boleh berubah.
import { LANG, ROLE_SETS, sanitizeCitations, ieeeLabel } from "./prompts.js";
import { sourceNumbers, unmatchedNumbers } from "./results.js";

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const arr = (a) => (Array.isArray(a) ? a : []);
const roleOf = (r) => (ROLE_SETS.results.includes(String(r || "").toLowerCase().trim()) ? String(r).toLowerCase().trim() : "");

export function litqPrompt(b) {
  const system = `You help Indonesian lecturers find prior studies to compare with their ACTUAL findings in the Discussion of an IEEE paper. Return ONLY valid JSON. No markdown.`;
  const user = `Title: ${clip(b.title, 300)}
Keywords: ${clip(b.keywords, 200)}
Research questions or hypotheses: ${arr(b.questions).map((q) => `${clip(q.id, 8)}: ${clip(q.text, 250)}`).join(" | ") || "(not stated)"}
Results paragraphs (actual findings):
${arr(b.results).slice(0, 8).map((p, i) => `(${i + 1}) ${clip(p, 1200)}`).join("\n")}

Task: identify 2–4 main findings (including unexpected or unsupported ones) and, for each, an OpenAlex search query of 3–8 English keywords that would find empirical studies reporting a comparable finding, method, or context. Do not copy the title verbatim; target the finding.
JSON schema: {"queries":[{"finding":"short description in Bahasa Indonesia, max 20 words","query":"english keywords"}]}`;
  return { system, user };
}
export function cleanLitq(j) {
  return { queries: arr(j?.queries).slice(0, 4).map((q) => ({ finding: clip(q?.finding, 200), query: clip(q?.query, 120).replace(/["']/g, "") })).filter((q) => q.finding && q.query.split(/\s+/).length >= 2) };
}

export function discussPrompt(b) {
  const L = LANG[b.lang] || LANG.en;
  const isNew = new Set(arr(b.newRefs).map(Number));
  const papers = arr(b.papers).slice(0, 35).map((w) => `[${w.n}]${isNew.has(Number(w.n)) ? " (NEW)" : ""} Name in text as: ${ieeeLabel(w)}. ${clip(w.title, 200)} (${w.year || "n.d."}). Abstract: ${clip(w.abstract, 500) || "(none)"}`).join("\n");
  const cur = arr(b.paragraphs).map((p, i) => `(${i + 1}) [${p.role || "unlabelled"}] ${clip(p.text, 2500)}`).join("\n");
  const system = `You are an IEEE paper editor updating the Discussion after the authors added newer or more closely comparable references. Hard rules:
- Keep every paragraph with role "results" or "limitation" EXACTLY as it is, word for word, in the same position.
- Only revise or add paragraphs with role "comparison" or "interpretation". Compare the authors' findings with the references only on what each reference's title or abstract states; never invent findings or numbers of other studies.
- Do not change any number reported from the authors' results. Cite only the listed numbers, IEEE style [n], one number per bracket, names without years. Use the NEW references where relevant, and keep existing citations that are still relevant.
- Return ONLY valid JSON. No markdown.`;
  const user = `Paper language: ${L.name}. Title: ${clip(b.title, 300)}
Current "${L.sections[3]}" section, paragraph by paragraph with roles:
${cur}

References (NEW = added after the results were written):
${papers}

Return the whole section in order. JSON schema: {"summary":"what changed and which new references were used (Bahasa Indonesia)","paragraphs":[{"role":"results|comparison|interpretation|limitation","text":"string"}]}`;
  return { system, user };
}
export function cleanDiscuss(j, b) {
  const validNs = arr(b.papers).map((w) => Number(w.n));
  const cur = arr(b.paragraphs);
  const ps = arr(j?.paragraphs).slice(0, 12).map((p) => (typeof p === "string" ? { role: "", text: p } : p))
    .map((p) => ({ role: roleOf(p?.role), text: sanitizeCitations(String(p?.text || "").replace(/\s+/g, " ").trim().slice(0, 3000), validNs) }))
    .filter((p) => p.text);
  const src = sourceNumbers([...cur.map((p) => p.text), ...arr(b.papers).map((w) => `${w.abstract || ""} ${w.year || ""}`)]);
  // Paragraf hasil/keterbatasan harus tetap sama persis.
  const outTexts = new Set(ps.map((p) => p.text.trim()));
  const altered = cur.filter((p) => ["results", "limitation"].includes(p.role) && !outTexts.has(String(p.text).trim())).map((p) => clip(p.text, 120));
  const used = new Set(ps.flatMap((p) => [...p.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))));
  return {
    summary: clip(j?.summary, 500),
    paragraphs: ps,
    flags: ps.map((p) => unmatchedNumbers(p.text, src, [])),
    altered,
    newUsed: arr(b.newRefs).map(Number).filter((n) => used.has(n)),
  };
}
