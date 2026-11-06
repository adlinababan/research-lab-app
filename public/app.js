// Research Lab — pelatihan riset berbantuan AI.
// Prinsip: judul milik peserta, tim penulis multidisiplin (1–6 penulis, 5 rumpun prodi), AI hanya membantu.
// Referensi hanya dari OpenAlex; angka hasil tidak dikarang; kontribusi dan data dinyatakan terbuka.
import { readUploads, saveFigs, loadFigs } from "./results-files.js";

const PRODI = ["Computer Science", "Information Systems", "Digital Business", "Visual Communication Design", "International Trade"];
// Nama lama (bahasa Indonesia) dari sesi tersimpan dipetakan ke nama bahasa Inggris.
const PRODI_OLD = { "Ilmu Komputer": "Computer Science", "Sistem Informasi": "Information Systems", "Bisnis Digital": "Digital Business", "Desain Komunikasi Visual": "Visual Communication Design" };
const fixProdi = (p) => PRODI_OLD[p] || p;
// Nilai sel matriks lama (Ya/Sebagian/Belum) dipetakan ke bahasa Inggris.
const CELL_OLD = { Ya: "Yes", Sebagian: "Partial", Belum: "No" };
const MAX_AUTHORS = 6;
const STEPS = [
  { title: "Peserta dan judul", sub: "Judul, tim penulis" },
  { title: "Literatur", sub: "Lintas prodi, OpenAlex" },
  { title: "Matriks gap", sub: "Temukan celah riset" },
  { title: "Judul dan draf", sub: "Saran judul, draf paper" },
  { title: "Integritas dan ekspor", sub: "Kontribusi, data, .docx" },
  { title: "Review IEEE", sub: "Reviewer, perbaikan" },
];
const MAX_PAPERS = 30;
const MIN_PAPERS = 15; // paper conference IEEE umumnya 15–30 referensi
const STORE_KEY = "research-lab-state-v3";
const CODE_KEY = "research-lab-access";
const KEYS_KEY = "research-lab-keys-v2"; // API key pengguna: hanya di browser ini, tidak ikut ekspor .json
const AUTH_KEY = "research-lab-auth"; // token login {token, user, exp}
// Login: draf, API key, dan gambar disimpan terpisah per akun (aman di komputer lab bersama).
function getAuth() {
  try { const a = JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); if (a?.token && a.exp > Date.now()) return a; } catch {}
  return null;
}
function setAuth(a) { try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch {} }
function clearAuth() { try { localStorage.removeItem(AUTH_KEY); } catch {} }
const scoped = (k) => { const a = getAuth(); return a ? `${k}:${a.user}` : k; };
const figNs = () => getAuth()?.user || "";
let loggedOutGate = false; // true saat login wajib tetapi belum masuk: jangan menyimpan apa pun

// Peran CRediT (taksonomi kontribusi penulis) dan padanan bahasa Indonesianya.
const CREDIT = {
  "conceptualization": "konseptualisasi", "data curation": "kurasi data", "formal analysis": "analisis formal",
  "funding acquisition": "perolehan pendanaan", "investigation": "investigasi", "methodology": "metodologi",
  "project administration": "administrasi proyek", "resources": "sumber daya", "software": "perangkat lunak",
  "supervision": "supervisi", "validation": "validasi", "visualization": "visualisasi",
  "writing—original draft": "penulisan—draf awal", "writing—review and editing": "penulisan—tinjauan dan penyuntingan",
};

// Departemen = sekaligus teks tercetak dan rumpun untuk referensi lintas prodi. "\n" = ganti baris di blok penulis.
const DEPTS = [
  { key: "cs", label: "Computer Science Department", dept: "Computer Science Department", faculty: "School of Computer Science", prodi: "Computer Science" },
  { key: "is", label: "Information Systems Department", dept: "Information Systems Department", faculty: "School of Information Systems", prodi: "Information Systems" },
  { key: "db", label: "Digital Business Department", dept: "Digital Business Department", faculty: "BINUS Business School\nUndergraduate Program", prodi: "Digital Business" },
  { key: "vcd", label: "Visual Communication Design Department", dept: "Visual Communication Design\nDepartment", faculty: "School of Design", prodi: "Visual Communication Design" },
  { key: "it", label: "International Trade Department", dept: "International Trade Department", faculty: "BINUS Business School\nUndergraduate Program", prodi: "International Trade" },
];
const oneLine = (t) => String(t || "").replace(/\s*\n\s*/g, " ");
const blankAuthor = () => ({ name: "", deptKey: "", prodi: "", dept: "", faculty: "", org: "", city: "", email: "" });
const defaultState = () => ({
  step: 0,
  me: { lang: "en", title: "", aim: "", method: "", approach: "", dataAvail: "", consent: false, authors: [blankAuthor()] },
  lit: { novelty: "", query: "", lens: "", yearFrom: 2016, sort: "relevance", results: [], total: 0, searched: false, selected: [], suggestions: [], perProdi: [], concepts: [] },
  gap: { matrix: null, gaps: [], chosen: -1, text: "" },
  draft: { keywords: "", data: null, originalTitle: "", titleSugs: [], keywordSugs: [], guideChecks: {}, methodSugs: [], methodChosen: -1, methodApproach: "" },
  exp: {
    ack: "", ackEdited: false, checks: {},
    contrib: [""], contribAi: false,
    od: { type: "", name: "", source: "", url: "", reason: "" },
  },
  meta: { model: "", label: "" },
  review: { data: null, done: [] }, // hasil "Review sebagai reviewer IEEE"
  results: { items: null, sug: null, applied: null, dec: "", profile: "" }, // hasil analisis milik dosen (ZIP)
  prompts: {}, // prompt terakhir per tugas AI, untuk tombol "Lihat prompt AI"
});

let config = null;
const busy = {};
const errors = {};
let state = load();

// ---------- penyimpanan lokal ----------
function load() {
  try {
    const raw = localStorage.getItem(scoped(STORE_KEY));
    if (raw) {
      const s = deepMerge(defaultState(), JSON.parse(raw));
      s.me.authors = (s.me.authors.length ? s.me.authors : [blankAuthor()]).slice(0, MAX_AUTHORS).map((a) => ({ ...blankAuthor(), ...a }));
      s.me.authors.forEach((a) => {
        a.prodi = fixProdi(a.prodi);
        if (!a.deptKey) {
          const d = DEPTS.find((x) => x.prodi === a.prodi);
          if (d) Object.assign(a, { deptKey: d.key, dept: d.dept, faculty: d.faculty });
          else if (a.dept) Object.assign(a, { deptKey: "other", prodi: a.prodi || a.dept.trim() });
        }
      });
      s.lit.selected.forEach((w) => { w.prodi = fixProdi(w.prodi || ""); });
      s.lit.lens = fixProdi(s.lit.lens || ""); s.lit.lastLens = fixProdi(s.lit.lastLens || "");
      s.gap.matrix?.rows?.forEach((r) => { r.cells = r.cells.map((c) => CELL_OLD[c] || c); });
      syncContrib(s);
      return s;
    }
  } catch {}
  return defaultState();
}
// Panjang isian kontribusi selalu mengikuti jumlah penulis.
function syncContrib(s = state) {
  const n = s.me.authors.length;
  s.exp.contrib = Array.from({ length: n }, (_, i) => s.exp.contrib[i] || "");
}
function deepMerge(base, extra) {
  for (const k of Object.keys(extra || {})) {
    if (base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) && extra[k] && typeof extra[k] === "object" && !Array.isArray(extra[k])) deepMerge(base[k], extra[k]);
    else base[k] = extra[k];
  }
  return base;
}
let saveTimer = null;
function flushSave() { clearTimeout(saveTimer); if (loggedOutGate) return; try { localStorage.setItem(scoped(STORE_KEY), JSON.stringify(state)); } catch {} }
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 250); }
window.addEventListener("pagehide", flushSave);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSave(); });

// ID acak per perangkat, hanya untuk pembatas laju di server (bukan identitas peserta).
let memClientId = "";
function clientId() {
  try {
    let id = localStorage.getItem("research-lab-client");
    if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); localStorage.setItem("research-lab-client", id); }
    return id;
  } catch { return memClientId || (memClientId = String(Math.random()).slice(2) + Date.now()); }
}
function accessCode() { try { return localStorage.getItem(CODE_KEY) || ""; } catch { return ""; } }
let memKeys = { ai: "", openalex: "" };
function getKeys() {
  try { const k = JSON.parse(localStorage.getItem(scoped(KEYS_KEY)) || "null"); if (k) return { ai: k.ai || "", openalex: k.openalex || "" }; } catch {}
  return memKeys;
}
function setKeys(k) {
  memKeys = { ai: (k.ai || "").trim(), openalex: (k.openalex || "").trim() };
  if (loggedOutGate) return;
  try { localStorage.setItem(scoped(KEYS_KEY), JSON.stringify(memKeys)); } catch {}
}
function clearKeys() { memKeys = { ai: "", openalex: "" }; try { localStorage.removeItem(scoped(KEYS_KEY)); } catch {} }
function keyKind(k) { return k.startsWith("sk-or-") ? "OpenRouter" : k.startsWith("AIza") ? "Gemini" : k ? "tidak dikenal" : ""; }
function serverHasKey() { return Boolean(config && (config.mock || config.llm?.configured)); }
function hasAiKey() { return !config || serverHasKey() || ["OpenRouter", "Gemini"].includes(keyKind(getKeys().ai)); }
function serverHasOpenAlex() { return Boolean(config && (config.mock || config.openalexKey)); }
const okOpenAlexFormat = (k) => /^[A-Za-z0-9_\-]{10,200}$/.test(k || "");
function hasOpenAlexKey() { return !config || serverHasOpenAlex() || okOpenAlexFormat(getKeys().openalex); }
let keyCheck = { ai: null, openalex: null }; // hasil tombol "Cek kedua key"

// ---------- utilitas ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const words = (s) => (String(s || "").trim().match(/\S+/g) || []).length;
const PH_RE = /\[(?!\d+\])[^[\]]+\]/g;
const CITE_RE = /\[(\d+)\]/g;
const isId = () => state.me.lang === "id";
// Penghitung yang ikut terlihat saat menggulir hasil pencarian.
function selPill(k) {
  const done = k >= MIN_PAPERS;
  const msg = done ? `✓ Sudah memilih ${k} referensi` : `Terpilih ${k} / minimal ${MIN_PAPERS}, kurang ${MIN_PAPERS - k}`;
  return `<div class="sel-pill${done ? " done" : ""}" role="status" aria-live="polite">${msg}<span class="hint"> · maks. ${MAX_PAPERS}</span></div>`;
}
function toast(msg, opt = {}) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  t.classList.toggle("ok", !!opt.ok);
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), opt.ms || 3200);
}
function setPath(obj, path, val) {
  const ks = path.split("."); const last = ks.pop();
  ks.reduce((o, k) => o[k], obj)[last] = val;
}
function shortAuthors(a) {
  if (!a?.length) return "Penulis tidak tercantum";
  return a.length > 3 ? `${a.slice(0, 3).join(", ")}, dkk.` : a.join(", ");
}
const teamProdi = () => [...new Set(state.me.authors.map((a) => a.prodi).filter(Boolean))];
const authorsNamed = () => state.me.authors.filter((a) => a.name.trim()).length;
const authorDone = (a) => a.name.trim() && a.deptKey && (a.deptKey !== "other" || (a.dept.trim() && a.faculty.trim()));
const authorsOk = () => state.me.authors.length >= 1 && state.me.authors.every(authorDone);
const litProdi = () => [...new Set(state.lit.selected.map((w) => w.prodi).filter(Boolean))];
const ctx = () => ({ title: state.me.title, aim: state.me.aim, prodi: teamProdi() });
// Literatur hanya berdasar rumpun prodi yang terwakili di tim penulis.
const lensProdi = () => teamProdi();
const needLitProdi = () => Math.min(2, Math.max(1, teamProdi().length));
const paperPayload = (full) => state.lit.selected.map((w) => full
  ? { n: w.n, title: w.title, year: w.year, authors: w.authors, venue: w.venue, abstract: w.abstract, prodi: w.prodi || "" }
  : { n: w.n, title: w.title, year: w.year, authors: (w.authors || []).slice(0, 3), abstract: w.abstract, prodi: w.prodi || "" });
function joinList(items) {
  const and = isId() ? "dan" : "and";
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} ${and} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${and} ${items[items.length - 1]}`;
}
// Cakupan rumpun tim pada referensi terpilih (hanya rumpun yang terwakili di tim).
function teamChips(present) {
  const team = teamProdi();
  return `<div class="row" style="align-items:center;gap:6px"><span class="hint">Rumpun tim pada referensi:</span>${team.map((p) => present.includes(p)
    ? `<span class="tag" style="background:var(--ok-tint);color:var(--ok)">✓ ${esc(p)}</span>`
    : `<span class="tag muted">${esc(p)}</span>`).join("")}</div>`;
}
function prodiChips(present, label) {
  // Lima rumpun bawaan + rumpun "Other" yang diisi manual oleh penulis.
  const all = [...PRODI, ...present.filter((p) => !PRODI.includes(p))];
  return `<div class="row" style="align-items:center;gap:6px"><span class="hint">${label}</span>${all.map((p) => present.includes(p)
    ? `<span class="tag" style="background:var(--ok-tint);color:var(--ok)">✓ ${esc(p)}</span>`
    : `<span class="tag muted">${esc(p)}</span>`).join("")}</div>`;
}

async function api(path, body, { raw = false } = {}) {
  const h = { "Content-Type": "application/json", "x-access-code": accessCode(), "x-client-id": clientId() };
  const au = getAuth(); if (au) h["x-auth-token"] = au.token;
  const k = getKeys();
  if (k.ai) h["x-ai-key"] = k.ai;
  if (k.openalex) h["x-openalex-key"] = k.openalex;
  if (path === "/api/llm" && body) body = { ...body, model: chosenModel() };
  const resp = await fetch(path, { method: body ? "POST" : "GET", headers: h, body: body ? JSON.stringify(body) : undefined });
  if (resp.status === 401) {
    let d = null; try { d = await resp.clone().json(); } catch {}
    if (d?.code === "login") { logout(true); throw new Error("Silakan masuk dengan username dan password."); }
    showAccess(true); throw new Error("Kode akses diperlukan.");
  }
  if (raw && resp.ok) return resp;
  let data = null;
  try { data = await resp.json(); } catch {}
  if (!resp.ok) throw new Error(data?.error || `Server mengembalikan status ${resp.status}.`);
  if (path === "/api/llm" && body?.task && data?.prompt) state.prompts[body.task] = data.prompt;
  return data;
}

// ---------- penomoran sitasi (IEEE: urutan kemunculan) ----------
function citationMap() {
  const sections = state.draft.data?.sections || [];
  const rows = state.gap.matrix?.rows || [];
  const valid = new Set(state.lit.selected.map((w) => w.n));
  const order = [];
  const seen = new Set();
  const visit = (n) => { if (valid.has(n) && !seen.has(n)) { seen.add(n); order.push(n); } };
  sections.forEach((s, i) => {
    for (const p of s.paragraphs || []) for (const m of String(p).matchAll(CITE_RE)) visit(Number(m[1]));
    if (i === 1) for (const r of rows) visit(Number(r.n));
  });
  return { order, map: new Map(order.map((n, i) => [n, i + 1])) };
}
function renderRich(text, map) {
  let t = esc(text);
  t = t.replace(/\[(\d+)\]/g, (m, n) => (map ? (map.has(Number(n)) ? `[${map.get(Number(n))}]` : "") : m));
  return t.replace(/\[(?!\d+\])[^[\]]+\]/g, (m) => `<mark>${m}</mark>`);
}
function ieeeAuthors(authors) {
  const ini = (name) => {
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const last = parts.pop();
    return `${parts.map((p) => p.split("-").map((s) => (s ? s[0].toUpperCase() + "." : "")).join("-")).join(" ")} ${last}`;
  };
  const a = (authors || []).map(ini);
  if (!a.length) return "";
  if (a.length > 6) return `${a[0]} et al.`;
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`;
}
// Rapikan judul/nama berhuruf kapital semua dari metadata (sama dengan lib/openalex.js).
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "via", "with", "dan", "di", "ke", "dari", "untuk", "pada", "yang", "dengan"]);
function fixTitleCaps(t) {
  const s = String(t || ""); const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 8 || letters !== letters.toUpperCase()) return s;
  return s.toLowerCase().replace(/[A-Za-z][^\s\-/]*/g, (w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w[0].toUpperCase() + w.slice(1)));
}
const fixNameCaps = (n) => String(n || "").replace(/\b([A-Z])([A-Z]{2,})\b/g, (m, a, b) => a + b.toLowerCase());
function ieeeRefHtml(w) {
  const au = ieeeAuthors((w.authors || []).map(fixNameCaps));
  const tail = [];
  if (w.volume) tail.push(`vol. ${esc(w.volume)}`);
  if (w.issue) tail.push(`no. ${esc(w.issue)}`);
  if (w.firstPage && w.lastPage && w.firstPage !== w.lastPage) tail.push(`pp. ${esc(w.firstPage)}–${esc(w.lastPage)}`);
  else if (w.firstPage) tail.push(`p. ${esc(w.firstPage)}`);
  if (w.year) tail.push(w.year);
  if (w.doi) tail.push(`doi: <a href="https://doi.org/${esc(w.doi)}" target="_blank" rel="noopener">${esc(w.doi)}</a>`);
  return `${au ? esc(au) + ", " : ""}“${esc(fixTitleCaps(w.title))},” ${w.venue ? `<i>${esc(w.venue)}</i>, ` : ""}${tail.join(", ")}.`;
}

// ---------- pernyataan: AI, kontribusi, data ----------
function disclosure() {
  const sys = `${state.meta.label || config?.llm?.label || "[nama sistem AI]"}${state.meta.model ? ` (${state.meta.model})` : ""}`;
  const contrib = state.exp.contribAi;
  if (isId()) {
    return `Penulis menggunakan sistem AI generatif ${sys} melalui aplikasi Research Lab untuk mengusulkan kata kunci pencarian, menyusun matriks gap (Tabel I), menyarankan alternatif judul, ${contrib ? "mengusulkan pembagian peran kontribusi, " : ""}dan menyusun draf awal seluruh bagian naskah. Judul, arah penelitian, dan pembagian kontribusi ditetapkan oleh penulis. Literatur diambil dari basis data OpenAlex. Seluruh referensi telah diverifikasi dan seluruh isi telah ditinjau serta disunting oleh penulis, yang bertanggung jawab penuh atas naskah ini. [Sesuaikan dengan kontribusi AI yang sebenarnya dan tambahkan pendanaan bila ada.]`;
  }
  return `The authors used the generative AI system ${sys}, through the Research Lab application, to suggest search keywords, build the gap matrix (Table I), suggest alternative titles, ${contrib ? "propose a division of contributor roles, " : ""}and prepare an initial draft of all sections of this paper. The title, research direction, and contributor roles were decided by the authors. Literature was retrieved from the OpenAlex database. All references were verified, and all content was reviewed and edited by the authors, who take full responsibility for this paper. [Adjust to the actual extent of AI use and add funding information if any.]`;
}
function contribStatement() {
  const rows = state.me.authors.map((a, i) => ({
    name: a.name.trim() || `[${isId() ? "Penulis" : "Author"} ${i + 1}]`,
    items: String(state.exp.contrib[i] || "").split(",").map((s) => s.trim()).filter(Boolean),
  }));
  const parts = rows.map((r, i) => {
    const what = r.items.length ? joinList(r.items) : `[${isId() ? "kontribusi" : "contribution"}]`;
    return i === 0 ? `${r.name} ${isId() ? "berkontribusi pada" : "contributed to"} ${what}` : `${r.name} ${isId() ? "pada" : "to"} ${what}`;
  });
  if (parts.length === 1) return `${parts[0]}.`;
  return `${parts.slice(0, -1).join("; ")}; ${isId() ? "dan" : "and"} ${parts[parts.length - 1]}.`;
}
function openDataStatement() {
  const o = state.exp.od;
  if (!o.type) return isId() ? "[Pilih jenis data di bagian Open Data]" : "[Choose the data type in the Open Data section]";
  const ph = (v, en, id) => (v.trim() ? v.trim() : `[${isId() ? id : en}]`);
  const name = ph(o.name, "dataset name", "nama dataset");
  const source = ph(o.source, "repository or provider", "repositori atau penyedia");
  const url = ph(o.url, "URL or DOI", "URL atau DOI");
  const reason = ph(o.reason, "privacy or ethical restrictions", "alasan privasi atau etika");
  if (o.type === "own") {
    return isId()
      ? `Data yang mendukung temuan penelitian ini tersedia secara terbuka di ${source} pada ${url}.`
      : `The data supporting the findings of this study are openly available in ${source} at ${url}.`;
  }
  if (o.type === "restricted") {
    return isId()
      ? `Data penelitian ini tidak tersedia untuk publik karena ${reason}, tetapi dapat diperoleh dari penulis korespondensi atas permintaan yang wajar.`
      : `The data of this study are not publicly available due to ${reason}, but are available from the corresponding author upon reasonable request.`;
  }
  return isId()
    ? `Penelitian ini menggunakan ${name} yang bersifat akses terbuka dari ${source} (${url}) sesuai dengan kebijakan penggunaannya.`
    : `This study utilized the open-access ${name} from ${source} (${url}) in accordance with its usage policy.`;
}

// ---------- status langkah ----------
function stepDone(i) {
  switch (i) {
    case 0: return Boolean(state.me.consent && state.me.title.trim() && hasAiKey() && hasOpenAlexKey() && authorsOk() && teamProdi().length >= 1);
    case 1: return state.lit.selected.length >= MIN_PAPERS && litProdi().filter((p) => teamProdi().includes(p)).length >= needLitProdi();
    case 2: return Boolean(state.gap.text.trim());
    case 3: return Boolean(state.draft.data);
    case 4: return Boolean(state.draft.data) && MANUAL_CHECKS.every(([k]) => state.exp.checks[k]) && Boolean(state.exp.od.type);
    default: return false;
  }
}
// Langkah berurutan: langkah i hanya bisa dibuka bila semua langkah sebelumnya selesai.
function firstOpenStep() {
  for (let k = 0; k < STEPS.length - 1; k++) if (!stepDone(k)) return k;
  return STEPS.length - 1;
}
const stepUnlocked = (i) => i <= firstOpenStep();
function goto(i) {
  i = Math.max(0, Math.min(STEPS.length - 1, i));
  if (!stepUnlocked(i)) {
    const need = firstOpenStep();
    toast(`Selesaikan langkah ${need + 1} (${STEPS[need].title}) terlebih dahulu.`);
    i = need;
  }
  state.step = i;
  save(); render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  $("#main").focus({ preventScroll: true });
}

// ---------- render ----------
function render() {
  $("#stepper").innerHTML = STEPS.map((s, i) => {
    const locked = !stepUnlocked(i);
    return `
    <button type="button" class="step-link ${stepDone(i) ? "done" : ""} ${locked ? "locked" : ""}" data-act="goto" data-i="${i}" ${state.step === i ? 'aria-current="step"' : ""} ${locked ? `disabled aria-disabled="true" title="Selesaikan langkah ${firstOpenStep() + 1} terlebih dahulu"` : ""}>
      <span class="step-num">${stepDone(i) ? "✓" : i + 1}</span>
      <span class="step-text"><span class="step-title">${s.title}</span><br><span class="step-sub">${s.sub}</span></span>
    </button>`;
  }).join("");
  const views = [viewMe, viewLiterature, viewGap, viewDraft, viewExport, viewReview];
  $("#main").innerHTML = views[state.step]();
}
function header(i, title, lede) {
  return `<div><div class="eyebrow">Langkah ${i + 1} dari ${STEPS.length} · ${STEPS[i].sub}</div><h1 class="step-h">${title}</h1><p class="lede">${lede}</p></div>`;
}
function errBox(key) { return errors[key] ? `<div class="alert err" role="alert">${esc(errors[key])}</div>` : ""; }
function btn(act, label, { kind = "ai", disabled = false, busyLabel = "AI sedang bekerja…" } = {}) {
  const b = busy[act];
  return `<button type="button" class="btn ${kind}" data-act="${act}" ${disabled || b ? "disabled" : ""}>${b ? `<span class="spin" aria-hidden="true"></span>${busyLabel}` : label}</button>`;
}
function navRow(nextLabel = "Lanjut") {
  const nextOk = stepDone(state.step);
  return `<div class="nav-row">
    ${state.step > 0 ? `<button type="button" class="btn ghost" data-act="goto" data-i="${state.step - 1}">← Kembali</button>` : "<span></span>"}
    ${state.step < STEPS.length - 1 ? `<button type="button" class="btn primary" data-act="goto" data-i="${state.step + 1}" ${nextOk ? "" : "disabled"}>${nextLabel} →</button>` : ""}
  </div>`;
}

// ---------- kartu API key ----------
const TAG = {
  ok: (t) => `<span class="tag" style="background:var(--ok-tint);color:var(--ok)">${t}</span>`,
  bad: (t) => `<span class="tag" style="background:var(--err-tint);color:var(--err)">${t}</span>`,
  mid: (t) => `<span class="tag muted">${t}</span>`,
};
function aiTag() {
  if (keyCheck.ai) return keyCheck.ai.ok ? TAG.ok("Terverifikasi") : TAG.bad("Bermasalah");
  const kind = keyKind(getKeys().ai);
  if (kind === "OpenRouter" || kind === "Gemini") return TAG.mid("Key terisi");
  if (kind) return TAG.bad("Format tidak dikenal");
  return serverHasKey() ? TAG.mid("Opsional (server punya key)") : TAG.bad("Wajib diisi");
}
function oaTag() {
  if (keyCheck.openalex) return keyCheck.openalex.ok ? TAG.ok("Terverifikasi") : TAG.bad("Bermasalah");
  const k = getKeys().openalex;
  if (okOpenAlexFormat(k)) return TAG.mid("Key terisi");
  if (k) return TAG.bad("Format tidak dikenal");
  return serverHasOpenAlex() ? TAG.mid("Opsional (server punya key)") : TAG.bad("Wajib diisi");
}
function checkOut() {
  // Berhasil cukup "Ready!"; bila gagal, tampilkan penjelasan lengkap.
  const row = (name, r) => r ? `<div class="alert ${r.ok ? "ok" : "err"}"><b>${name}:</b> ${r.ok ? "Ready!" : esc(r.msg)}</div>` : "";
  return row("Research Lab key", keyCheck.ai) + row("OpenAlex", keyCheck.openalex);
}
// Pilihan model disimpan per perangkat; server hanya menerima model yang diizinkan.
const MODEL_KEY = "research-lab-model";
function modelList() {
  const models = config?.openrouterModels || [];
  const locked = config?.lockedModel;
  if (!locked) return models;
  return models.some((m) => m.id === locked) ? models.map((m) => m.id === locked ? { ...m, selectable: true } : m) : [{ id: locked, label: locked, selectable: true }, ...models];
}
function chosenModel() {
  let v = "";
  try { v = localStorage.getItem(MODEL_KEY) || ""; } catch {}
  return modelList().some((m) => m.id === v && m.selectable) ? v : (config?.lockedModel || "");
}
function modelNote() {
  const m = modelList().find((x) => x.id === chosenModel());
  return m?.free ? "Model gratis dibatasi OpenRouter sekitar 20 permintaan per menit untuk satu akun. Bila muncul pesan dibatasi, kembali ke Gemini 2.5 Flash-Lite." : "";
}
function modelPicker() {
  const list = modelList();
  if (!list.length) return "";
  const cur = chosenModel();
  const note = modelNote();
  return `<div style="max-width:640px;display:flex;flex-direction:column;gap:4px"><select data-act="model" aria-label="Model AI">${list.map((m) => `<option value="${esc(m.id)}" ${m.id === cur ? "selected" : ""} ${m.selectable ? "" : "disabled"}>${esc(m.label)}</option>`).join("")}</select><span class="hint" id="modelNote" ${note ? "" : "hidden"}>${esc(note)}</span></div>`;
}
function keyCard() {
  const k = getKeys();
  const step = (items) => `<ol style="margin:6px 0 0;padding-left:20px;font-size:14px;display:flex;flex-direction:column;gap:4px">${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
  return `
    <section class="card" id="keyCard">
      <div class="row" style="justify-content:space-between;align-items:center"><h3>API key Anda</h3><span class="hint">Disimpan hanya di browser ini</span></div>
      <p class="hint" style="margin:0">Setiap peserta memakai dua key: <b>Research Lab key</b> untuk AI (dibagikan narasumber) dan <b>OpenAlex</b> untuk mencari literatur. Setelah menempel keduanya, klik <b>Cek kedua key</b>.</p>
      <div class="grid2">
        <div class="keybox">
          <div class="row" style="justify-content:space-between;align-items:center"><b>1. Research Lab key (AI)</b><span id="tagAi">${aiTag()}</span></div>
          <input type="password" autocomplete="off" spellcheck="false" data-act="key-ai" value="${esc(k.ai)}" placeholder="Tempel Research Lab key" aria-label="Research Lab key">
        </div>
        <div class="keybox">
          <div class="row" style="justify-content:space-between;align-items:center"><b>2. OpenAlex (literatur)</b><span id="tagOa">${oaTag()}</span></div>
          <input type="password" autocomplete="off" spellcheck="false" data-act="key-openalex" value="${esc(k.openalex)}" placeholder="Key dari openalex.org/settings/api" aria-label="API key OpenAlex">
          <details ${k.openalex ? "" : "open"}><summary>Cara daftar dan membuat key (gratis)</summary>${step([
            'Buka <a href="https://openalex.org" target="_blank" rel="noopener">openalex.org</a> dan buat akun gratis (menu masuk/daftar di kanan atas).',
            'Setelah masuk, buka <a href="https://openalex.org/settings/api" target="_blank" rel="noopener">openalex.org/settings/api</a>.',
            'Salin API key dan tempel di sini. Kuota gratis US$1 per hari, sekitar 1.000 pencarian.',
          ])}</details>
        </div>
      </div>
      ${modelPicker()}
      <div class="row" style="align-items:center">
        ${btn("check-keys", "Cek kedua key", { kind: "ai", busyLabel: "Memeriksa…" })}
        <button type="button" class="btn ghost small" data-act="clear-keys" ${k.ai || k.openalex ? "" : "disabled"}>Hapus key dari perangkat ini</button>
      </div>
      <div id="keyCheckOut" style="display:flex;flex-direction:column;gap:8px">${checkOut()}</div>
      <p class="hint" style="margin:0">Key diteruskan ke layanan AI dan OpenAlex hanya saat dipakai; server aplikasi tidak menyimpannya. Klik <b>Hapus key</b> setelah sesi bila memakai komputer bersama.</p>
    </section>`;
}

// Peringatan isian penulis (format IEEE): kota tanpa negara, atau afiliasi berbahasa Indonesia di naskah berbahasa Inggris.
const ID_WORDS = /\b(jurusan|fakultas|program studi|prodi|teknologi|teknik|rekayasa|perangkat|lunak|sistem|informatika|ilmu|komputer|bisnis|desain|perdagangan|manajemen|ekonomi|akuntansi|dan)\b/i;
function authorIssues(a) {
  const out = [];
  if (a.city.trim() && !a.city.includes(",")) out.push(`Kota belum memuat negara: tulis "${a.city.trim()}, Indonesia".`);
  if (!isId()) {
    // Nama institusi (mis. "Politeknik Negeri Medan") boleh tetap dalam bahasa aslinya.
    const bad = [["departemen", a.dept], ["fakultas", a.faculty]].filter(([, v]) => ID_WORDS.test(String(v || ""))).map(([k]) => k);
    if (bad.length) out.push(`Naskah berbahasa Inggris, tetapi ${bad.join(", ")} masih berbahasa Indonesia. Pakai nama resmi berbahasa Inggris, mis. "Department of Computer and Informatics Engineering". Nama institusi boleh tetap.`);
  }
  return out;
}
function authorWarn(a) {
  const w = authorIssues(a);
  return `<div class="author-warn" ${w.length ? "" : "hidden"}>${w.map((t) => `<div class="alert warn">${esc(t)}</div>`).join("")}</div>`;
}

// ---------- Langkah 1 ----------
function viewMe() {
  const m = state.me;
  const rows = m.authors.map((a, i) => `
    <div class="author-row">
      <span class="author-n">${i + 1}</span>
      <div class="author-fields">
        <label class="field"><span>Nama lengkap *</span><input data-bind="me.authors.${i}.name" value="${esc(a.name)}" autocomplete="off" placeholder="Nama Anda"></label>
        <label class="field"><span>Departemen *</span><select data-act="dept-select" data-i="${i}"><option value="">Pilih departemen</option>${DEPTS.map((d) => `<option value="${d.key}" ${a.deptKey === d.key ? "selected" : ""}>${esc(d.label)}</option>`).join("")}<option value="other" ${a.deptKey === "other" ? "selected" : ""}>Other (isi manual)</option></select></label>
        ${a.deptKey === "other"
          ? `<label class="field"><span>Nama departemen / prodi *</span><input data-bind="me.authors.${i}.dept" value="${esc(a.dept)}" placeholder="mis. Department of Management"></label>
        <label class="field"><span>Fakultas / school *</span><input data-bind="me.authors.${i}.faculty" value="${esc(a.faculty)}" placeholder="mis. Faculty of Economics and Business"></label>`
          : `<label class="field"><span>Fakultas / school (otomatis)</span><input value="${esc(oneLine(a.faculty))}" readonly tabindex="-1" placeholder="Terisi setelah memilih departemen" class="readonly"></label>`}
        <label class="field"><span>Universitas / institusi</span><input data-bind="me.authors.${i}.org" value="${esc(a.org)}" placeholder="mis. Bina Nusantara University"></label>
        <label class="field"><span>Kota, negara</span><input data-bind="me.authors.${i}.city" value="${esc(a.city)}" placeholder="mis. Jakarta, Indonesia"></label>
        <label class="field"><span>Email atau ORCID</span><input data-bind="me.authors.${i}.email" value="${esc(a.email)}" placeholder="nama@binus.ac.id atau ORCID 0000-0000-0000-0000"></label>
        ${authorWarn(a)}
      </div>
      ${m.authors.length > 1 ? `<button type="button" class="btn ghost small author-del" data-act="del-author" data-i="${i}" aria-label="Hapus penulis ${i + 1}">Hapus</button>` : "<span></span>"}
    </div>`).join("");
  return `
    ${header(0, "Judul penelitian dan tim penulis", "Tulis judul Anda sendiri dan isi tim penulis (1–6 orang). Aplikasi akan mencarikan referensi lintas prodi di OpenAlex, membantu menemukan gap, lalu menyusun draf paper.")}
    <section class="card disclaimer ${m.consent ? "ok" : ""}">
      <h2>Disclaimer: ini latihan</h2>
      <ul class="disc-list">
        <li>Research Lab dipakai untuk <b>berlatih alur kerja</b>, bukan membuat naskah siap kirim.</li>
        <li>Draf AI adalah <b>kerangka</b>: semua temuan masih [placeholder], dan AI bisa keliru.</li>
        <li><b>Jangan langsung submit.</b> Tulis ulang dengan kata dan analisis sendiri, isi data asli, dan verifikasi setiap referensi.</li>
        <li>Tanggung jawab ilmiah tetap pada penulis, sesuai prinsip FAITH BINUS dan kebijakan venue tujuan.</li>
      </ul>
      <label class="check-pill consent"><input type="checkbox" data-act="consent" ${m.consent ? "checked" : ""}>Saya memahami bahwa draf ini untuk latihan, bukan untuk langsung dikirim ke jurnal atau konferensi.</label>
    </section>
    ${keyCard()}
    <section class="card human">
      <h2>Ide penelitian</h2>
      <label class="field"><span>Judul penelitian (wajib)</span><textarea data-bind="me.title" rows="2" placeholder="mis. Pengaruh Motif Batik pada Kemasan terhadap Niat Beli Konsumen Mancanegara">${esc(m.title)}</textarea></label>
      <label class="field"><span>Tujuan atau pertanyaan penelitian (opsional, membantu AI lebih tepat)</span><textarea data-bind="me.aim" rows="2">${esc(m.aim)}</textarea></label>
      <p class="hint" style="margin:0">Rencana data dan metode diisi di langkah 4, setelah gap dipilih, agar metode menjawab gap.</p>
      <div class="field"><span>Bahasa naskah</span>
        <div class="checks">
          <label class="check-pill"><input type="radio" name="lang" data-act="lang" value="en" ${m.lang === "en" ? "checked" : ""}>English (IEEE)</label>
          <label class="check-pill"><input type="radio" name="lang" data-act="lang" value="id" ${m.lang === "id" ? "checked" : ""}>Bahasa Indonesia</label>
        </div>
      </div>
    </section>
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3>Tim penulis <span class="counter" id="authorCount">${m.authors.length}/${MAX_AUTHORS}</span></h3>
        ${m.authors.length > 1 ? '<button type="button" class="btn ghost small" data-act="copy-org">Salin universitas dan kota penulis 1 ke yang kosong</button>' : ""}
      </div>
      <div id="prodiCover">${prodiChips(teamProdi(), "Rumpun prodi terwakili:")}</div>
      <p class="hint" style="margin:0">Maksimal ${MAX_AUTHORS} penulis. Urutan di sini menjadi urutan penulis di template IEEE (tiga penulis per baris). Baris yang kosong tidak dicetak.</p>
      <div class="authors">${rows}</div>
      ${m.authors.length < MAX_AUTHORS ? `<div><button type="button" class="btn ghost small" data-act="add-author">+ Tambah penulis (${m.authors.length}/${MAX_AUTHORS})</button></div>` : ""}
    </section>
    <div id="meAlerts">${meAlerts()}</div>
    ${navRow("Lanjut cari literatur")}`;
}
function meAlerts() {
  const a = [];
  if (!state.me.title.trim()) a.push("Isi judul penelitian untuk melanjutkan.");
  if (!hasAiKey()) a.push("Tempel Research Lab key di bagian atas halaman ini.");
  if (!hasOpenAlexKey()) a.push("Tempel API key OpenAlex di bagian atas halaman ini.");
  if (!authorsOk()) a.push(`Lengkapi nama dan departemen setiap penulis (${state.me.authors.filter(authorDone).length}/${state.me.authors.length} lengkap). Bila memilih Other, isi juga nama departemen dan fakultasnya.`);
  return a.map((t) => `<div class="alert warn">${t}</div>`).join("");
}

// ---------- Langkah 2 ----------
function prodiSelect(act, value, extra = "", emptyLabel = "Belum ditandai") {
  const opts = teamProdi().length ? teamProdi() : PRODI;
  const list = value && !opts.includes(value) ? [...opts, value] : opts;
  return `<select data-act="${act}" ${extra}><option value="">${emptyLabel}</option>${list.map((p) => `<option ${value === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>`;
}
function viewLiterature() {
  const L = state.lit;
  const selIds = new Set(L.selected.map((w) => w.id));
  const list = L.results.map((w) => `
    <div class="work">
      <input type="checkbox" data-act="toggle-work" data-id="${esc(w.id)}" ${selIds.has(w.id) ? "checked" : ""} aria-label="Pilih makalah">
      <div style="min-width:0">
        <div class="t">${esc(w.title)}</div>
        <div class="s">${esc(shortAuthors(w.authors))} · ${w.year || "t.t."}${w.venue ? ` · <i>${esc(w.venue)}</i>` : ""} · dikutip ${w.citedBy}×</div>
        <div class="s">DOI: <a href="https://doi.org/${esc(w.doi)}" target="_blank" rel="noopener">${esc(w.doi)}</a> ${w.field ? `<span class="tag">${esc(w.field)}</span>` : ""} ${w.abstract ? "" : '<span class="tag muted">tanpa abstrak</span>'}</div>
        ${w.abstract ? `<details><summary>Abstrak</summary><p class="abs">${esc(w.abstract)}</p></details>` : ""}
      </div>
    </div>`).join("");
  const sel = L.selected.map((w) => `
    <li class="sel-row"><span class="n">[${w.n}]</span>
      <span style="min-width:0">${esc(w.title)} <span class="hint">(${w.year || "t.t."}${w.field ? ` · ${esc(w.field)}` : ""})</span>${w.abstract ? "" : ' <span class="tag muted">tanpa abstrak</span>'}</span>
      ${prodiSelect("tag-prodi", w.prodi, `data-id="${esc(w.id)}" aria-label="Prodi untuk referensi ${w.n}"`)}
      <button type="button" class="btn ghost small" data-act="remove-work" data-id="${esc(w.id)}">Hapus</button></li>`).join("");
  const general = L.suggestions.length
    ? `<div class="row" style="align-items:center;gap:8px"><span class="hint">${lensProdi().length > 1 ? `Irisan ${esc(lensProdi().join(" × "))}:` : "Umum:"}</span>${L.suggestions.map((q, i) => `<button type="button" class="btn ghost small" data-act="use-query" data-i="${i}">${esc(q)}</button>`).join("")}</div>` : "";
  const novelty = L.novelty
    ? `<div class="row" style="align-items:center;gap:8px"><span class="hint">Cek kebaruan:</span><button type="button" class="btn ghost small" data-act="use-novelty">${esc(L.novelty)}</button><span class="hint">Bila muncul studi yang persis sama dengan ide Anda, pilih dan masukkan ke referensi agar gap dipertajam.</span></div>` : "";
  const lenses = L.perProdi.length
    ? `<div class="lens-list">${L.perProdi.map((x, i) => `<button type="button" class="lens-btn" data-act="use-lens" data-i="${i}"><b>${esc(x.prodi)}</b><span>${esc(x.query)}</span></button>`).join("")}</div>
       <p class="hint" style="margin:0">Klik satu lensa untuk mencari. Makalah yang dipilih dari pencarian itu otomatis ditandai dengan prodi lensanya.</p>` : "";
  return `
    ${header(1, "Literatur lintas prodi", `Judul: <b>${esc(state.me.title || "(belum diisi)")}</b>. Kumpulkan referensi dari sudut pandang beberapa prodi. Semua makalah berasal dari OpenAlex dan punya DOI.`)}
    <section class="card ai">
      <h2>AI menyarankan kata kunci sesuai rumpun tim</h2>
      <p class="hint" style="margin:0">Saran hanya berdasar rumpun prodi yang terwakili di tim penulis: <b>${esc(lensProdi().join(" × ") || "(belum ada, isi di langkah 1)")}</b>. ${lensProdi().length > 1 ? "Kata kunci <i>irisan</i> menggabungkan semua rumpun tersebut; lensa per rumpun tetap dikaitkan dengan rumpun lainnya." : "Kata kunci tetap di dalam rumpun tersebut."}</p>
      <div>${btn("suggest-keywords", L.suggestions.length ? "Sarankan ulang" : "Sarankan kata kunci", { disabled: !state.me.title.trim() || !lensProdi().length })}</div>
      ${errBox("suggest-keywords")}
      ${promptViewer("keywords")}
      ${lenses}
      ${general}
      ${novelty}
    </section>
    <section class="card human">
      <h2>Pencarian</h2>
      <div class="row">
        <label class="field" style="flex:3 1 260px"><span>Kata kunci (bahasa Inggris)</span><input data-bind="lit.query" value="${esc(L.query)}" placeholder="mis. batik export consumer perception"></label>
        <label class="field" style="flex:1 1 170px"><span>Lensa prodi</span>${prodiSelect("lens", L.lens, "", "Irisan semua rumpun")}</label>
        <label class="field" style="flex:1 1 100px"><span>Terbit sejak</span><input type="number" min="1950" max="2100" data-bind="lit.yearFrom" value="${esc(L.yearFrom)}"></label>
        <label class="field" style="flex:1 1 150px"><span>Urutkan</span><select data-bind="lit.sort"><option value="relevance" ${L.sort === "relevance" ? "selected" : ""}>Paling relevan</option><option value="cited" ${L.sort === "cited" ? "selected" : ""}>Paling banyak dikutip</option></select></label>
        ${btn("search", "Cari di OpenAlex", { kind: "primary", busyLabel: "Mencari…" })}
      </div>
      <p class="hint" style="margin:0">Tulis 3–6 kata tanpa AND/OR. Pilihan sebelumnya tetap tersimpan saat Anda mencari ulang.</p>
      ${errBox("search")}
    </section>
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3>Referensi terpilih <span class="counter">${L.selected.length}</span> / ${MAX_PAPERS}</h3>
        <span class="hint">Wajib minimal ${MIN_PAPERS} referensi${needLitProdi() > 1 ? ` dari minimal ${needLitProdi()} rumpun tim` : ""} (paper IEEE umumnya 15–30); pilih yang benar-benar relevan dengan judul.</span>
      </div>
      ${teamChips(litProdi())}
      ${L.selected.length < MIN_PAPERS ? `<div class="alert warn">Baru ${L.selected.length} referensi; tambah ${MIN_PAPERS - L.selected.length} lagi untuk lanjut. Coba kata kunci irisan, lensa per rumpun, dan Cek kebaruan.</div>` : `<div class="alert ok">✓ Sudah memilih ${L.selected.length} referensi (minimal ${MIN_PAPERS} terpenuhi).</div>`}
      ${L.selected.length ? `<ul class="selected-list">${sel}</ul>` : '<p class="hint">Belum ada. Centang makalah dari hasil pencarian.</p>'}
    </section>
    ${L.searched ? `<section class="card"><h3>Hasil pencarian${L.lastLens ? ` · lensa ${esc(L.lastLens)}` : ""} <span class="hint">(${L.results.length} ditampilkan dari ±${Number(L.total).toLocaleString("id-ID")})</span></h3>${selPill(L.selected.length)}<div class="results">${list || '<p class="hint">Tidak ada hasil. Coba kata kunci lain.</p>'}</div></section>` : ""}
    ${navRow("Lanjut ke matriks gap")}`;
}

// ---------- Langkah 3 ----------
function viewGap() {
  const m = state.gap.matrix;
  const byN = new Map(state.lit.selected.map((w) => [w.n, w]));
  const table = m ? `
    <div class="tbl-wrap"><table class="matrix">
      <thead><tr><th style="width:44%">Referensi</th>${m.aspects.map((a, i) => `<th><input data-act="aspect" data-i="${i}" value="${esc(a)}" aria-label="Nama kolom ${i + 1}"></th>`).join("")}</tr></thead>
      <tbody>${m.rows.map((r, ri) => { const w = byN.get(r.n); return `<tr><td><b>[${r.n}]</b> ${esc(w?.title || "(makalah sudah dihapus)")} ${w?.prodi ? `<span class="tag">${esc(w.prodi)}</span>` : ""}<div class="hint">${esc(r.note || "")}</div></td>${r.cells.map((c, ci) => `<td class="c"><button type="button" class="cell-btn" data-act="cell" data-r="${ri}" data-c="${ci}" data-v="${esc(c)}" title="Klik untuk mengubah">${esc(c)}</button></td>`).join("")}</tr>`; }).join("")}</tbody>
    </table></div>
    <p class="hint">Isi sel dinilai AI hanya dari judul dan abstrak. Klik sel untuk mengoreksi (Yes → Partial → No). Cek minimal dua sel dengan membaca abstraknya sendiri.</p>` : "";
  const gaps = state.gap.gaps.length ? state.gap.gaps.map((g, i) => `
    <label class="qcard"><input type="radio" name="gap" data-act="choose-gap" value="${i}" ${state.gap.chosen === i ? "checked" : ""}>
      <div><div class="q">${esc(g.statement)}</div>${g.evidence.length ? `<div class="hint">Paling dekat: ${g.evidence.map((n) => `[${n}]`).join(", ")}</div>` : ""}</div></label>`).join("") : "";
  const few = state.lit.selected.length < 2;
  return `
    ${header(2, "Matriks gap lintas prodi", `Judul: <b>${esc(state.me.title)}</b>`)}
    <section class="card ai">
      <h2>AI memetakan</h2>
      <p class="hint">AI membaca ${state.lit.selected.length} abstrak referensi terpilih, menilai judul Anda dari sudut pandang beberapa rumpun prodi, lalu mengusulkan gap di irisan antardisiplin. Matriks dan gap ditulis dalam <b>bahasa Inggris</b> dengan sitasi nama penulis, misalnya <i>Lee et al. [3]</i>. AI tidak boleh menambah makalah lain.</p>
      <div>${btn("make-gap", m ? "Buat ulang matriks" : "Buat matriks gap", { disabled: few })}</div>
      ${few ? '<div class="alert warn">Pilih minimal dua referensi di langkah Literatur.</div>' : ""}
      ${errBox("make-gap")}
      ${promptViewer("gap")}
      ${table}
      ${gaps ? `<h3 style="margin-top:6px">Kandidat gap</h3>${gaps}` : ""}
    </section>
    <section class="card human">
      <h2>Keputusan tim</h2>
      <label class="field"><span>Gap yang dipilih (bahasa Inggris; sunting dengan kalimat sendiri, pertahankan sitasi nama penulis)</span><textarea data-bind="gap.text" rows="4">${esc(state.gap.text)}</textarea></label>
    </section>
    ${navRow("Lanjut ke judul dan draf")}`;
}

// ---------- Langkah 4 ----------
function draftStats() {
  const d = state.draft.data;
  if (!d) return "";
  const all = [d.abstract, ...d.sections.flatMap((s) => s.paragraphs)].join("\n");
  const ph = (all.match(PH_RE) || []).length;
  const { order } = citationMap();
  const uncited = state.lit.selected.filter((w) => !order.includes(w.n)).length;
  return `<div class="stats"><span class="stat"><b>${words(all)}</b> kata</span><span class="stat"><b>${ph}</b> placeholder</span><span class="stat"><b>${order.length}</b> dari ${state.lit.selected.length} referensi dikutip</span>${uncited ? `<span class="stat" style="color:var(--warn)">${uncited} referensi belum dikutip</span>` : ""}</div>`;
}
function titleCard() {
  const D = state.draft;
  const original = D.originalTitle || state.me.title;
  const cur = state.me.title.trim();
  const opts = D.titleSugs.length ? [
    `<label class="qcard"><input type="radio" name="tsug" data-act="choose-title" value="-1" ${cur === original.trim() ? "checked" : ""}>
      <div><div class="q">${esc(original)}</div><div class="hint">Judul awal (tetap dipakai bila dipilih)</div></div></label>`,
    ...D.titleSugs.map((t, i) => `<label class="qcard"><input type="radio" name="tsug" data-act="choose-title" value="${i}" ${cur === t.title.trim() ? "checked" : ""}>
      <div><div class="q">${esc(t.title)}</div>${t.reason ? `<div class="hint">${esc(t.reason)}</div>` : ""}</div></label>`),
  ].join("") : "";
  const kws = D.keywordSugs.length ? `
    <div class="row" style="align-items:center;gap:8px">
      <span class="hint">Saran kata kunci:</span>
      <div class="tags">${D.keywordSugs.map((k, i) => `<button type="button" class="btn ghost small" data-act="add-keyword" data-i="${i}">+ ${esc(k)}</button>`).join("")}</div>
      <button type="button" class="btn ghost small" data-act="use-keywords">Pakai semua</button>
    </div>` : "";
  return `
    <section class="card ai">
      <h2>AI menyarankan judul dan kata kunci</h2>
      <p class="hint" style="margin:0">Judul awal: <b>${esc(original)}</b></p>
      <p class="hint" style="margin:0">Gap yang dipilih: ${esc(state.gap.text || "(belum dipilih di langkah 3)")}</p>
      <p class="hint" style="margin:0">AI hanya mempertajam judul agar gap terlihat jelas, tanpa mengganti topik. Judul awal tetap boleh dipakai.</p>
      <div>${btn("suggest-titles", D.titleSugs.length ? "Sarankan ulang" : "Sarankan judul dan kata kunci", { disabled: !state.gap.text.trim() || !original.trim() })}</div>
      ${errBox("suggest-titles")}
      ${promptViewer("titles")}
      ${opts}
      ${kws}
    </section>`;
}
// ---------- Rencana data dan metode (setelah gap dipilih) ----------
const APPROACHES = [
  { key: "quant", name: "Kuantitatif", hint: "survei, eksperimen, data sekunder dan statistik" },
  { key: "qual", name: "Kualitatif", hint: "wawancara, studi kasus, analisis konten, etnografi" },
  { key: "mixed", name: "Metode campuran", hint: "gabungan kuantitatif dan kualitatif; cocok untuk tim lintas prodi" },
  { key: "dsr", name: "Rekayasa / design science", hint: "membangun model, sistem, prototipe, atau karya desain, lalu mengevaluasinya" },
  { key: "auto", name: "Belum tahu", hint: "AI menawarkan tiga opsi dari pendekatan yang berbeda" },
];
const approachName = (k) => APPROACHES.find((a) => a.key === k)?.name || "";
// Pendekatan yang dipakai draf: pilihan peserta, atau pendekatan opsi AI yang dipilih bila peserta memilih "Belum tahu".
const effectiveApproach = () => state.me.approach && state.me.approach !== "auto" ? state.me.approach : (state.draft.methodApproach || "auto");
function methodText(o) {
  const L = isId() ? ["Desain", "Data", "Analisis", "Evaluasi"] : ["Design", "Data", "Analysis", "Evaluation"];
  return [[L[0], o.design], [L[1], o.data], [L[2], o.analysis], [L[3], o.evaluation]]
    .filter(([, v]) => String(v || "").trim()).map(([k, v]) => `${k}: ${String(v).trim().replace(/\.$/, "")}.`).join("\n");
}
function methodCard() {
  const D = state.draft;
  const opts = D.methodSugs.map((o, i) => `<label class="qcard"><input type="radio" name="msug" data-act="choose-method" value="${i}" ${D.methodChosen === i ? "checked" : ""}>
      <div><div class="q">${esc(o.label || `Opsi ${i + 1}`)}${o.approach ? ` <span class="tag muted">${esc(approachName(o.approach))}</span>` : ""}</div>
      <div class="hint" style="white-space:pre-line">${esc(methodText(o))}</div>
      ${o.why ? `<div class="hint"><i>${isId() ? "Menjawab gap" : "Answers the gap"}:</i> ${esc(o.why)}</div>` : ""}</div></label>`).join("");
  return `
    <section class="card ai">
      <h2>Rencana data dan metode</h2>
      <p class="hint" style="margin:0">Metode dipilih sesudah gap agar benar-benar menjawab gap. Lihat matriks gap: metode apa yang sudah umum dipakai studi terdahulu, lalu pilih desain yang melengkapinya.</p>
      <div class="field"><span>1. Pendekatan penelitian (keputusan tim)</span>
        <div class="approach-list">${APPROACHES.map((a) => `<label class="check-pill approach"><input type="radio" name="approach" data-act="approach" value="${a.key}" ${state.me.approach === a.key ? "checked" : ""}><span><b>${esc(a.name)}</b><small>${esc(a.hint)}</small></span></label>`).join("")}</div>
      </div>
      <label class="field"><span>2. Data yang sudah tersedia atau bisa diakses tim (opsional)</span><textarea data-bind="me.dataAvail" rows="2" placeholder="mis. data penjualan e-commerce UMKM binaan 2023–2025; akses ke 150 mahasiswa DKV; dataset ulasan publik">${esc(state.me.dataAvail)}</textarea></label>
      <div class="row" style="align-items:center">${btn("suggest-method", D.methodSugs.length ? "Sarankan ulang" : "3. Sarankan metode", { disabled: !state.gap.text.trim() || !state.me.title.trim() || !state.me.approach })}
        ${state.me.approach ? "" : '<span class="hint">Pilih pendekatan terlebih dahulu.</span>'}</div>
      ${errBox("suggest-method")}
      ${promptViewer("method")}
      ${opts}
      <label class="field"><span>4. Rencana data dan metode tim (boleh disunting; dipakai AI untuk bagian Metode serta Hasil dan Pembahasan)</span><textarea data-bind="me.method" rows="5" placeholder="${isId() ? "Desain: …\nData: …\nAnalisis: …\nEvaluasi: …" : "Design: …\nData: …\nAnalysis: …\nEvaluation: …"}">${esc(state.me.method)}</textarea></label>
    </section>`;
}
// ---------- Ketentuan section (standar conference IEEE) ----------
const SECTION_KEYS = ["intro", "related", "method", "results", "conclusion"];
const GUIDE = {
  title: { name: "Judul", points: [
    "Spesifik: menyebut objek, variabel atau fokus, dan konteks penelitian.",
    "Tanpa subjudul; template IEEE mengingatkan subjudul tidak tercatat di IEEE Xplore.",
    "Tanpa simbol, karakter khusus, rumus, atau singkatan yang tidak umum.",
    "Ringkas; patokan kerja sekitar 10–15 kata.",
    "Tidak ada salah ketik dan istilah konsisten dengan isi.",
  ] },
  abstract: { name: "Abstrak", points: [
    "Satu paragraf: latar, gap, tujuan, metode, hasil (placeholder sampai ada data), dan kontribusi.",
    "Tidak menyebut tim atau prodi penulis; tanpa klaim berlebihan (novel, crucial).",
    "Tanpa sitasi, simbol, rumus, atau catatan kaki (peringatan di template IEEE).",
    "Umumnya 150–250 kata; ikuti batas di call for papers konferensi tujuan.",
    "Bisa dipahami tanpa membaca isi paper.",
  ] },
  keywords: { name: "Keywords (Index Terms)", points: [
    "3–6 istilah, dipisahkan koma.",
    "Istilah baku di bidangnya; cek IEEE Thesaurus bila konferensi memintanya.",
    "Urutkan menurut abjad.",
    "Jangan sekadar mengulang kata-kata di judul: tambahkan metode, jenis data, atau konteks.",
  ] },
  intro: { name: "I. Introduction", points: [
    "Konteks dan pentingnya masalah, didukung sitasi.",
    "Gap dari literatur, dibandingkan dengan studi yang ditinjau (hindari klaim \"belum pernah ada penelitian\").",
    "Tujuan dan 1–3 pertanyaan penelitian.",
    "2–4 kontribusi eksplisit (1), (2), (3), masing-masing terlacak ke Metode dan Hasil.",
    "Satu kalimat tentang susunan paper (Section II …).",
    "Tidak menyebut nama prodi atau departemen tim; sebut bidang ilmunya.",
  ] },
  related: { name: "II. Related Work", points: [
    "Sintesis per tema, bukan ringkasan makalah satu per satu.",
    "Gaya IEEE: \"Lee et al. [3]\" tanpa tahun di dalam teks.",
    "Bandingkan pendekatan, temuan, dan keterbatasan studi terdahulu.",
    "Rujuk Tabel I (matriks gap).",
    "Akhiri dengan posisi penelitian ini terhadap gap.",
  ] },
  method: { name: "III. Research Method", points: [
    "Desain penelitian dan alasannya.",
    "Data: sumber, populasi atau sampel, cara pengumpulan (selaras dengan Open Data).",
    "Variabel atau instrumen dan cara mengukurnya.",
    "Teknik analisis serta alat atau perangkat lunak.",
    "Urutan isi: desain, data/partisipan, pendekatan/sistem, setup evaluasi dan metrik, reproduksibilitas.",
    "Studi komputasi/ML: dataset per kelas, anotasi, pembagian data tanpa kebocoran, baseline, metrik (mis. macro-F1).",
    "Gambar alur penelitian (Gambar 1) dirujuk di teks.",
    "Etika penelitian bila melibatkan manusia.",
    "Cukup rinci agar bisa direplikasi.",
  ] },
  results: { name: "IV. Results and Discussion", points: [
    "Hasil: sajikan temuan berurutan sesuai tujuan atau hipotesis, dengan tabel atau gambar bernomor (Tabel II, Gambar 1, …).",
    "Teks menjelaskan makna tabel atau gambar, bukan mengulang semua angkanya.",
    "Pembahasan: bandingkan setiap temuan dengan studi terdahulu [n], lalu jelaskan mengapa sejalan atau berbeda.",
    "Tunjukkan bagaimana temuan menjawab gap; sebutkan implikasi teoretis dan praktis.",
    "Sebutkan keterbatasan penelitian.",
    "Semua angka dan kutipan informan tetap placeholder sampai analisis selesai; jangan dikarang.",
    "Jangan memakai kata “signifikan” tanpa uji statistik; bandingkan literatur hanya pada kondisi yang setara.",
  ] },
  conclusion: { name: "V. Conclusion", points: [
    "Satu sampai dua paragraf (± 200 kata), tidak mengulang pendahuluan.",
    "Jawaban ringkas atas tujuan penelitian.",
    "Kontribusi teoretis dan praktis.",
    "Keterbatasan penelitian.",
    "Arah riset lanjutan.",
    "Tanpa sitasi baru dan tanpa informasi yang belum dibahas.",
    "Jangan menyalin abstrak; tanpa angka atau klaim baru.",
  ] },
};
const citesIn = (t) => [...new Set([...String(t || "").matchAll(CITE_RE)].map((m) => Number(m[1])))];
const phIn = (t) => (String(t || "").match(PH_RE) || []).length;
// ---------- Peta struktur berwarna (komponen tiap bagian) ----------
// [kunci, label, opsional, indeks warna]; warna sama untuk peran yang sama di semua bagian (gap merah, tujuan ungu, kontribusi hijau).
const ROLES = {
  abstract: [["background", "Latar", false, 0], ["gap", "Gap", false, 1], ["objective", "Tujuan", false, 2], ["method", "Metode", false, 3], ["results", "Hasil", false, 4], ["contribution", "Kontribusi", false, 5]],
  intro: [["context", "Konteks", false, 0], ["problem", "Masalah", false, 4], ["gap", "Gap", false, 1], ["objective", "Tujuan dan RQ", false, 2], ["contribution", "Kontribusi", false, 5], ["organization", "Susunan paper", true, 3]],
  related: [["theme", "Sintesis tema", false, 0], ["comparison", "Perbandingan", false, 3], ["positioning", "Posisi terhadap gap", false, 1]],
  method: [["design", "Desain", false, 0], ["data", "Data/partisipan", false, 3], ["procedure", "Pendekatan/sistem", false, 2], ["evaluation", "Evaluasi dan metrik", false, 4], ["ethics", "Etika dan reproduksibilitas", true, 5]],
  results: [["results", "Hasil", false, 4], ["comparison", "Banding literatur", false, 3], ["interpretation", "Interpretasi", false, 2], ["limitation", "Keterbatasan", false, 1]],
  conclusion: [["answer", "Jawaban tujuan", false, 2], ["contribution", "Kontribusi", false, 5], ["limitation", "Keterbatasan", false, 1], ["future", "Riset lanjutan", false, 0]],
};
// Rekomendasi editorial panjang bagian untuk paper konferensi (abstrak 150–250 sesuai panduan IEEE).
const WORD_TARGET = { abstract: [150, 250], intro: [400, 600], related: [250, 400], method: [700, 1000], results: [750, 1150], conclusion: [150, 200] };
const tokSet = (t) => new Set(String(t || "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
function overlap(a, b) {
  const A = tokSet(a), B = tokSet(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}
const normTxt = (t) => String(t || "").replace(/\s+/g, " ").trim();
// Setelah disunting, setiap kalimat/paragraf diberi peran dari potongan asli AI yang paling mirip.
function bestRole(text, orig) {
  let best = { r: "", v: 0 };
  for (const o of orig) { const v = overlap(text, o.text); if (v > best.v) best = { r: o.role, v }; }
  return best.v >= 0.34 ? best.r : "";
}
function structList(key) {
  const d = state.draft.data;
  if (!d) return null;
  if (key === "abstract") {
    const parts = d.abstractParts || [];
    if (!parts.some((p) => p.role)) return null;
    if (normTxt(d.abstract) === normTxt(parts.map((p) => p.text).join(" "))) return parts;
    const sents = normTxt(d.abstract).split(/(?<=[.!?])\s+(?=[A-Z\[])/).filter(Boolean);
    return sents.map((t) => ({ text: t, role: bestRole(t, parts) }));
  }
  const i = SECTION_KEYS.indexOf(key);
  const sec = d.sections[i];
  if (!sec || !(sec.roles || []).some(Boolean)) return null;
  const orig = (sec.orig || sec.paragraphs).map((t, k) => ({ text: t, role: sec.roles[k] || "" }));
  if (sec.paragraphs.length === orig.length && sec.paragraphs.every((t, k) => normTxt(t) === normTxt(orig[k].text))) return orig;
  return sec.paragraphs.map((t) => ({ text: t, role: bestRole(t, orig) }));
}
function missingRoles(key) {
  const list = structList(key);
  if (!list) return null;
  const have = new Set(list.map((x) => x.role));
  return ROLES[key].filter(([r, , opt]) => !opt && !have.has(r)).map(([, label]) => label);
}
function smapHtml(key) {
  if (!state.draft.data || !ROLES[key]) return "";
  const list = structList(key);
  const roles = ROLES[key];
  const ci = (r) => roles.find(([k]) => k === r)?.[3] ?? 0;
  if (!list) return `<div class="smap-note hint">Peta struktur berwarna muncul pada draf yang disusun ulang dengan versi aplikasi terbaru.</div>`;
  const have = new Set(list.map((x) => x.role));
  const legend = roles.map(([r, label, opt, c]) => `<span class="sm-chip rc${c} ${have.has(r) ? "" : "sm-miss"}">${have.has(r) ? "✓" : "○"} ${esc(label)}${opt ? " (opsional)" : ""}</span>`).join("");
  const label = (r) => roles.find(([k]) => k === r)?.[1] || "Belum ditandai";
  const body = key === "abstract"
    ? `<p class="sm-text">${list.map((x) => `<span class="sm-seg ${x.role ? `rc${ci(x.role)}` : "sm-none"}" title="${esc(label(x.role))}">${esc(x.text)}</span>`).join(" ")}</p>`
    : list.map((x) => `<div class="sm-para ${x.role ? `rc${ci(x.role)}` : "sm-none"}"><span class="sm-tag">${esc(label(x.role))}</span>${esc(x.text)}</div>`).join("");
  return `<details class="smap" id="smap-${key}" ${key === "abstract" ? "open" : ""}><summary><span class="sm-title">Peta struktur</span>${legend}</summary>${body}</details>`;
}
function updateSmap(key) {
  const el = $(`#smap-${key}`);
  if (!el) return;
  const open = el.open;
  el.outerHTML = smapHtml(key);
  const nu = $(`#smap-${key}`); if (nu) nu.open = open;
}
function wordCheck(okIf, key, w) {
  const t = WORD_TARGET[key]; if (!t) return;
  okIf(w >= t[0] && w <= t[1], `${w} kata (rekomendasi ${t[0]}–${t[1]})`, `${w} kata; rekomendasi ${t[0]}–${t[1]}`);
}
function autoChecks(key) {
  const d = state.draft.data;
  const out = [];
  const okIf = (cond, okText, badText) => out.push([cond, cond ? okText : badText]);
  if (key === "title") {
    const w = words(state.me.title);
    okIf(w > 0 && w <= 15, `${w} kata`, `${w} kata (patokan kerja ≤ 15)`);
    okIf(!/:/.test(state.me.title), "Tanpa subjudul", "Ada tanda titik dua; kemungkinan subjudul");
    okIf(!/[^\p{L}\p{N}\s,'’()&\-–]/u.test(state.me.title), "Tanpa simbol khusus", "Ada simbol atau karakter khusus");
  } else if (key === "keywords") {
    const list = state.draft.keywords.split(",").map((x) => x.trim()).filter(Boolean);
    const n = list.length;
    okIf(n >= 3 && n <= 6, `${n} istilah`, `${n} istilah (disarankan 3–6)`);
    const t = state.me.title.toLowerCase();
    const rep = list.filter((k) => k.split(/\s+/).every((w) => t.includes(w.toLowerCase()))).length;
    if (n) okIf(rep <= 2, "Tidak sekadar mengulang judul", `${rep} kata kunci hanya mengulang kata di judul`);
    const sorted = [...list].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    if (n > 1) okIf(sorted.join("|") === list.join("|"), "Urut abjad", "Belum urut abjad");
  } else if (key === "abstract" && d) {
    const w = words(d.abstract);
    okIf(w >= 150 && w <= 250, `${w} kata`, `${w} kata (umumnya 150–250)`);
    const miss = missingRoles("abstract");
    if (miss) okIf(!miss.length, "Semua komponen abstrak ada", `Belum ada: ${miss.join(", ")}`);
    okIf(citesIn(d.abstract).length === 0, "Tanpa sitasi", "Ada sitasi; hapus dari abstrak");
    okIf(!/\b(department|study program|program studi|prodi|author team|tim penulis)\b/i.test(d.abstract), "Tidak menyebut tim/prodi", "Menyebut tim atau prodi; hapus dari abstrak");
    const ph = phIn(d.abstract); if (ph) out.push([false, `${ph} placeholder perlu diisi`]);
  } else if (d) {
    const i = SECTION_KEYS.indexOf(key);
    const text = (d.sections[i]?.paragraphs || []).join("\n");
    const c = citesIn(text).length;
    wordCheck(okIf, key, words(text));
    const miss = missingRoles(key);
    if (miss) okIf(!miss.length, "Semua komponen ada", `Belum ada: ${miss.join(", ")}`);
    if (key === "intro") okIf(c >= 3, `${c} referensi dikutip`, `${c} referensi dikutip (disarankan ≥ 3)`);
    if (key === "related") { const need = Math.ceil(state.lit.selected.length / 2); okIf(c >= need, `${c} dari ${state.lit.selected.length} referensi dikutip`, `${c} dari ${state.lit.selected.length} referensi dikutip (disarankan ≥ ${need})`); }
    if (key === "conclusion") {
      okIf(c === 0, "Tanpa sitasi baru", `${c} sitasi; hindari sitasi baru di kesimpulan`);
      okIf(words(text) <= 250, "Ringkas", `${words(text)} kata; ringkas menjadi ± 200 kata`);
    }
    if (key === "related") okIf(/\b(Table|Tabel) I\b/.test(text), "Tabel I dirujuk di teks", "Tabel I belum dirujuk di teks");
    if (key === "intro") okIf(/\(1\)|\b(contributions?|kontribusi)\b/i.test(text), "Kontribusi dinyatakan", "Kontribusi belum dinyatakan eksplisit");
    // Gaya IEEE: tahun tidak ditulis di teks (mis. "Lee et al. (2021) [3]").
    const yearCites = (text.match(/\(\s?(19|20)\d{2}\s?\)\s?\[\d+\]/g) || []).length;
    if (yearCites) out.push([false, `${yearCites} sitasi memakai tahun; gaya IEEE cukup "Nama et al. [n]"`]);
    const hype = (text.match(/\b(unprecedented|paramount|crucial|groundbreaking|novel)\b/gi) || []).length;
    if (hype) out.push([false, `${hype} kata berlebihan (mis. crucial, novel); pertimbangkan diganti`]);
    if (key === "results") {
      okIf(!/\d+(?:[.,]\d+)?\s?%|p\s?[<=>]\s?0?[.,]\d/.test(text.replace(PH_RE, "")), "Tidak ada angka hasil karangan", "Ada angka hasil; pastikan berasal dari analisis sendiri");
      okIf(c >= 2, `Pembahasan membandingkan dengan ${c} studi terdahulu`, `Pembahasan baru mengutip ${c} studi terdahulu (disarankan ≥ 2)`);
    }
    const ph = phIn(text); if (ph) out.push([false, `${ph} placeholder perlu diisi`]);
  }
  return out;
}
function autoHtml(key) {
  return autoChecks(key).map(([ok, t]) => `<li><span class="${ok ? "g-ok" : "g-warn"}" aria-hidden="true">${ok ? "✓" : "!"}</span><span>${esc(t)}</span></li>`).join("");
}
function guideHtml(key) {
  const g = GUIDE[key];
  const checks = state.draft.guideChecks[key] || [];
  const name = key.length > 0 && SECTION_KEYS.includes(key) && state.draft.data
    ? `${["I", "II", "III", "IV", "V"][SECTION_KEYS.indexOf(key)]}. ${state.draft.data.sections[SECTION_KEYS.indexOf(key)]?.heading || g.name}`
    : g.name;
  return `
    <div class="guide-h">Ketentuan IEEE · ${esc(name)}</div>
    <ul class="guide-list">${g.points.map((p, i) => `<li><input type="checkbox" id="g-${key}-${i}" data-act="guide-check" data-k="${key}" data-i="${i}" ${checks[i] ? "checked" : ""}><label for="g-${key}-${i}">${esc(p)}</label></li>`).join("")}</ul>
    <ul class="guide-auto" id="auto-${key}">${autoHtml(key)}</ul>`;
}
function guided(key, fieldHtml) {
  return `<div class="sec-grid"><div class="sec-field">${fieldHtml}</div><aside class="guide" aria-label="Ketentuan ${esc(GUIDE[key].name)}">${guideHtml(key)}</aside></div>`;
}
function updateGuide(key) { const el = $(`#auto-${key}`); if (el) el.innerHTML = autoHtml(key); }

// ---------- Review sebagai reviewer IEEE ----------
const CHECK_LABELS = {
  objective_answered: "Tujuan dijawab oleh hasil",
  method_traceable: "Metode terlacak",
  numbers_consistent: "Angka konsisten antarbagian",
  contributions_supported: "Kontribusi didukung bukti",
  references_support: "Referensi mendukung klaim",
  no_template_text: "Tanpa sisa teks template",
};
function wordTable() {
  const d = state.draft.data;
  if (!d) return "";
  const rows = [["Abstrak", "abstract", d.abstract], ...d.sections.map((x, i) => [`${["I", "II", "III", "IV", "V"][i]}. ${x.heading}`, SECTION_KEYS[i], x.paragraphs.join(" ")])];
  return `<table class="wtable"><tr><th>Bagian</th><th>Kata</th><th>Rekomendasi</th><th>Status</th></tr>${rows.map(([name, key, text]) => {
    const w = words(text), t = WORD_TARGET[key];
    const st = !t ? "" : w < t[0] ? '<span class="rv-st rv-warn">!</span> kurang' : w > t[1] ? '<span class="rv-st rv-warn">!</span> lebih' : '<span class="rv-st rv-ok">✓</span> sesuai';
    return `<tr><td>${esc(name)}</td><td>${w}</td><td>${t ? `${t[0]}–${t[1]}` : "–"}</td><td>${st}</td></tr>`;
  }).join("")}</table>`;
}
function viewReview() {
  return `
    ${header(5, "Review sebagai reviewer IEEE", "AI mereview paper lengkap Anda seperti reviewer konferensi IEEE. Perbaiki temuan di Langkah 4 (draf) atau Langkah 5 (pernyataan), review ulang, lalu unduh ulang .docx.")}
    <section class="card">
      <h2>Panjang setiap bagian</h2>
      <p class="hint" style="margin:0">Abstrak 150–250 kata mengikuti panduan IEEE. Rentang bagian lain adalah rekomendasi editorial untuk paper konferensi, bukan kuota wajib; ikuti batas halaman venue tujuan.</p>
      ${wordTable()}
    </section>
    ${reviewCard()}
    <section class="card human">
      <h2>Tindak lanjut tim</h2>
      <div class="row">
        <button type="button" class="btn ghost" data-act="goto" data-i="3">Perbaiki draf (Langkah 4)</button>
        <button type="button" class="btn ghost" data-act="goto" data-i="4">Perbaiki pernyataan dan unduh ulang (Langkah 5)</button>
      </div>
    </section>
    ${navRow()}`;
}
const VERDICT = { "major revision": ["Major revision", "warn"], "minor revision": ["Minor revision", "info"], "ready after data": ["Siap setelah data diisi", "ok"] };
function reviewCard() {
  const R = state.review.data;
  const d = state.draft.data;
  const doneN = R ? R.findings.filter((_, i) => state.review.done[i]).length : 0;
  const list = R ? R.findings.map((f, i) => `
    <li class="rv-item ${state.review.done[i] ? "rv-done" : ""}">
      <input type="checkbox" id="rv-${i}" data-act="review-done" data-i="${i}" ${state.review.done[i] ? "checked" : ""} aria-label="Tandai sudah diperbaiki">
      <div>
        <div class="rv-head"><span class="tag ${f.severity === "major" ? "rv-major" : "rv-minor"}">${f.severity === "major" ? "Major" : "Minor"}</span><b>${esc(f.section)}</b></div>
        ${f.quote ? `<div class="rv-quote">“${esc(f.quote)}”</div>` : ""}
        <div>${esc(f.issue)}</div>
        <div class="rv-fix"><b>Saran:</b> ${esc(f.suggestion)}</div>
      </div>
    </li>`).join("") : "";
  const v = R ? VERDICT[R.verdict] || VERDICT["major revision"] : null;
  return `
    <section class="card ai" id="reviewCard">
      <h2>Review sebagai reviewer IEEE</h2>
      <p class="hint" style="margin:0">AI membaca paper lengkap Anda, termasuk pernyataan AI, Open Contributionship, dan Open Data, seperti reviewer konferensi IEEE. Placeholder dianggap wajar karena data belum ada. AI tidak menjanjikan paper diterima.</p>
      <div class="alert warn"><b>Review ini latihan, bukan peer review sungguhan.</b> Hasilnya membantu Anda belajar membaca draf seperti reviewer; keputusan venue tetap ditentukan editor dan reviewer manusia.</div>
      <div>${btn("review-draft", R ? "Review ulang draf terbaru" : "Review sebagai reviewer IEEE", { disabled: !d, busyLabel: "Mereview… (15–40 detik)" })}</div>
      ${errBox("review-draft")}
      ${promptViewer("review")}
      ${R ? `
        <div class="alert ${v[1]}"><b>Rekomendasi: ${esc(v[0])}.</b> ${esc(R.summary)}</div>
        ${R.strengths.length ? `<div class="hint"><b>Kekuatan:</b> ${R.strengths.map(esc).join(" · ")}</div>` : ""}
        ${(R.checks || []).length ? `<div class="rv-checks"><b>Pemeriksaan konsistensi</b><ul>${R.checks.map((c) => `<li><span class="rv-st rv-${c.status}">${c.status === "ok" ? "✓" : c.status === "fail" ? "✗" : "!"}</span><span><b>${esc(CHECK_LABELS[c.id] || c.id)}</b>${c.note ? ` · ${esc(c.note)}` : ""}</span></li>`).join("")}</ul></div>` : ""}
        <div class="hint">${R.findings.filter((f) => f.severity === "major").length} major, ${R.findings.filter((f) => f.severity === "minor").length} minor · ${doneN} dari ${R.findings.length} ditandai sudah diperbaiki</div>
        <ul class="rv-list">${list}</ul>` : ""}
    </section>`;
}

// ---------- Prompt AI (transparansi untuk pembelajaran) ----------
function promptViewer(task) {
  const p = state.prompts?.[task];
  if (!p) return "";
  return `<details class="prompt-view"><summary>Lihat prompt AI</summary>
    <p class="hint">Inilah instruksi persis yang dikirim aplikasi ke AI untuk langkah ini. Perhatikan aturan yang mencegah AI mengarang referensi dan angka.</p>
    <div><button type="button" class="btn ghost small" data-act="copy-prompt" data-task="${task}">Salin prompt</button></div>
    <div class="prompt-label">Instruksi sistem</div><pre class="prompt-pre">${esc(p.system)}</pre>
    <div class="prompt-label">Instruksi tugas</div><pre class="prompt-pre">${esc(p.user)}</pre>
  </details>`;
}

function viewDraft() {
  const d = state.draft.data;
  const editor = d ? `
    ${guided("abstract", `<label class="field"><span>${isId() ? "Abstrak" : "Abstract"}</span><textarea class="paper" data-act="edit-abstract" rows="9">${esc(d.abstract)}</textarea></label>${smapHtml("abstract")}`)}
    ${d.sections.map((s, i) => guided(SECTION_KEYS[i] || "intro", `<label class="field"><span>${["I", "II", "III", "IV", "V"][i] || i + 1}. ${esc(s.heading)}</span><textarea class="paper" data-act="edit-section" data-i="${i}" rows="${Math.max(10, Math.min(22, 4 + s.paragraphs.join(" ").length / 110 | 0))}">${esc(s.paragraphs.join("\n\n"))}</textarea></label>${smapHtml(SECTION_KEYS[i])}`)).join("")}
    <p class="hint">Pisahkan paragraf dengan satu baris kosong. Sitasi ditulis [nomor] sesuai daftar referensi terpilih; penomoran IEEE dirapikan otomatis saat ekspor. Teks dalam [kurung siku] lain adalah placeholder yang wajib diisi dari data atau analisis tim.</p>` : "";
  const canDraft = state.me.title.trim() && state.gap.text.trim() && state.lit.selected.length >= 2;
  return `
    ${header(3, "Judul dan draf paper", "Pertajam judul sesuai gap yang dipilih, tetapkan kata kunci dan rencana metode, lalu susun draf. Draf ditulis seperti paper jadi; karena data belum ada, semua temuan dan angka ditulis sebagai [placeholder]. Warna di bawah setiap bagian menunjukkan komponen struktur IEEE-nya.")}
    ${titleCard()}
    <section class="card human">
      <h2>Keputusan tim: judul dan kata kunci final</h2>
      ${guided("title", `<label class="field"><span>Judul final (boleh disunting)</span><textarea data-bind="me.title" rows="3">${esc(state.me.title)}</textarea></label>`)}
      ${guided("keywords", `<label class="field"><span>Kata kunci (pisahkan dengan koma)</span><input data-bind="draft.keywords" value="${esc(state.draft.keywords)}"></label>`)}
    </section>
    ${methodCard()}
    <section class="card ai">
      <h2>AI menyusun draf</h2>
      ${state.me.method.trim() ? `<p class="hint" style="margin:0">Pendekatan: <b>${esc(approachName(effectiveApproach()) || "belum dipilih")}</b>. Bagian Metode serta Hasil dan Pembahasan disusun dengan istilah dan kerangka pendekatan ini.</p>` : '<div class="alert warn">Rencana data dan metode belum diisi. Draf tetap bisa disusun, tetapi bagian Metode serta Hasil dan Pembahasan akan berupa kerangka umum.</div>'}
      <p class="hint">Bahasa naskah: <b>${isId() ? "Bahasa Indonesia" : "English"}</b>. AI hanya boleh mengutip ${state.lit.selected.length} referensi terpilih dan diminta mengaitkan sudut pandang antarprodi. Proses 20–60 detik.</p>
      <div>${btn("make-draft", d ? "Susun ulang draf (suntingan akan tertimpa)" : "Susun draf paper", { disabled: !canDraft, busyLabel: "Menyusun draf… (20–60 detik)" })}</div>
      ${!canDraft ? '<div class="alert warn">Isi judul, gap yang dipilih, dan minimal dua referensi terlebih dahulu.</div>' : ""}
      ${errBox("make-draft")}
      ${promptViewer("draft")}
      <div id="draftStats">${draftStats()}</div>
      ${editor}
    </section>
    ${resultsCard()}
    ${navRow("Lanjut ke integritas dan ekspor")}`;
}

// ---------- Hasil analisis milik dosen (ZIP) ----------
// Research Lab tidak mengolah data: dosen mengolah sendiri (Python, SPSS, Excel), lalu mengunggah hasilnya.
// AI menyarankan tabel/gambar dan menulis Hasil-Pembahasan, Kesimpulan, Abstrak; angka dikunci ke file dosen.
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII"];
const RS_TOKEN = /\{\{(table|figure):([A-Za-z0-9_-]+)\}\}/g;
let figData = {}; // id -> dataURL (disimpan di IndexedDB, bukan localStorage)
// Jenis analisis: menentukan isi ZIP yang disarankan, susunan hasil, dan pemeriksaan otomatis.
const PROFILE_LIST = [
  ["ml", "Komputasional / machine learning (Python, R)"],
  ["sem", "SEM-PLS / CB-SEM (SmartPLS, AMOS, lavaan)"],
  ["stats", "Statistik survei/eksperimen (SPSS, JASP, Jamovi)"],
  ["qual", "Kualitatif (wawancara, FGD, NVivo, ATLAS.ti)"],
  ["mixed", "Metode campuran"],
  ["dsr", "Pengembangan aplikasi / design science"],
];
const EXPECT = {
  ml: {
    how: "Python/R: simpan tabel metrik ke CSV (<code>df.to_csv</code>), gambar dengan <code>plt.savefig</code>, output teks ke .txt, atau sertakan notebook .ipynb yang sudah dijalankan.",
    items: [
      ["Perbandingan model usulan dan baseline (metrik)", (c) => /accuracy|akurasi|\bf1|precision|recall|rmse|\bmae\b|\bauc\b/.test(c.tab)],
      ["Metrik per kelas atau classification report", (c) => /classification|support|per.?kelas|per.?class/.test(c.all)],
      ["Confusion matrix, kurva loss, atau ROC (gambar)", (c) => /confusion|roc|loss|curve|kurva/.test(c.fig)],
      ["Konfigurasi eksperimen (split, seed, hyperparameter, perangkat)", (c) => /seed|split|epoch|learning.?rate|\blr\b|batch|hyperparam|config|gpu/.test(c.all)],
      ["Beberapa run (mean ± std) atau uji statistik", (c) => /\bstd\b|±|fold|\bruns?\b|p.?value|wilcoxon|t.?test/.test(c.all)],
    ],
  },
  sem: {
    how: "SmartPLS 4: jalankan <i>PLS-SEM algorithm</i> dan <i>Bootstrapping</i>, lalu pada laporan pilih <b>Export › Excel</b> (atau HTML). AMOS/lavaan: salin tabel estimasi ke Excel. Diagram model: simpan sebagai PNG.",
    items: [
      ["Profil responden", (c) => /profil|demograf|jenis kelamin|gender|usia|\bage\b|responden/.test(c.all)],
      ["Outer loadings", (c) => /loading/.test(c.tab)],
      ["Reliabilitas dan validitas konvergen (Cronbach's alpha, rho_a/rho_c, AVE)", (c) => /cronbach|composite|rho_?[ac]|average variance|\bave\b/.test(c.tab)],
      ["Validitas diskriminan (HTMT atau Fornell-Larcker)", (c) => /htmt|heterotrait|fornell/.test(c.tab)],
      ["Bootstrapping: path coefficient, t statistik, p value", (c) => /p.?values?|t.?stat|path coef|bootstrap/.test(c.tab)],
      ["R² (dan f², Q² bila ada)", (c) => /r.?square|r²|\br2\b|f.?square|f²|q²|\bq2\b/.test(c.tab)],
      ["Gambar model penelitian/diagram jalur", (c) => c.nFig > 0],
    ],
  },
  stats: {
    how: "SPSS: di Output Viewer pilih <b>File › Export</b>, format <b>Excel</b> atau <b>HTML</b> (bukan .spv). JASP/Jamovi: <b>Export results</b> ke HTML.",
    items: [
      ["Profil responden", (c) => /profil|demograf|jenis kelamin|gender|usia|\bage\b|responden|frequenc/.test(c.all)],
      ["Uji validitas (item-total, r hitung)", (c) => /validit|r.?hitung|corrected item|item-total|pearson|correlations/.test(c.tab)],
      ["Uji reliabilitas (Cronbach's alpha)", (c) => /cronbach|reliab/.test(c.tab)],
      ["Uji asumsi (normalitas, multikolinearitas, dll.)", (c) => /normal|kolmogorov|shapiro|\bvif\b|tolerance|glejser|heterosk|levene/.test(c.tab)],
      ["Uji hipotesis (koefisien, t/F, sig., R²)", (c) => /coefficient|koefisien|anova|t.?test|\bsig\b|r square|regres|model summary/.test(c.tab)],
    ],
  },
  qual: {
    how: "Transkrip yang sudah dianonimkan sebagai DOCX/TXT (beri nama mis. <code>transkrip_I1.docx</code>). NVivo/ATLAS.ti: ekspor <b>codebook</b> atau daftar node/kode ke Excel. Peta tema: simpan sebagai PNG.",
    items: [
      ["Transkrip wawancara/FGD (sudah dianonimkan)", (c) => c.transcripts > 0],
      ["Codebook atau daftar tema/kode", (c) => /code|kode|tema|theme|node|kategori/.test(c.tab)],
      ["Profil informan (kode, peran; tanpa nama asli)", (c) => /informan|partisipan|participant|narasumber|profil/.test(c.all)],
      ["Peta tema atau diagram (opsional)", (c) => c.nFig > 0],
    ],
  },
  dsr: {
    how: "ZIP <b>folder proyek</b> (tanpa <code>node_modules</code>, <code>vendor</code>, <code>build</code>, dan <code>.env</code>), ditambah folder <code>screenshot/</code> dan dokumen pengujian: tabel black-box (Excel/CSV), hasil SUS, atau laporan unit test (JUnit XML). Isi kode tidak dikirim ke AI; hanya ringkasan strukturnya.",
    items: [
      ["Folder proyek aplikasi (kode sumber)", (c) => c.project],
      ["Screenshot antarmuka", (c) => c.nFig > 0],
      ["Diagram rancangan (use case, ERD, arsitektur, flowchart)", (c) => /use.?case|erd|arsitektur|architecture|class|activity|sequence|flow|diagram|uml|mockup|wireframe/.test(c.fig)],
      ["Hasil pengujian black-box atau unit test", (c) => /black.?box|test.?case|skenario|pengujian|junit|unit.?test|hasil pengujian/.test(c.all)],
      ["Evaluasi pengguna (SUS, UAT, kuesioner)", (c) => /\bsus\b|usability|kegunaan|kuesioner|questionnaire|\buat\b|acceptance/.test(c.all)],
    ],
  },
};
EXPECT.mixed = { how: `${EXPECT.stats.how} ${EXPECT.qual.how}`, items: [EXPECT.stats.items[0], EXPECT.stats.items[2], EXPECT.stats.items[4], EXPECT.qual.items[0], EXPECT.qual.items[1]] };
function autoProfile() {
  const m = `${state.me.method} ${state.me.dataAvail} ${state.me.title} ${state.me.aim}`.toLowerCase();
  const ap = effectiveApproach(); const I = state.results.items;
  const tab = I ? I.tables.map((t) => `${t.name} ${t.headers.join(" ")}`).join(" ").toLowerCase() : "";
  if (I?.project || ap === "dsr") return "dsr";
  if (/smartpls|pls-sem|sem-pls|structural equation|persamaan struktural|\bamos\b|lisrel|lavaan/.test(m) || /outer.?loading|htmt|average variance|path coef/.test(tab)) return "sem";
  if (ap === "qual") return "qual";
  if (ap === "mixed") return "mixed";
  if (/machine learning|deep learning|neural|klasifikasi|classification|deteksi|detection|bert|cnn|lstm|transformer|random forest|svm|xgboost|yolo|computational|komputasi/.test(m) || /accuracy|\bf1|rmse|precision/.test(tab)) return "ml";
  if (/wawancara|interview|fgd|tematik|thematic|nvivo|atlas/.test(m)) return "qual";
  if (/aplikasi|sistem informasi|prototype|prototipe|website|mobile app|pengembangan sistem/.test(m)) return "dsr";
  return ap === "quant" ? "stats" : "ml";
}
const rsProfile = () => state.results.profile || autoProfile();
function rsCorpus() {
  const I = state.results.items;
  if (!I) return null;
  const tab = I.tables.map((t) => `${t.name} ${t.headers.join(" ")} ${t.rows.map((r) => r[0]).join(" ")}`).join(" ").toLowerCase();
  const fig = I.figures.map((f) => f.name).join(" ").toLowerCase();
  const txt = I.texts.map((t) => `${t.name} ${String(t.text).slice(0, 1500)}`).join(" ").toLowerCase();
  return { tab, fig, all: `${(I.files || []).join(" ")} ${tab} ${fig} ${txt}`.toLowerCase(), nFig: I.figures.length, project: !!I.project, transcripts: I.texts.filter((t) => t.kind === "transcript" || String(t.text).length > 2000).length };
}
function expectHtml() {
  const p = rsProfile(); const E = EXPECT[p]; const c = rsCorpus();
  const items = E.items.map(([label, test]) => { const ok = c ? test(c) : null; return `<li class="${ok === null ? "" : ok ? "ok" : "miss"}">${ok === null ? "•" : ok ? "✓" : "○"} ${esc(label)}${ok === false ? ' <span class="hint">(belum terdeteksi)</span>' : ""}</li>`; }).join("");
  return `<div class="rs-expect">
    <label class="field rs-prof"><span>Jenis analisis${state.results.profile ? "" : " (otomatis dari judul dan rencana metode)"}</span>
      <select data-act="rs-profile"><option value="">Otomatis: ${esc(PROFILE_LIST.find(([k]) => k === autoProfile())[1])}</option>${PROFILE_LIST.map(([k, l]) => `<option value="${k}" ${state.results.profile === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
    <div class="hint"><b>Isi ZIP yang disarankan:</b></div>
    <ul class="rs-checklist">${items}</ul>
    <p class="hint" style="margin:0"><b>Cara ekspor:</b> ${E.how}</p>
  </div>`;
}
function projectHtml(p) {
  if (!p) return "";
  return `<div class="alert info"><b>Proyek aplikasi terdeteksi: ${esc(p.name)}</b><br>
    ${p.files} file · ${p.languages.map((l) => `${esc(l.lang)} (${l.files})`).join(", ") || "bahasa belum terdeteksi"}<br>
    Teknologi: ${esc(p.stack.join(", ") || "belum terdeteksi")}${p.dbTables.length ? `<br>Tabel basis data (${p.dbTables.length}): ${esc(p.dbTables.slice(0, 15).join(", "))}${p.dbTables.length > 15 ? "…" : ""}` : ""}
    ${p.secretsSkipped ? `<br>${p.secretsSkipped} berkas rahasia (.env, kunci, kredensial) dilewati dan tidak dibaca.` : ""}<br>
    <span class="hint">Isi kode tidak dikirim ke AI; hanya ringkasan ini.</span></div>`;
}
const CHECK_ICON = { ok: "✓", warn: "!", info: "i" };
function checksHtml(list) {
  if (!list?.length) return "";
  return `<div class="rs-checks"><b>Pemeriksaan otomatis atas file Anda</b> <span class="hint">(membandingkan nilai yang dilaporkan dengan ambang yang lazim; cantumkan rujukan ambangnya di paper)</span><ul>${list.map((c) => `<li class="${c.status}"><span class="ci">${CHECK_ICON[c.status] || "•"}</span>${esc(c.text)}</li>`).join("")}</ul></div>`;
}
function rsSugOf(id) {
  const s = state.results.sug; if (!s) return null;
  return s.tables.find((x) => x.id === id) || s.newTables.find((x) => x.id === id) || s.figures.find((x) => x.id === id) || null;
}
function rsAll() {
  const R = state.results; const s = R.sug; const I = R.items;
  if (!s || !I) return { tables: [], figures: [] };
  const tables = [
    ...I.tables.map((t) => ({ ...t, ...(s.tables.find((x) => x.id === t.id) || { use: false }) })),
    ...s.newTables.map((t) => ({ ...t, name: `disusun dari ${I.texts.find((x) => x.id === t.source)?.name || t.source}`, extracted: true })),
  ];
  const figures = I.figures.map((f) => ({ ...f, ...(s.figures.find((x) => x.id === f.id) || { use: false }) }));
  return { tables, figures };
}
function methodRefsFig1() {
  const m = state.draft.data?.sections?.[2];
  return !!m && /(Fig\.|Gambar|Figure)\s*1\b/.test(m.paragraphs.join(" "));
}
// Nomor tabel/gambar: Tabel I = matriks gap; urut bagian (metode dulu) lalu urutan disebut di teks.
function rsLabels() {
  const { tables, figures } = rsAll();
  const text = (state.results.sug?.results || []).map((p) => p.text).join(" ");
  const pos = (k, id) => { const i = text.indexOf(`{{${k}:${id}}}`); return i < 0 ? 1e9 : i; };
  const order = (list, k) => list.filter((x) => x.use).sort((a, b) => (a.placement === b.placement ? pos(k, a.id) - pos(k, b.id) : a.placement === "method" ? -1 : 1));
  const labels = {};
  let tn = state.gap.matrix?.rows?.length ? 1 : 0;
  const T = order(tables, "table"), F = order(figures, "figure");
  for (const t of T) labels[t.id] = `${isId() ? "Tabel" : "Table"} ${ROMAN[tn++] || tn}`;
  const hasMethodFig = F.some((f) => f.placement === "method");
  const placeholderFig1 = !hasMethodFig && methodRefsFig1();
  let fn = placeholderFig1 ? 2 : 1;
  for (const f of F) labels[f.id] = `${isId() ? "Gambar" : "Fig."} ${fn++}`;
  return { labels, T, F, hasMethodFig, placeholderFig1 };
}
function fillTokens(text, labels) {
  const { tables, figures } = rsAll();
  const all = new Map([...tables, ...figures].map((x) => [x.id, x]));
  return String(text)
    .replace(RS_TOKEN, (m, k, id) => labels[id] || `[${k === "table" ? (isId() ? "Tabel" : "Table") : isId() ? "Gambar" : "Fig."}: ${all.get(id)?.caption || id}]`)
    .replace(/\b(?:Tabel|Table)\s+(?=(?:Tabel|Table)\s+[IVX]+\b)/g, "")
    .replace(/(?:\bGambar|\bFigure|\bFig\.)\s+(?=(?:Gambar|Fig\.)\s+\d)/g, "");
}
const rsSig = () => JSON.stringify(rsLabels().labels) + JSON.stringify(rsAll().tables.concat(rsAll().figures).filter((x) => x.use).map((x) => [x.id, x.caption, x.placement]));
function fmtCell(c) {
  const d = state.results.dec;
  return d && /^-?\d+\.\d+$/.test(String(c).trim()) && String(c).split(".")[1].length > Number(d) ? Number(c).toFixed(Number(d)) : c;
}
function miniTable(t, max = 6) {
  const cols = Math.min(t.headers.length, 7);
  return `<div class="mini-wrap"><table class="mini-table"><tr>${t.headers.slice(0, cols).map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${t.rows.slice(0, max).map((r) => `<tr>${r.slice(0, cols).map((c) => `<td>${esc(fmtCell(c))}</td>`).join("")}</tr>`).join("")}</table>${t.rows.length > max || t.headers.length > cols ? `<div class="hint">… ${t.rows.length} baris × ${t.headers.length} kolom</div>` : ""}</div>`;
}
function flagHtml(text, flags, map, quotes) {
  let h = renderRich(text, map);
  for (const q of quotes || []) { const e = esc(q); if (h.includes(e)) h = h.split(e).join(`<mark class="numflag" title="Kutipan ini tidak ditemukan kata per kata di transkrip Anda">${e}</mark>`); }
  for (const f of flags || []) h = h.split(esc(f)).join(`<mark class="numflag" title="Angka ini tidak ditemukan di file Anda">${esc(f)}</mark>`);
  return h;
}
function rsParas(key, ps, flags, labels, quotes) {
  const roles = ROLES[key]; const map = citationMap().map;
  const ci = (r) => roles.find(([k]) => k === r)?.[3] ?? 0;
  const lab = (r) => roles.find(([k]) => k === r)?.[1] || "Belum ditandai";
  return ps.map((p, i) => `<div class="sm-para ${p.role ? `rc${ci(p.role)}` : "sm-none"}"><span class="sm-tag">${esc(lab(p.role))}</span>${flagHtml(fillTokens(p.text, labels), flags?.[i], map, quotes?.[i])}</div>`).join("");
}
function rsItemHtml(x, kind, labels) {
  const lab = labels[x.id];
  const thumb = kind === "figure"
    ? (figData[x.id] ? `<img src="${figData[x.id]}" alt="${esc(x.name)}" loading="lazy">` : '<div class="alert warn">Gambar tidak tersimpan di browser ini. Unggah ulang ZIP.</div>')
    : miniTable(x);
  return `<li class="rs-item ${x.use ? "" : "rs-off"}">
    <div class="rs-thumb">${thumb}</div>
    <div class="rs-ctl">
      <label class="rs-use"><input type="checkbox" data-act="rs-use" data-id="${x.id}" ${x.use ? "checked" : ""}> <b>${x.use && lab ? esc(lab) : "Tidak dipakai"}</b></label>
      <div class="hint rs-name">${esc(x.name)}</div>
      ${x.why ? `<div class="hint">AI: ${esc(x.why)}</div>` : ""}
      ${x.flags?.length ? `<div class="alert err">Angka ${x.flags.map(esc).join(", ")} tidak ditemukan di output aslinya. Periksa sebelum dipakai.</div>` : ""}
      <label class="field"><span>Caption</span><input data-act="rs-cap" data-id="${x.id}" value="${esc(x.caption || "")}"></label>
      <label class="field"><span>Letak</span><select data-act="rs-place" data-id="${x.id}"><option value="results" ${x.placement !== "method" ? "selected" : ""}>Hasil dan Pembahasan</option><option value="method" ${x.placement === "method" ? "selected" : ""}>Metode</option></select></label>
    </div></li>`;
}
function resultsCard() {
  const d = state.draft.data; const R = state.results; const I = R.items;
  if (!d) return `<section class="card human"><h2>Hasil analisis Anda (opsional)</h2><p class="hint" style="margin:0">Setelah draf tersusun, unggah hasil olahan data Anda sendiri (ZIP) agar AI menata tabel, gambar, serta mengisi Hasil dan Pembahasan, Kesimpulan, dan Abstrak dari angka Anda.</p></section>`;
  const n = I ? I.figures.length + I.tables.length + I.texts.length + (I.project ? 1 : 0) : 0;
  const inv = (I ? projectHtml(I.project) : "") + (I ? `
    <div class="rs-inv"><span class="chip">${I.figures.length} gambar</span><span class="chip">${I.tables.length} tabel</span><span class="chip">${I.texts.length} output teks/kode</span>${I.raw.length ? `<span class="chip warn">${I.raw.length} data mentah (tidak dikirim)</span>` : ""}${I.ignored.length ? `<span class="chip">${I.ignored.length} dilewati</span>` : ""}</div>
    ${I.files?.length ? `<p class="hint">File: ${I.files.map(esc).join(", ")}</p>` : ""}
    ${I.raw.length ? `<details><summary class="hint">Data mentah yang hanya dicatat jumlah baris dan kolomnya</summary><ul class="hint">${I.raw.map((r) => `<li>${esc(r.name)}: ${r.rows} baris; ${esc(r.headers.slice(0, 8).join(", "))}${r.headers.length > 8 ? "…" : ""}</li>`).join("")}</ul></details>` : ""}
    ${I.ignored.length ? `<details><summary class="hint">File yang dilewati</summary><ul class="hint">${I.ignored.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}` : "");
  let sugHtml = "";
  if (R.sug && I) {
    const { labels } = rsLabels();
    const { tables, figures } = rsAll();
    const s = R.sug;
    const nf = [...s.flags.results, ...s.flags.conclusion, ...s.flags.abstract].flat().length;
    const nq = s.quotes ? [...s.quotes.results, ...s.quotes.conclusion, ...s.quotes.abstract].flat().length : 0;
    const stale = R.applied && R.applied.sig !== rsSig();
    sugHtml = `
      <h3>Saran AI</h3>
      ${s.missing.length ? `<div class="alert warn"><b>Yang masih akan ditanyakan reviewer:</b><ul>${s.missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
      ${figures.length ? `<h4>Gambar (${figures.filter((f) => f.use).length} dipakai)</h4><ul class="rs-list">${figures.map((f) => rsItemHtml(f, "figure", labels)).join("")}</ul>` : ""}
      ${tables.length ? `<h4>Tabel (${tables.filter((t) => t.use).length} dipakai)</h4>
        <label class="field rs-dec"><span>Desimal di tabel</span><select data-act="rs-dec"><option value="">Sesuai file</option>${["2", "3", "4"].map((v) => `<option value="${v}" ${R.dec === v ? "selected" : ""}>${v} desimal</option>`).join("")}</select></label>
        <ul class="rs-list">${tables.map((t) => rsItemHtml(t, "table", labels)).join("")}</ul>` : ""}
      ${checksHtml(s.checks)}
      ${nf ? `<div class="alert err"><b>${nf} angka di teks usulan tidak ditemukan di file Anda</b> (ditandai merah). Bisa jadi hasil pembulatan yang berbeda, atau AI keliru. Periksa dan perbaiki sebelum dipakai.</div>` : '<div class="alert ok">✓ Semua angka di teks usulan ditemukan di file hasil Anda.</div>'}
      ${nq ? `<div class="alert err"><b>${nq} kutipan tidak ditemukan kata per kata di transkrip Anda</b> (ditandai merah). Ganti dengan kutipan asli atau hapus; mengubah kutipan informan termasuk fabrikasi.</div>` : s.quotes && ["qual", "mixed"].includes(s.profile) ? '<div class="alert ok">✓ Semua kutipan cocok kata per kata dengan transkrip Anda.</div>' : ""}
      <details class="rs-prev" open><summary><b>${esc(s.heading?.results || "Results and Discussion")}</b> (usulan)</summary>${rsParas("results", s.results, s.flags.results, labels, s.quotes?.results)}</details>
      <details class="rs-prev"><summary><b>${esc(s.heading?.conclusion || "Conclusion")}</b> (usulan)</summary>${rsParas("conclusion", s.conclusion, s.flags.conclusion, labels, s.quotes?.conclusion)}</details>
      <details class="rs-prev"><summary><b>${isId() ? "Abstrak" : "Abstract"}</b> (usulan)</summary>${rsParas("abstract", s.abstract, s.flags.abstract, labels, s.quotes?.abstract)}</details>
      ${stale ? '<div class="alert warn">Pilihan atau caption berubah setelah diterapkan. Klik <b>Terapkan ulang</b> agar nomor tabel dan gambar di teks sesuai.</div>' : ""}
      <div class="row-btns">${btn("results-apply", R.applied ? "Terapkan ulang ke draf" : "Terapkan ke draf", { kind: "primary" })}${R.applied ? btn("results-undo", "Kembalikan draf sebelumnya", { kind: "ghost" }) : ""}</div>
      ${R.applied ? `<div class="alert ok">✓ Diterapkan: bagian Hasil dan Pembahasan, Kesimpulan, dan Abstrak di atas sudah diganti. Tabel dan gambar ikut tampil di pratinjau dan file .docx (Langkah 5).</div>` : '<p class="hint">Menerapkan akan mengganti bagian Hasil dan Pembahasan, Kesimpulan, dan Abstrak. Versi sebelumnya disimpan dan bisa dikembalikan.</p>'}`;
  }
  return `
    <section class="card ai" id="resultsCard">
      <h2>Hasil analisis Anda: unggah ZIP</h2>
      <p class="hint" style="margin:0">Olah data atau bangun sistem Anda sendiri (Python, SPSS, SmartPLS, NVivo, Excel, dan lain-lain), lalu kemas hasilnya dalam satu ZIP: <b>tabel</b> (Excel, CSV, HTML, JSON), <b>gambar</b> (PNG, JPG), <b>output teks</b> (TXT, LOG), <b>transkrip</b> (DOCX, TXT), <b>notebook .ipynb</b> yang sudah dijalankan, atau <b>folder proyek aplikasi</b>. Research Lab tidak menghitung ulang data; AI hanya menata tabel dan gambar, lalu menulis Hasil dan Pembahasan, Kesimpulan, dan Abstrak dari angka dan kutipan Anda.</p>
      ${expectHtml()}
      <div class="alert info">File dibaca di browser. Yang dikirim ke AI hanya tabel hasil (maks. 40 baris), cuplikan output teks atau transkrip, ringkasan struktur proyek, serta nama dan ukuran gambar; isi gambar dan isi kode tidak dikirim. Anonimkan nama responden atau informan sebelum mengunggah. File besar (lebih dari ${60} baris) dianggap data mentah dan hanya dicatat jumlah baris serta kolomnya.</div>
      <div class="row-btns">
        <label class="btn ghost file-btn ${busy["results-files"] ? "disabled" : ""}">${busy["results-files"] ? '<span class="spin" aria-hidden="true"></span>Membaca file…' : I ? "Ganti file hasil" : "Pilih ZIP atau file hasil"}<input type="file" data-act="results-files" multiple accept=".zip,.csv,.tsv,.xlsx,.xlsm,.html,.htm,.docx,.json,.xml,.txt,.log,.md,.out,.ipynb,.py,.r,.png,.jpg,.jpeg,.webp" ${busy["results-files"] ? "disabled" : ""}></label>
        ${btn("results-suggest", R.sug ? "Minta saran ulang" : "AI: sarankan tabel, gambar, dan isi hasil", { disabled: !n, busyLabel: "Membaca hasil Anda… (20–60 detik)" })}
      </div>
      ${errBox("results-files")}${errBox("results-suggest")}
      ${inv}
      ${promptViewer("results")}
      ${sugHtml}
    </section>`;
}
// Paket tabel/gambar untuk pratinjau, ekspor .docx, dan reviewer.
function rsPlaced() {
  const R = state.results;
  if (!R.applied || !R.sug) return { tables: [], figures: [], placeholderFig1: false };
  const { labels, T, F, placeholderFig1 } = rsLabels();
  return {
    tables: T.map((t) => ({ label: labels[t.id], caption: t.caption, placement: t.placement, headers: t.headers.slice(0, 8), rows: t.rows.slice(0, 40).map((r) => r.slice(0, 8).map(fmtCell)) })),
    figures: F.map((f) => ({ label: labels[f.id], caption: f.caption, placement: f.placement, name: f.name, w: f.w, h: f.h, data: figData[f.id] || "" })),
    placeholderFig1,
  };
}
function rsMediaText() {
  const P = rsPlaced();
  return [...P.tables.map((t) => `${t.label}. ${t.caption}\n${[t.headers.join(" | "), ...t.rows.map((r) => r.join(" | "))].join("\n")}`),
    ...P.figures.map((f) => `${f.label}. ${f.caption} (image supplied by the authors)`)].join("\n\n");
}
function rsBlocksFor(idx, paragraphs, map) {
  const P = rsPlaced(); const want = idx === 2 ? "method" : idx === 3 ? "results" : "";
  const out = new Map(); if (!want) return out;
  const blocks = [
    ...(want === "method" && P.placeholderFig1 ? [{ label: isId() ? "Gambar 1" : "Fig. 1", html: `<div class="fcap"><mark>[${isId() ? "Gambar 1: sisipkan alur penelitian" : "Fig. 1: insert research workflow"}]</mark></div>` }] : []),
    ...P.tables.filter((t) => t.placement === want).map((t) => ({ label: t.label, html: `<div class="tcap">${esc(t.label)}. ${esc(t.caption)}</div><table><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>` })),
    ...P.figures.filter((f) => f.placement === want).map((f) => ({ label: f.label, html: `<figure class="pfig">${f.data ? `<img src="${f.data}" alt="">` : "<mark>[gambar perlu diunggah ulang]</mark>"}<figcaption>${esc(f.label)}. ${esc(f.caption)}</figcaption></figure>` })),
  ];
  for (const b of blocks) {
    const re = new RegExp(`(^|[^\\w])${b.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`);
    let at = paragraphs.findIndex((p) => re.test(p));
    if (at < 0) at = paragraphs.length - 1;
    if (!out.has(at)) out.set(at, []);
    out.get(at).push(b.html);
  }
  return out;
}

// ---------- Langkah 5 ----------
function paperPreview() {
  const d = state.draft.data;
  if (!d) return '<div class="alert warn">Draf belum ada. Susun draf di langkah sebelumnya.</div>';
  const { order, map } = citationMap();
  const byN = new Map(state.lit.selected.map((w) => [w.n, w]));
  // Format blok penulis IEEE (9 pt): nama; departemen, fakultas, organisasi (miring); kota, negara; email atau ORCID.
  const authors = state.me.authors.map((a) => `<div class="au"><span>${esc(a.name || "[Nama Penulis]")}</span>${[a.dept, a.faculty, a.org].filter((x) => x.trim()).map((x) => `<i>${esc(x).replace(/\n/g, "<br>")}</i>`).join("")}${[a.city, a.email].filter((x) => x.trim()).map((x) => `<span>${esc(x)}</span>`).join("")}</div>`).join("");
  const m = state.gap.matrix;
  const matrix = m?.rows?.length ? `<div class="tcap">${isId() ? "Tabel I. Matriks Gap Studi Terdahulu" : "Table I. Gap Matrix of Reviewed Studies"}</div><table><tr><th>Ref.</th>${m.aspects.map((a) => `<th>${esc(a)}</th>`).join("")}</tr>${m.rows.filter((r) => map.has(r.n)).sort((a, b) => map.get(a.n) - map.get(b.n)).map((r) => `<tr><td>[${map.get(r.n)}]</td>${r.cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>` : "";
  const ack = state.exp.ackEdited ? state.exp.ack : disclosure();
  return `<article class="paper-preview" aria-label="Pratinjau paper">
    <div class="pt">${esc(state.me.title || "[Judul Paper]")}</div>
    <div class="pa" style="--n:${Math.min(3, state.me.authors.length)}">${authors}</div>
    <div class="cols">
      <p class="abs noindent"><i>${isId() ? "Abstrak" : "Abstract"}</i>—${renderRich(d.abstract, map)}</p>
      <p class="abs noindent"><i>${isId() ? "Kata kunci" : "Keywords"}</i>—${esc(state.draft.keywords)}</p>
      ${d.sections.map((s, i) => { const bl = rsBlocksFor(i, s.paragraphs, map); return `<h4>${["I", "II", "III", "IV", "V", "VI"][i]}. ${esc(s.heading)}</h4>${s.paragraphs.map((p, k) => `<p>${renderRich(p, map)}</p>${(bl.get(k) || []).join("")}`).join("")}${i === 1 ? matrix : ""}`; }).join("")}
      <h4>${isId() ? "Ucapan Terima Kasih" : "Acknowledgment"}</h4><p>${renderRich(ack, null)}</p>
      <h4>Open Contributionship</h4><p>${renderRich(contribStatement(), null)}</p>
      <h4>Open Data</h4><p>${renderRich(openDataStatement(), null)}</p>
      <h4>${isId() ? "Referensi" : "References"}</h4>
      <div class="refs">${order.map((n, i) => `<p>[${i + 1}] ${ieeeRefHtml(byN.get(n))}</p>`).join("")}</div>
    </div>
  </article>`;
}
function contribCard() {
  const roles = Object.keys(CREDIT).map((r) => (isId() ? CREDIT[r] : r)).join("; ");
  const rows = state.me.authors.map((a, i) => `
    <label class="field"><span>${i + 1}. ${esc(a.name || `Penulis ${i + 1}`)}${a.dept || a.prodi ? ` · ${esc(oneLine(a.dept || a.prodi))}` : ""}</span>
      <input data-act="contrib" data-i="${i}" value="${esc(state.exp.contrib[i] || "")}" placeholder="${isId() ? "mis. konseptualisasi, analisis penjualan e-commerce, penulisan—draf awal" : "e.g. conceptualization, e-commerce sales analysis, writing—original draft"}"></label>`).join("");
  return `
    <section class="card human">
      <h2>Open Contributionship</h2>
      <p class="hint" style="margin:0">Tuliskan peran setiap penulis (pisahkan dengan koma) memakai taksonomi CRediT, ditambah tugas spesifik bila perlu. Kalimat pernyataan disusun otomatis.</p>
      <div>${btn("suggest-contrib", "AI: sarankan pembagian peran", { kind: "ai", disabled: !authorsOk(), busyLabel: "Menyusun saran…" })}</div>
      ${errBox("suggest-contrib")}
      ${promptViewer("contrib")}
      ${state.exp.contribAi ? '<div class="alert info">Ini saran AI berdasarkan prodi dan rencana metode. Sesuaikan dengan siapa yang benar-benar mengerjakan apa.</div>' : ""}
      <details><summary>Daftar 14 peran CRediT</summary><p class="hint" style="margin:4px 0 0">${esc(roles)}</p></details>
      <div class="grid2">${rows}</div>
      <div class="statement" id="contribPreview">${renderRich(contribStatement(), null)}</div>
    </section>`;
}
function openDataCard() {
  const o = state.exp.od;
  const opt = (v, label) => `<label class="check-pill"><input type="radio" name="odtype" data-act="od-type" value="${v}" ${o.type === v ? "checked" : ""}>${label}</label>`;
  const f = (key, label, ph) => `<label class="field"><span>${label}</span><input data-bind="exp.od.${key}" data-live="od" value="${esc(o[key])}" placeholder="${ph}"></label>`;
  const fields = !o.type ? '<div class="alert warn">Pilih dulu jenis data yang sesuai dengan Metode Anda. Pernyataan Open Data harus konsisten dengan bagian Metode.</div>' : o.type === "third"
    ? `<div class="grid3">${f("name", "Nama dataset", "mis. MIT-BIH Arrhythmia Database")}${f("source", "Penyedia / repositori", "mis. PhysioNet")}${f("url", "URL atau DOI", "https://…")}</div>`
    : o.type === "own"
      ? `<div class="grid2">${f("source", "Repositori tempat data dibagikan", "mis. Zenodo, Mendeley Data, Figshare")}${f("url", "URL atau DOI dataset", "https://doi.org/…")}</div>`
      : `<div class="grid2">${f("reason", "Alasan data tidak dibagikan", "mis. kerahasiaan responden")}</div>`;
  return `
    <section class="card human">
      <h2>Open Data</h2>
      <p class="hint" style="margin:0">Nyatakan sumber dan ketersediaan data. Isi dengan data yang benar-benar dipakai atau direncanakan; kolom kosong muncul sebagai placeholder kuning.</p>
      <div class="checks">${opt("third", "Memakai dataset terbuka pihak lain")}${opt("own", "Data sendiri, dibagikan terbuka")}${opt("restricted", "Data tidak dapat dibagikan")}</div>
      ${fields}
      ${o.type ? `<div class="statement" id="odPreview">${renderRich(openDataStatement(), null)}</div>` : ""}
    </section>`;
}

const MANUAL_CHECKS = [
  ["edited", "Tim sudah membaca dan menyunting setiap bagian draf dengan kalimat sendiri."],
  ["doi", "Tim sudah membuka beberapa DOI dan memastikan referensinya memang relevan dengan klaim yang mengutipnya."],
  ["numbers", "Tim paham bahwa setiap [placeholder] hanya boleh diisi dari data dan analisis sendiri."],
  ["roles", "Pembagian peran di Open Contributionship sesuai dengan kontribusi nyata setiap penulis."],
  ["ethics", "Bila memakai data responden, tim akan mengurus persetujuan etik sebelum pengambilan data."],
];

function viewExport() {
  const d = state.draft.data;
  const { order } = citationMap();
  const all = d ? [d.abstract, ...d.sections.flatMap((s) => s.paragraphs)].join("\n") : "";
  const ph = (all.match(PH_RE) || []).length;
  const uncited = state.lit.selected.filter((w) => !order.includes(w.n));
  const ack = state.exp.ackEdited ? state.exp.ack : disclosure();
  const manualOk = MANUAL_CHECKS.every(([k]) => state.exp.checks[k]);
  const contribFilled = state.exp.contrib.filter((c) => c.trim()).length;
  const odPh = (openDataStatement().match(PH_RE) || []).length;
  // Nomor IEEE (urutan kemunculan) untuk referensi tanpa volume dan halaman.
  const incompleteRefs = order.map((n, i) => [i + 1, state.lit.selected.find((w) => w.n === n)]).filter(([, w]) => w && !w.volume && !w.firstPage).map(([i]) => i);
  const refProdi = new Set(order.map((n) => state.lit.selected.find((w) => w.n === n)?.prodi).filter(Boolean)).size;
  const auto = [
    [order.length > 0, `${order.length} referensi dari OpenAlex, semuanya ber-DOI, mewakili ${refProdi} prodi.`],
    [true, "Sitasi di luar daftar referensi terpilih sudah dibuang otomatis."],
    [Boolean(ack.trim()), "Pernyataan penggunaan AI ada di bagian Acknowledgment (sesuai kebijakan IEEE)."],
    [contribFilled === state.me.authors.length, `Open Contributionship terisi untuk ${contribFilled} dari ${state.me.authors.length} penulis.`],
    [Boolean(state.exp.od.type), state.exp.od.type ? "Jenis data Open Data sudah dipilih." : "Jenis data Open Data belum dipilih."],
    [odPh === 0, odPh ? `Pernyataan Open Data masih memiliki ${odPh} placeholder.` : "Pernyataan Open Data lengkap."],
    [order.length >= MIN_PAPERS, order.length >= MIN_PAPERS ? `${order.length} referensi dikutip (minimal ${MIN_PAPERS}).` : `Baru ${order.length} referensi dikutip; paper IEEE umumnya minimal ${MIN_PAPERS}.`],
    [incompleteRefs.length === 0, incompleteRefs.length ? `${incompleteRefs.length} referensi belum lengkap (volume/nomor/halaman): ${incompleteRefs.map((n) => `[${n}]`).join(", ")}. Lengkapi dari halaman DOI-nya.` : "Semua referensi memiliki volume atau halaman."],
    [ph === 0, ph ? `${ph} placeholder di isi naskah masih perlu diisi setelah analisis (ditandai kuning di .docx).` : "Tidak ada placeholder tersisa di isi naskah."],
  ];
  return `
    ${header(4, "Integritas dan ekspor", "Lengkapi Open Contributionship, Open Data, dan pernyataan penggunaan AI, centang checklist, lalu unduh draf dalam template IEEE.")}
    ${paperPreview()}
    ${uncited.length ? `<div class="alert warn">${uncited.length} referensi terpilih belum dikutip dan tidak akan masuk daftar referensi: ${uncited.map((w) => `[${w.n}]`).join(", ")}.</div>` : ""}
    ${contribCard()}
    ${openDataCard()}
    <section class="card human">
      <h2>Pernyataan penggunaan AI</h2>
      <label class="field"><span>Teks Acknowledgment (sunting sesuai kontribusi AI yang sebenarnya)</span><textarea data-act="ack" rows="5">${esc(ack)}</textarea></label>
      <p class="hint">IEEE meminta penggunaan AI diungkapkan di Acknowledgment: nama sistem AI, bagian yang dibantu, dan sejauh mana AI dipakai. Periksa juga kebijakan jurnal atau konferensi tujuan.</p>
    </section>
    <section class="card human">
      <h2>Checklist integritas</h2>
      <ul class="checklist">
        ${auto.map(([ok, t]) => `<li><span class="auto ${ok ? "ok" : "no"}" aria-hidden="true">${ok ? "✓" : "!"}</span><span>${esc(t)}</span></li>`).join("")}
        ${MANUAL_CHECKS.map(([k, t]) => `<li><input type="checkbox" id="chk-${k}" data-act="check" data-k="${k}" ${state.exp.checks[k] ? "checked" : ""}><label for="chk-${k}">${esc(t)}</label></li>`).join("")}
      </ul>
    </section>
    <section class="card">
      <div class="row">
        ${btn("export-docx", "Unduh .docx (template IEEE)", { kind: "primary", disabled: !d || !manualOk || !state.exp.od.type, busyLabel: "Menyiapkan .docx…" })}
        <button type="button" class="btn ghost" data-act="copy-text" ${d ? "" : "disabled"}>Salin teks draf</button>
        <button type="button" class="btn ghost" data-act="export-json">Unduh data sesi (.json)</button>
      </div>
      ${!manualOk || !state.exp.od.type ? '<p class="hint">Tombol unduh aktif setelah jenis data Open Data dipilih dan semua butir checklist manual dicentang.</p>' : ""}
      ${errBox("export-docx")}
    </section>
    ${navRow("Lanjut ke review IEEE")}`;
}

// ---------- aksi ----------
async function runTask(key, fn) {
  busy[key] = true; errors[key] = ""; render();
  try { await fn(); } catch (e) { errors[key] = e.message || String(e); }
  busy[key] = false; save(); render();
}
function noteModel(r) { if (r.model) state.meta.model = r.model; if (r.label) state.meta.label = r.label; }
async function doSearch(query, lens) {
  const q = String(query || "").trim();
  if (!q) throw new Error("Isi kata kunci terlebih dahulu.");
  state.lit.query = q;
  if (lens !== undefined) state.lit.lens = lens;
  const r = await api("/api/search", { query: q, yearFrom: state.lit.yearFrom, sort: state.lit.sort });
  state.lit.results = r.results; state.lit.total = r.total; state.lit.searched = true; state.lit.lastLens = state.lit.lens;
  if (r.mock) toast("Mode uji: hasil pencarian adalah data contoh.");
}

const actions = {
  goto: (el) => goto(Number(el.dataset.i)),
  "clear-keys": () => { clearKeys(); keyCheck = { ai: null, openalex: null }; updateChip(); render(); toast("Key dihapus dari perangkat ini."); },
  "check-keys": () => runTask("check-keys", async () => {
    const r = await api("/api/check", {});
    keyCheck = { ai: r.ai || null, openalex: r.openalex || null };
  }),
  "add-author": () => {
    if (state.me.authors.length < MAX_AUTHORS) state.me.authors.push(blankAuthor());
    syncContrib(); save(); render();
  },
  "del-author": (el) => {
    const i = Number(el.dataset.i);
    state.me.authors.splice(i, 1); state.exp.contrib.splice(i, 1);
    syncContrib(); save(); render();
  },
  "copy-org": () => {
    const a0 = state.me.authors[0];
    state.me.authors.forEach((a, i) => { if (i > 0) { for (const k of ["org", "city"]) if (!a[k]) a[k] = a0[k]; } });
    save(); render(); toast("Universitas dan kota disalin ke penulis yang masih kosong.");
  },
  "suggest-keywords": () => runTask("suggest-keywords", async () => {
    const r = await api("/api/llm", { task: "keywords", ...ctx(), prodi: lensProdi() });
    // Hanya lensa untuk rumpun yang terwakili di tim.
    state.lit.suggestions = r.result.queries; state.lit.novelty = r.result.novelty || ""; state.lit.perProdi = r.result.perProdi || []; state.lit.concepts = r.result.concepts; noteModel(r);
    if (!state.lit.query && r.result.queries[0]) state.lit.query = r.result.queries[0];
  }),
  "use-novelty": () => runTask("search", () => doSearch(state.lit.novelty, "")),
  "use-query": (el) => runTask("search", () => doSearch(state.lit.suggestions[Number(el.dataset.i)], "")),
  "use-lens": (el) => {
    const x = state.lit.perProdi[Number(el.dataset.i)];
    runTask("search", () => doSearch(x.query, teamProdi().includes(x.prodi) ? x.prodi : ""));
  },
  search: () => runTask("search", () => doSearch(state.lit.query)),
  "remove-work": (el) => { state.lit.selected = state.lit.selected.filter((w) => w.id !== el.dataset.id); save(); render(); },
  "make-gap": () => runTask("make-gap", async () => {
    const r = await api("/api/llm", { task: "gap", ...ctx(), papers: paperPayload(false) });
    state.gap.matrix = { aspects: r.result.aspects, rows: r.result.rows };
    state.gap.gaps = r.result.gaps; state.gap.chosen = -1; noteModel(r);
  }),
  cell: (el) => {
    const order = ["Yes", "Partial", "No"];
    const row = state.gap.matrix.rows[Number(el.dataset.r)];
    const c = Number(el.dataset.c);
    row.cells[c] = order[(order.indexOf(row.cells[c]) + 1) % 3];
    save(); render();
  },
  "suggest-titles": () => runTask("suggest-titles", async () => {
    if (!state.draft.originalTitle) state.draft.originalTitle = state.me.title;
    const r = await api("/api/llm", { task: "titles", title: state.draft.originalTitle, aim: state.me.aim, prodi: teamProdi(), gap: state.gap.text, lang: state.me.lang });
    state.draft.titleSugs = r.result.titles; state.draft.keywordSugs = r.result.keywords; noteModel(r);
  }),
  "suggest-method": () => runTask("suggest-method", async () => {
    const r = await api("/api/llm", { task: "method", ...ctx(), gap: state.gap.text, lang: state.me.lang, papers: paperPayload(false), matrix: state.gap.matrix, approach: state.me.approach, dataAvail: state.me.dataAvail });
    state.draft.methodSugs = r.result.options; state.draft.methodChosen = -1; noteModel(r);
  }),
  "review-draft": () => runTask("review-draft", async () => {
    const d = state.draft.data;
    const { order } = citationMap();
    const refs = order.map((n, i) => { const w = state.lit.selected.find((x) => x.n === n); return w ? { n: i + 1, title: w.title, year: w.year, venue: w.venue, complete: Boolean(w.volume || w.firstPage) } : null; }).filter(Boolean);
    // Teks dikirim dengan nomor sitasi IEEE final (urutan kemunculan), sama dengan .docx.
    const renum = (t) => String(t || "").replace(CITE_RE, (m, n) => { const k = order.indexOf(Number(n)); return k >= 0 ? `[${k + 1}]` : m; });
    const r = await api("/api/llm", {
      task: "review", title: state.me.title, lang: state.me.lang, approach: effectiveApproach(),
      abstract: d.abstract, keywords: state.draft.keywords,
      sections: d.sections.map((x) => ({ heading: x.heading, paragraphs: x.paragraphs.map(renum) })),
      references: refs,
      authors: state.me.authors.map((a) => ({ name: a.name, dept: oneLine(a.dept), faculty: oneLine(a.faculty), org: a.org, city: a.city, email: a.email })),
      acknowledgment: state.exp.ackEdited ? state.exp.ack : disclosure(),
      contributionship: contribStatement(), openData: openDataStatement(),
      media: rsMediaText(),
    });
    state.review.data = r.result; state.review.done = []; noteModel(r);
  }),
  "add-keyword": (el) => {
    const k = state.draft.keywordSugs[Number(el.dataset.i)];
    const list = state.draft.keywords.split(",").map((s) => s.trim()).filter(Boolean);
    if (!list.some((x) => x.toLowerCase() === k.toLowerCase())) list.push(k);
    state.draft.keywords = list.join(", "); save(); render();
  },
  "use-keywords": () => { state.draft.keywords = state.draft.keywordSugs.join(", "); save(); render(); },
  "results-suggest": () => runTask("results-suggest", async () => {
    const d = state.draft.data; const I = state.results.items; if (!d || !I) return;
    const r = await api("/api/llm", {
      task: "results", title: state.me.title, gap: state.gap.text, lang: state.me.lang, approach: effectiveApproach(),
      abstract: d.abstract, sections: d.sections.map((x) => ({ heading: x.heading, paragraphs: x.paragraphs })), papers: paperPayload(false),
      tables: I.tables.map((t) => ({ id: t.id, name: t.name, source: t.source, headers: t.headers, rows: t.rows.slice(0, 40) })),
      texts: I.texts, figures: I.figures.map(({ id, name, w, h, context }) => ({ id, name, w, h, context })), raw: I.raw,
      profile: rsProfile(), project: I.project || null,
    });
    state.results.sug = r.result; noteModel(r);
    if (r.compact) toast("Jawaban pertama terpotong, jadi AI diminta ulang dengan ruang lebih besar.");
  }),
  "results-apply": () => {
    const R = state.results, s = R.sug, d = state.draft.data; if (!s || !d) return;
    if (!R.applied && !window.confirm("Terapkan ke draf? Bagian Hasil dan Pembahasan, Kesimpulan, dan Abstrak akan diganti. Versi sebelumnya disimpan dan bisa dikembalikan.")) return;
    const { labels, F, hasMethodFig } = rsLabels();
    const backup = R.applied?.backup || structuredClone({ abstract: d.abstract, abstractParts: d.abstractParts, sections: d.sections });
    const put = (i, ps) => { const x = d.sections[i]; if (!x) return; x.paragraphs = ps.map((p) => fillTokens(p.text, labels)); x.roles = ps.map((p) => p.role); x.orig = [...x.paragraphs]; };
    if (s.results.length) put(3, s.results);
    if (s.conclusion.length) put(4, s.conclusion);
    if (s.abstract.length) { d.abstractParts = s.abstract.map((p) => ({ role: p.role, text: p.text })); d.abstract = s.abstract.map((p) => p.text).join(" "); }
    // Placeholder "[Fig. 1: alur penelitian]" di Metode diganti label gambar metode yang diunggah.
    if (hasMethodFig && d.sections[2]) {
      const lab = labels[F.find((f) => f.placement === "method").id];
      d.sections[2].paragraphs = d.sections[2].paragraphs.map((p) => p.replace(/\[(?:Fig\.|Gambar|Figure)\s*1\b[^\]]*\]/g, lab));
    }
    R.applied = { backup, at: Date.now(), sig: rsSig() };
    save(); render();
    toast("Diterapkan. Periksa angka bertanda merah dan sunting teksnya bila perlu.", { ok: true, ms: 5000 });
  },
  "results-undo": () => {
    const R = state.results, d = state.draft.data; if (!R.applied || !d) return;
    if (!window.confirm("Kembalikan draf sebelum hasil diterapkan? Suntingan setelah penerapan akan hilang.")) return;
    Object.assign(d, structuredClone(R.applied.backup)); R.applied = null; save(); render(); toast("Draf dikembalikan ke versi sebelum hasil diterapkan.");
  },
  "make-draft": () => {
    if (state.draft.data && !window.confirm("Susun ulang draf? Suntingan pada draf saat ini akan tertimpa.")) return;
    runTask("make-draft", async () => {
      const r = await api("/api/llm", {
        task: "draft", ...ctx(), gap: state.gap.text, lang: state.me.lang, papers: paperPayload(true), matrix: state.gap.matrix, method: state.me.method, approach: effectiveApproach(),
      });
      r.result.sections.forEach((x) => { x.orig = [...x.paragraphs]; });
      if (r.compact) toast("Jawaban pertama terlalu panjang, jadi draf disusun ulang otomatis dalam versi ringkas.");
      state.draft.data = r.result;
      state.results.applied = null; // draf baru: hasil unggahan perlu diterapkan ulang
      if (!state.draft.keywords.trim() && r.result.keywords?.length) state.draft.keywords = r.result.keywords.join(", ");
      noteModel(r);
    });
  },
  "suggest-contrib": () => {
    if (state.exp.contrib.some((c) => c.trim()) && !window.confirm("Ganti isian kontribusi dengan saran AI?")) return;
    runTask("suggest-contrib", async () => {
      const r = await api("/api/llm", { task: "contrib", title: state.me.title, aim: state.me.aim, method: state.me.method, lang: state.me.lang, authors: state.me.authors.map((a) => ({ name: a.name, prodi: a.prodi || oneLine(a.dept) })) });
      state.exp.contrib = state.me.authors.map((a, i) => {
        const s = r.result.authors[i] || { roles: [], tasks: [] };
        const roles = s.roles.map((x) => (isId() ? CREDIT[x] || x : x));
        return [...roles.slice(0, 1), ...s.tasks, ...roles.slice(1)].join(", ");
      });
      state.exp.contribAi = true; noteModel(r);
    });
  },
  "export-docx": () => runTask("export-docx", async () => {
    const d = state.draft.data;
    const resp = await api("/api/docx", {
      lang: state.me.lang, title: state.me.title, authors: state.me.authors,
      abstract: d.abstract, keywords: state.draft.keywords.split(",").map((s) => s.trim()).filter(Boolean),
      sections: d.sections, matrix: state.gap.matrix, papers: state.lit.selected,
      acknowledgment: state.exp.ackEdited ? state.exp.ack : disclosure(),
      contributionship: contribStatement(), openData: openDataStatement(),
      ...(() => {
        // Batas permintaan server ±4,5 MB: gambar yang membuat paket terlalu besar dilewati (dengan pemberitahuan).
        const P = rsPlaced(); let total = 0; const figs = [];
        for (const f of P.figures.filter((x) => x.data)) { if (total + f.data.length > 3_400_000) { toast(`${f.label} tidak ikut ke .docx karena ukuran gambar terlalu besar; sisipkan manual di Word.`, { ms: 7000 }); continue; } total += f.data.length; figs.push(f); }
        return { tables: P.tables, figures: figs, methodFigPlaceholder: P.placeholderFig1 };
      })(),
    }, { raw: true });
    const blob = await resp.blob();
    const name = decodeURIComponent((resp.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || "draf-paper.docx");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("Draf latihan diunduh. Tulis ulang, isi data asli, dan verifikasi sebelum digunakan.");
  }),
  "copy-text": async () => {
    const d = state.draft.data; if (!d) return;
    const { order, map } = citationMap();
    const byN = new Map(state.lit.selected.map((w) => [w.n, w]));
    const strip = (t) => String(t).replace(/\[(\d+)\]/g, (m, n) => (map.has(Number(n)) ? `[${map.get(Number(n))}]` : ""));
    const tmp = document.createElement("div");
    const refs = order.map((n, i) => { tmp.innerHTML = ieeeRefHtml(byN.get(n)); return `[${i + 1}] ${tmp.textContent}`; });
    const text = [state.me.title, "", state.me.authors.map((a) => [a.name, a.dept, a.faculty, a.org, a.city, a.email].map(oneLine).filter((x) => x.trim()).join(", ")).join("\n"), "",
      `Abstract—${d.abstract}`, `Keywords—${state.draft.keywords}`, "",
      ...d.sections.flatMap((s, i) => [`${["I", "II", "III", "IV", "V"][i]}. ${s.heading.toUpperCase()}`, ...s.paragraphs.map(strip), ""]),
      "ACKNOWLEDGMENT", state.exp.ackEdited ? state.exp.ack : disclosure(), "",
      "OPEN CONTRIBUTIONSHIP", contribStatement(), "", "OPEN DATA", openDataStatement(), "",
      "REFERENCES", ...refs].join("\n");
    try { await navigator.clipboard.writeText(text); toast("Teks draf disalin."); }
    catch { toast("Gagal menyalin otomatis. Gunakan Unduh .docx."); }
  },
  "copy-prompt": async (el) => {
    const p = state.prompts?.[el.dataset.task]; if (!p) return;
    try { await navigator.clipboard.writeText(`SYSTEM:\n${p.system}\n\nUSER:\n${p.user}`); toast("Prompt disalin."); }
    catch { toast("Gagal menyalin otomatis; pilih teks prompt secara manual."); }
  },
  "export-json": () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const who = (state.me.authors[0]?.name || "tim").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40);
    a.href = URL.createObjectURL(blob); a.download = `research-lab-${who}.json`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
};

// ---------- delegasi event ----------
const INPUT_ACTS = ["rs-profile", "results-files", "rs-use", "rs-place", "rs-cap", "rs-dec", "consent", "review-done", "approach", "choose-method", "guide-check", "dept-select", "model", "lens", "tag-prodi", "choose-title", "toggle-work", "choose-gap", "check", "lang", "od-type", "aspect", "edit-abstract", "edit-section", "ack", "contrib", "key-ai", "key-openalex"];
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled || INPUT_ACTS.includes(el.dataset.act)) return;
  if (actions[el.dataset.act]) { e.preventDefault(); actions[el.dataset.act](el); }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  const act = el.dataset?.act;
  if (act === "lang") { state.me.lang = el.value; save(); render(); return; }
  if (act === "results-files") {
    const files = [...(el.files || [])]; if (!files.length) return;
    runTask("results-files", async () => {
      const out = await readUploads(files);
      figData = out.figData; delete out.figData; await saveFigs(figData, figNs());
      out.files = files.map((f) => f.name);
      if (!out.figures.length && !out.tables.length && !out.texts.length && !out.project) throw new Error("Tidak ada tabel, gambar, atau output teks yang terbaca. Periksa format file (lihat daftar file yang dilewati).");
      state.results = { ...state.results, items: out, sug: null, applied: state.results.applied };
      toast(`Terbaca: ${out.project ? `proyek ${out.project.name} (${out.project.files} file), ` : ""}${out.figures.length} gambar, ${out.tables.length} tabel, ${out.texts.length} teks.`, { ok: true });
    });
    return;
  }
  if (act === "rs-use") { const x = rsSugOf(el.dataset.id); if (x) x.use = el.checked; save(); render(); return; }
  if (act === "rs-place") { const x = rsSugOf(el.dataset.id); if (x) x.placement = el.value; save(); render(); return; }
  if (act === "rs-profile") { state.results.profile = el.value; save(); render(); return; }
  if (act === "rs-dec") { state.results.dec = el.value; save(); render(); return; }
  if (act === "consent") { state.me.consent = el.checked; save(); render(); return; }
  if (act === "review-done") { state.review.done[Number(el.dataset.i)] = el.checked; save(); render(); return; }
  if (act === "approach") {
    if (state.me.approach !== el.value) { state.me.approach = el.value; state.draft.methodApproach = ""; }
    save(); render(); return;
  }
  if (act === "choose-method") {
    const i = Number(el.value); const o = state.draft.methodSugs[i];
    if (!o) return;
    if (state.me.method.trim() && state.draft.methodChosen < 0 && !window.confirm("Ganti rencana metode yang sudah Anda tulis dengan opsi ini?")) { el.checked = false; return; }
    state.draft.methodChosen = i; state.draft.methodApproach = o.approach || ""; state.me.method = methodText(o); save(); render(); return;
  }
  if (act === "guide-check") {
    const k = el.dataset.k; const arr = state.draft.guideChecks[k] || (state.draft.guideChecks[k] = []);
    arr[Number(el.dataset.i)] = el.checked; save(); return;
  }
  if (act === "dept-select") {
    const a = state.me.authors[Number(el.dataset.i)];
    const d = DEPTS.find((x) => x.key === el.value);
    if (d) Object.assign(a, { deptKey: d.key, dept: d.dept, faculty: d.faculty, prodi: d.prodi });
    else if (el.value === "other") Object.assign(a, { deptKey: "other", dept: a.deptKey === "other" ? a.dept : "", faculty: a.deptKey === "other" ? a.faculty : "", prodi: a.deptKey === "other" ? a.prodi : "" });
    else Object.assign(a, { deptKey: "", dept: "", faculty: "", prodi: "" });
    save(); render(); return;
  }
  if (act === "model") {
    try { localStorage.setItem(MODEL_KEY, el.value); } catch {}
    el.value = chosenModel();
    const n = document.getElementById("modelNote");
    if (n) { const t = modelNote(); n.textContent = t; n.hidden = !t; }
    return;
  }
  if (act === "lens") { state.lit.lens = el.value; save(); return; }
  if (act === "tag-prodi") {
    const w = state.lit.selected.find((x) => x.id === el.dataset.id);
    if (w) w.prodi = el.value;
    save(); render(); return;
  }
  if (act === "od-type") { state.exp.od.type = el.value; save(); render(); return; }
  if (act === "choose-title") {
    const i = Number(el.value);
    if (!state.draft.originalTitle) state.draft.originalTitle = state.me.title;
    state.me.title = i < 0 ? state.draft.originalTitle : state.draft.titleSugs[i].title;
    save(); render(); return;
  }
  if (act === "toggle-work") {
    const id = el.dataset.id;
    if (state.lit.selected.find((w) => w.id === id)) state.lit.selected = state.lit.selected.filter((w) => w.id !== id);
    else {
      if (state.lit.selected.length >= MAX_PAPERS) { el.checked = false; toast(`Maksimal ${MAX_PAPERS} referensi.`); return; }
      const w = state.lit.results.find((x) => x.id === id);
      const n = state.lit.selected.reduce((mx, x) => Math.max(mx, x.n), 0) + 1;
      state.lit.selected.push({ ...w, n, prodi: state.lit.lastLens || "" });
      const k = state.lit.selected.length;
      if (k === MIN_PAPERS) {
        const prodiOk = litProdi().filter((p) => teamProdi().includes(p)).length >= needLitProdi();
        toast(prodiOk
          ? `✓ Sudah memilih ${MIN_PAPERS} referensi. Anda bisa lanjut ke Langkah 3, atau menambah hingga ${MAX_PAPERS}.`
          : `✓ Sudah memilih ${MIN_PAPERS} referensi. Tandai rumpun: minimal ${needLitProdi()} rumpun tim harus terwakili.`, { ok: true, ms: 6000 });
      } else if (k === MAX_PAPERS) toast(`Sudah ${MAX_PAPERS} referensi, batas maksimal tercapai.`, { ok: true, ms: 5000 });
    }
    save(); render(); return;
  }
  if (act === "choose-gap") { const i = Number(el.value); state.gap.chosen = i; state.gap.text = state.gap.gaps[i].statement; save(); render(); return; }
  if (act === "check") { state.exp.checks[el.dataset.k] = el.checked; save(); render(); return; }
  if (el.dataset?.bind && el.tagName === "SELECT") {
    setPath(state, el.dataset.bind, el.value); save();
    if (el.dataset.bind.startsWith("me.authors.")) refreshChrome();
  }
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset?.bind) {
    let v = el.value;
    if (el.type === "number") v = Number(v) || "";
    setPath(state, el.dataset.bind, v);
    // Departemen "Other": nama departemen sekaligus menjadi rumpun untuk referensi lintas prodi.
    const md = el.dataset.bind.match(/^me\.authors\.(\d+)\.dept$/);
    if (md) { const au = state.me.authors[Number(md[1])]; if (au.deptKey === "other") au.prodi = oneLine(v).trim(); }
    const ma = el.dataset.bind.match(/^me\.authors\.(\d+)\./);
    if (ma) { const box = document.querySelectorAll(".author-row")[Number(ma[1])]?.querySelector(".author-warn"); if (box) box.outerHTML = authorWarn(state.me.authors[Number(ma[1])]); }
    // Judul diubah di langkah 1 = judul awal baru; saran judul lama tidak berlaku lagi.
    if (el.dataset.bind === "me.title" && state.step === 0) { state.draft.originalTitle = ""; state.draft.titleSugs = []; }
    save();
    if (el.dataset.live === "od") { const p = $("#odPreview"); if (p) p.innerHTML = renderRich(openDataStatement(), null); }
    if (el.dataset.bind === "me.title" || el.dataset.bind === "gap.text" || el.dataset.bind.startsWith("me.authors.")) refreshChrome();
    if (el.dataset.bind === "me.title") updateGuide("title");
    if (el.dataset.bind === "draft.keywords") updateGuide("keywords");
    return;
  }
  const act = el.dataset?.act;
  if (act === "rs-cap") { const x = rsSugOf(el.dataset.id); if (x) x.caption = el.value; save(); return; }
  if (act === "aspect") { state.gap.matrix.aspects[Number(el.dataset.i)] = el.value; save(); return; }
  if (act === "edit-abstract") { state.draft.data.abstract = el.value; save(); updateStats(); updateGuide("abstract"); updateSmap("abstract"); return; }
  if (act === "edit-section") {
    state.draft.data.sections[Number(el.dataset.i)].paragraphs = el.value.split(/\n\s*\n/).map((s) => s.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
    save(); updateStats(); updateGuide(SECTION_KEYS[Number(el.dataset.i)]); updateSmap(SECTION_KEYS[Number(el.dataset.i)]); return;
  }
  if (act === "ack") { state.exp.ack = el.value; state.exp.ackEdited = true; save(); return; }
  if (act === "contrib") {
    state.exp.contrib[Number(el.dataset.i)] = el.value; save();
    const p = $("#contribPreview"); if (p) p.innerHTML = renderRich(contribStatement(), null);
    return;
  }
  if (act === "key-ai" || act === "key-openalex") {
    const k = getKeys();
    const which = act === "key-ai" ? "ai" : "openalex";
    k[which] = el.value.trim();
    setKeys(k); keyCheck[which] = null; updateChip(); refreshChrome();
    const t1 = $("#tagAi"); if (t1) t1.innerHTML = aiTag();
    const t2 = $("#tagOa"); if (t2) t2.innerHTML = oaTag();
    const out = $("#keyCheckOut"); if (out) out.innerHTML = checkOut();
    const clr = document.querySelector('[data-act="clear-keys"]'); if (clr) clr.disabled = !(k.ai || k.openalex);
  }
});
function updateStats() { const s = $("#draftStats"); if (s) s.innerHTML = draftStats(); }
// Perbarui status langkah, tombol Lanjut, dan peringatan tanpa merender ulang kolom yang sedang diketik.
function refreshChrome() {
  document.querySelectorAll(".step-link").forEach((b, i) => {
    b.classList.toggle("done", stepDone(i));
    $(".step-num", b).textContent = stepDone(i) ? "✓" : i + 1;
  });
  const next = document.querySelector(`.nav-row [data-i="${state.step + 1}"]`);
  if (next) next.disabled = !stepDone(state.step);
  const al = $("#meAlerts"); if (al) al.innerHTML = meAlerts();
  const pc = $("#prodiCover"); if (pc) pc.innerHTML = prodiChips(teamProdi(), "Rumpun prodi terwakili:");
}

// ---------- kode akses & status ----------
function showAccess(show) { $("#accessModal").hidden = !show; if (show) setTimeout(() => $("#accessInput").focus(), 50); }
$("#accessForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("#accessInput").value.trim();
  try { localStorage.setItem(CODE_KEY, v); } catch {}
  try {
    const r = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json", "x-access-code": v }, body: JSON.stringify({}) });
    if (r.status === 401) { $("#accessError").hidden = false; return; }
  } catch {}
  $("#accessError").hidden = true; showAccess(false); toast("Kode diterima.");
});
$("#resetBtn").addEventListener("click", () => {
  if (!window.confirm("Mulai sesi baru? Semua isian dan API key di perangkat ini akan dihapus. Unduh data sesi (.json) dulu bila perlu.")) return;
  state = defaultState(); clearKeys(); keyCheck = { ai: null, openalex: null };
  Object.keys(errors).forEach((k) => delete errors[k]); flushSave(); updateChip(); render();
});

function updateChip() {
  const chip = $("#statusChip");
  if (!config) return;
  const kind = keyKind(getKeys().ai);
  const ai = kind === "OpenRouter" || kind === "Gemini" || config.llm.configured ? "Research Lab AI" : "";
  if (config.mock) { chip.textContent = "Mode uji · data contoh"; chip.className = "chip warn"; }
  else if (ai && hasOpenAlexKey()) { chip.textContent = `${ai} · OpenAlex`; chip.className = "chip ok"; }
  else { chip.textContent = !ai && !hasOpenAlexKey() ? "Isi 2 API key" : !ai ? "Isi Research Lab key" : "Isi API key OpenAlex"; chip.className = "chip err"; }
}

// ---------- login ----------
function showUser() {
  const a = getAuth(); const box = $("#userBox");
  if (!box) return;
  box.hidden = !a; if (a) $("#userName").textContent = a.user;
}
function showLogin(show) {
  const m = $("#loginModal"); m.hidden = !show;
  document.body.classList.toggle("locked", show);
  if (show) setTimeout(() => $("#loginUser").focus(), 50);
}
// silent = dipanggil karena sesi berakhir (tanpa konfirmasi).
function logout(silent = false) {
  if (!silent && !window.confirm("Keluar dari akun ini? Draf Anda tetap tersimpan di browser ini untuk akun Anda.")) return;
  flushSave();
  clearAuth(); loggedOutGate = true;
  state = defaultState(); memKeys = { ai: "", openalex: "" }; keyCheck = { ai: null, openalex: null }; figData = {};
  Object.keys(errors).forEach((k) => delete errors[k]); Object.keys(busy).forEach((k) => delete busy[k]);
  showUser(); render(); showLogin(true);
}
// Draf dari sebelum fitur login (tanpa akun) boleh dipindahkan ke akun yang pertama masuk, atas persetujuan.
function adoptLegacy(user) {
  try {
    const legacy = localStorage.getItem(STORE_KEY);
    if (!legacy || localStorage.getItem(`${STORE_KEY}:${user}`)) return;
    if (!window.confirm(`Di browser ini ada draf dari sebelum fitur login. Pakai draf itu untuk akun "${user}"?\n\nPilih Batal bila draf itu milik orang lain.`)) return;
    localStorage.setItem(`${STORE_KEY}:${user}`, legacy); localStorage.removeItem(STORE_KEY);
    const k = localStorage.getItem(KEYS_KEY); if (k) { localStorage.setItem(`${KEYS_KEY}:${user}`, k); localStorage.removeItem(KEYS_KEY); }
  } catch {}
}
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btnEl = $("#loginBtn"); const err = $("#loginError");
  err.hidden = true; btnEl.disabled = true; btnEl.textContent = "Memeriksa…";
  try {
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: $("#loginUser").value, password: $("#loginPass").value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.token) throw new Error(d.error || "Gagal masuk. Coba lagi.");
    setAuth({ token: d.token, user: d.user, exp: d.exp });
    adoptLegacy(d.user);
    loggedOutGate = false;
    state = load(); memKeys = { ai: "", openalex: "" };
    $("#loginPass").value = "";
    figData = await loadFigs(figNs());
    if (!stepUnlocked(state.step)) state.step = firstOpenStep();
    showLogin(false); showUser(); updateChip(); render();
    toast(`Selamat datang, ${d.user}.`, { ok: true });
  } catch (x) {
    err.textContent = x.message; err.hidden = false;
  } finally { btnEl.disabled = false; btnEl.textContent = "Masuk"; }
});
$("#togglePass").addEventListener("click", () => {
  const i = $("#loginPass"); const show = i.type === "password";
  i.type = show ? "text" : "password"; $("#togglePass").textContent = show ? "Sembunyikan" : "Tampilkan";
  $("#togglePass").setAttribute("aria-pressed", String(show));
});
$("#logoutBtn").addEventListener("click", () => logout(false));

async function init() {
  // Bila sebelumnya server mewajibkan login dan belum masuk, langsung tampilkan layar masuk
  // (agar draf lama tidak sempat terlihat sebelum konfigurasi server terbaca).
  try { if (localStorage.getItem("research-lab-login") === "1" && !getAuth()) { loggedOutGate = true; state = defaultState(); showLogin(true); } } catch {}
  render();
  try {
    config = await api("/api/config");
    try { localStorage.setItem("research-lab-login", config.loginRequired ? "1" : "0"); } catch {}
    if (!config.loginRequired && loggedOutGate) { loggedOutGate = false; state = load(); showLogin(false); }
    if (config.loginRequired) {
      const a = getAuth();
      let ok = false;
      if (a) { try { const r = await fetch("/api/login", { headers: { "x-auth-token": a.token } }); ok = r.ok; } catch { ok = true; } }
      if (!ok) { logout(true); return; }
      showUser();
    }
    loadFigs(figNs()).then((m) => { figData = m; if (state.results.items?.figures?.length) render(); });
    if (config.eventName) $("#eventName").textContent = config.eventName;
    updateChip();
    // Langkah tersimpan yang belum boleh dibuka (mis. key dihapus) dikembalikan ke langkah yang belum selesai.
    if (!stepUnlocked(state.step)) state.step = firstOpenStep();
    render();
    if (config.accessRequired && !accessCode()) showAccess(true);
  } catch {
    const chip = $("#statusChip"); chip.textContent = "Server tidak terjangkau"; chip.className = "chip err";
  }
}
init();
