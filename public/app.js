// Research Lab — pelatihan riset berbantuan AI.
// Prinsip: judul milik peserta, tim penulis multidisiplin (1–6 penulis, 5 rumpun prodi), AI hanya membantu.
// Referensi hanya dari OpenAlex; angka hasil tidak dikarang; kontribusi dan data dinyatakan terbuka.

const PRODI = ["Ilmu Komputer", "Sistem Informasi", "Bisnis Digital", "Desain Komunikasi Visual", "International Trade"];
const MAX_AUTHORS = 6;
const STEPS = [
  { title: "Peserta dan judul", sub: "Judul, tim penulis" },
  { title: "Literatur", sub: "Lintas prodi, OpenAlex" },
  { title: "Matriks gap", sub: "Temukan celah riset" },
  { title: "Judul dan draf", sub: "Saran judul, draf paper" },
  { title: "Integritas dan ekspor", sub: "Kontribusi, data, .docx" },
];
const MAX_PAPERS = 15;
const STORE_KEY = "research-lab-state-v3";
const CODE_KEY = "research-lab-access";
const KEYS_KEY = "research-lab-keys-v2"; // API key pengguna: hanya di browser ini, tidak ikut ekspor .json

// Peran CRediT (taksonomi kontribusi penulis) dan padanan bahasa Indonesianya.
const CREDIT = {
  "conceptualization": "konseptualisasi", "data curation": "kurasi data", "formal analysis": "analisis formal",
  "funding acquisition": "perolehan pendanaan", "investigation": "investigasi", "methodology": "metodologi",
  "project administration": "administrasi proyek", "resources": "sumber daya", "software": "perangkat lunak",
  "supervision": "supervisi", "validation": "validasi", "visualization": "visualisasi",
  "writing—original draft": "penulisan—draf awal", "writing—review and editing": "penulisan—tinjauan dan penyuntingan",
};

const blankAuthor = () => ({ name: "", prodi: "", dept: "", faculty: "", org: "", city: "", email: "" });
const defaultState = () => ({
  step: 0,
  me: { lang: "en", title: "", aim: "", method: "", authors: [blankAuthor()] },
  lit: { query: "", lens: "", yearFrom: 2016, sort: "relevance", results: [], total: 0, searched: false, selected: [], suggestions: [], perProdi: [], concepts: [] },
  gap: { matrix: null, gaps: [], chosen: -1, text: "" },
  draft: { keywords: "", data: null, originalTitle: "", titleSugs: [], keywordSugs: [] },
  exp: {
    ack: "", ackEdited: false, checks: {},
    contrib: [""], contribAi: false,
    od: { type: "third", name: "", source: "", url: "", reason: "" },
  },
  meta: { model: "", label: "" },
});

let config = null;
const busy = {};
const errors = {};
let state = load();

// ---------- penyimpanan lokal ----------
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = deepMerge(defaultState(), JSON.parse(raw));
      s.me.authors = (s.me.authors.length ? s.me.authors : [blankAuthor()]).slice(0, MAX_AUTHORS).map((a) => ({ ...blankAuthor(), ...a }));
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
function flushSave() { clearTimeout(saveTimer); try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} }
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 250); }
window.addEventListener("pagehide", flushSave);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSave(); });

function accessCode() { try { return localStorage.getItem(CODE_KEY) || ""; } catch { return ""; } }
let memKeys = { ai: "", openalex: "" };
function getKeys() {
  try { const k = JSON.parse(localStorage.getItem(KEYS_KEY) || "null"); if (k) return { ai: k.ai || "", openalex: k.openalex || "" }; } catch {}
  return memKeys;
}
function setKeys(k) {
  memKeys = { ai: (k.ai || "").trim(), openalex: (k.openalex || "").trim() };
  try { localStorage.setItem(KEYS_KEY, JSON.stringify(memKeys)); } catch {}
}
function clearKeys() { memKeys = { ai: "", openalex: "" }; try { localStorage.removeItem(KEYS_KEY); } catch {} }
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
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3200);
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
const authorsOk = () => state.me.authors.length >= 1 && authorsNamed() === state.me.authors.length;
const litProdi = () => [...new Set(state.lit.selected.map((w) => w.prodi).filter(Boolean))];
const ctx = () => ({ title: state.me.title, aim: state.me.aim, prodi: teamProdi() });
// Untuk lensa pencarian: rumpun prodi tim, atau kelima rumpun bila belum diisi.
const lensProdi = () => (teamProdi().length ? teamProdi() : PRODI);
const paperPayload = (full) => state.lit.selected.map((w) => full
  ? { n: w.n, title: w.title, year: w.year, authors: w.authors, venue: w.venue, abstract: w.abstract, prodi: w.prodi || "" }
  : { n: w.n, title: w.title, year: w.year, abstract: w.abstract, prodi: w.prodi || "" });
function joinList(items) {
  const and = isId() ? "dan" : "and";
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} ${and} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${and} ${items[items.length - 1]}`;
}
function prodiChips(present, label) {
  return `<div class="row" style="align-items:center;gap:6px"><span class="hint">${label}</span>${PRODI.map((p) => present.includes(p)
    ? `<span class="tag" style="background:var(--ok-tint);color:var(--ok)">✓ ${esc(p)}</span>`
    : `<span class="tag muted">${esc(p)}</span>`).join("")}</div>`;
}

async function api(path, body, { raw = false } = {}) {
  const h = { "Content-Type": "application/json", "x-access-code": accessCode() };
  const k = getKeys();
  if (k.ai) h["x-ai-key"] = k.ai;
  if (k.openalex) h["x-openalex-key"] = k.openalex;
  const resp = await fetch(path, { method: body ? "POST" : "GET", headers: h, body: body ? JSON.stringify(body) : undefined });
  if (resp.status === 401) { showAccess(true); throw new Error("Kode akses diperlukan."); }
  if (raw && resp.ok) return resp;
  let data = null;
  try { data = await resp.json(); } catch {}
  if (!resp.ok) throw new Error(data?.error || `Server mengembalikan status ${resp.status}.`);
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
function ieeeRefHtml(w) {
  const au = ieeeAuthors(w.authors);
  const tail = [];
  if (w.volume) tail.push(`vol. ${esc(w.volume)}`);
  if (w.issue) tail.push(`no. ${esc(w.issue)}`);
  if (w.firstPage && w.lastPage && w.firstPage !== w.lastPage) tail.push(`pp. ${esc(w.firstPage)}–${esc(w.lastPage)}`);
  else if (w.firstPage) tail.push(`p. ${esc(w.firstPage)}`);
  if (w.year) tail.push(w.year);
  if (w.doi) tail.push(`doi: <a href="https://doi.org/${esc(w.doi)}" target="_blank" rel="noopener">${esc(w.doi)}</a>`);
  return `${au ? esc(au) + ", " : ""}“${esc(w.title)},” ${w.venue ? `<i>${esc(w.venue)}</i>, ` : ""}${tail.join(", ")}.`;
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
    case 0: return Boolean(state.me.title.trim() && hasAiKey() && hasOpenAlexKey() && authorsOk());
    case 1: return state.lit.selected.length >= 3 && litProdi().length >= 2;
    case 2: return Boolean(state.gap.text.trim());
    case 3: return Boolean(state.draft.data);
    default: return false;
  }
}
function goto(i) {
  state.step = Math.max(0, Math.min(STEPS.length - 1, i));
  save(); render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  $("#main").focus({ preventScroll: true });
}

// ---------- render ----------
function render() {
  $("#stepper").innerHTML = STEPS.map((s, i) => `
    <button type="button" class="step-link ${stepDone(i) ? "done" : ""}" data-act="goto" data-i="${i}" ${state.step === i ? 'aria-current="step"' : ""}>
      <span class="step-num">${stepDone(i) ? "✓" : i + 1}</span>
      <span class="step-text"><span class="step-title">${s.title}</span><br><span class="step-sub">${s.sub}</span></span>
    </button>`).join("");
  const views = [viewMe, viewLiterature, viewGap, viewDraft, viewExport];
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
  if (kind === "OpenRouter" || kind === "Gemini") return TAG.mid(`Key ${kind} terisi`);
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
  const row = (name, r) => r ? `<div class="alert ${r.ok ? "ok" : "err"}"><b>${name}:</b> ${esc(r.msg)}</div>` : "";
  return row("OpenRouter", keyCheck.ai) + row("OpenAlex", keyCheck.openalex);
}
function modelPicker() {
  const models = config?.openrouterModels || [];
  const locked = config?.lockedModel;
  if (!models.length || !locked) return "";
  const list = models.some((m) => m.id === locked) ? models : [{ id: locked, label: locked, price: "-" }, ...models];
  return `<label class="field" style="max-width:640px"><span>Model AI (dikunci narasumber) · harga per 1 juta token input / output</span>
    <select data-act="model" aria-describedby="modelHint">${list.map((m) => `<option value="${esc(m.id)}" ${m.id === locked ? "selected" : "disabled"}>${esc(m.label)} (${esc(m.price)})${m.id === locked ? "" : " · tidak tersedia"}</option>`).join("")}</select>
    <span class="hint" id="modelHint">Semua peserta memakai model yang sama agar hasil dan biaya seragam. Model lain hanya ditampilkan sebagai informasi.</span></label>`;
}
function keyCard() {
  const k = getKeys();
  const step = (items) => `<ol style="margin:6px 0 0;padding-left:20px;font-size:14px;display:flex;flex-direction:column;gap:4px">${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
  return `
    <section class="card" id="keyCard">
      <div class="row" style="justify-content:space-between;align-items:center"><h3>API key Anda</h3><span class="hint">Disimpan hanya di browser ini</span></div>
      <p class="hint" style="margin:0">Setiap peserta memakai dua key miliknya sendiri: <b>OpenRouter</b> untuk AI dan <b>OpenAlex</b> untuk mencari literatur. Setelah menempel keduanya, klik <b>Cek kedua key</b>.</p>
      <div class="grid2">
        <div class="keybox">
          <div class="row" style="justify-content:space-between;align-items:center"><b>1. OpenRouter (AI)</b><span id="tagAi">${aiTag()}</span></div>
          <input type="password" autocomplete="off" spellcheck="false" data-act="key-ai" value="${esc(k.ai)}" placeholder="sk-or-v1-…" aria-label="API key OpenRouter">
          <details ${k.ai ? "" : "open"}><summary>Cara daftar dan membuat key</summary>${step([
            'Buka <a href="https://openrouter.ai" target="_blank" rel="noopener">openrouter.ai</a>, klik <b>Sign in</b> (bisa dengan akun Google).',
            'Buka menu <b>Credits</b>, isi saldo minimal <b>US$5</b>. Tanpa saldo, permintaan AI akan ditolak.',
            'Buka menu <b>Keys</b> → <b>Create Key</b>, beri nama (mis. "Research Lab"), lalu salin key <code>sk-or-…</code>. Key hanya ditampilkan sekali.',
          ])}</details>
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
      <p class="hint" style="margin:0">Key diteruskan ke OpenRouter dan OpenAlex hanya saat dipakai; server aplikasi tidak menyimpannya. Klik <b>Hapus key</b> setelah sesi bila memakai komputer bersama.</p>
    </section>`;
}

// ---------- Langkah 1 ----------
function viewMe() {
  const m = state.me;
  const rows = m.authors.map((a, i) => `
    <div class="author-row">
      <span class="author-n">${i + 1}</span>
      <div class="author-fields">
        <label class="field"><span>Nama lengkap *</span><input data-bind="me.authors.${i}.name" value="${esc(a.name)}" autocomplete="off" placeholder="mis. Alwi Ihsan Nababan"></label>
        <label class="field"><span>Departemen / prodi (tercetak)</span><input data-bind="me.authors.${i}.dept" value="${esc(a.dept)}" placeholder="mis. Department of Management"></label>
        <label class="field"><span>Fakultas / school</span><input data-bind="me.authors.${i}.faculty" value="${esc(a.faculty)}" placeholder="mis. Faculty of Economics and Business"></label>
        <label class="field"><span>Universitas / institusi</span><input data-bind="me.authors.${i}.org" value="${esc(a.org)}" placeholder="mis. Universitas Sumatera Utara"></label>
        <label class="field"><span>Kota, negara</span><input data-bind="me.authors.${i}.city" value="${esc(a.city)}" placeholder="mis. Medan, Indonesia"></label>
        <label class="field"><span>Email atau ORCID</span><input data-bind="me.authors.${i}.email" value="${esc(a.email)}" placeholder="nama@kampus.ac.id"></label>
        <label class="field"><span>Rumpun prodi (untuk referensi lintas prodi)</span><select data-bind="me.authors.${i}.prodi"><option value="">Pilih rumpun</option>${PRODI.map((p) => `<option ${a.prodi === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
      </div>
      ${m.authors.length > 1 ? `<button type="button" class="btn ghost small author-del" data-act="del-author" data-i="${i}" aria-label="Hapus penulis ${i + 1}">Hapus</button>` : "<span></span>"}
    </div>`).join("");
  return `
    ${header(0, "Judul penelitian dan tim penulis", "Tulis judul Anda sendiri dan isi tim penulis (1–6 orang). Aplikasi akan mencarikan referensi lintas prodi di OpenAlex, membantu menemukan gap, lalu menyusun draf paper.")}
    ${keyCard()}
    <section class="card human">
      <h2>Ide penelitian</h2>
      <label class="field"><span>Judul penelitian (wajib)</span><textarea data-bind="me.title" rows="2" placeholder="mis. Pengaruh Motif Batik pada Kemasan terhadap Niat Beli Konsumen Mancanegara">${esc(m.title)}</textarea></label>
      <label class="field"><span>Tujuan atau pertanyaan penelitian (opsional, membantu AI lebih tepat)</span><textarea data-bind="me.aim" rows="2">${esc(m.aim)}</textarea></label>
      <label class="field"><span>Rencana data dan metode (opsional)</span><textarea data-bind="me.method" rows="2" placeholder="mis. survei 200 responden, analisis SEM-PLS, dataset terbuka dari Kaggle">${esc(m.method)}</textarea></label>
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
        ${m.authors.length > 1 ? '<button type="button" class="btn ghost small" data-act="copy-org">Salin fakultas, universitas, dan kota penulis 1 ke yang kosong</button>' : ""}
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
  if (!hasAiKey()) a.push("Tempel API key OpenRouter di bagian atas halaman ini.");
  if (!hasOpenAlexKey()) a.push("Tempel API key OpenAlex di bagian atas halaman ini.");
  if (!authorsOk()) a.push(`Isi nama setiap penulis yang tercantum (${authorsNamed()}/${state.me.authors.length}), atau hapus baris yang tidak dipakai.`);
  return a.map((t) => `<div class="alert warn">${t}</div>`).join("");
}

// ---------- Langkah 2 ----------
function prodiSelect(act, value, extra = "") {
  return `<select data-act="${act}" ${extra}><option value="">Belum ditandai</option>${PRODI.map((p) => `<option ${value === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>`;
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
    ? `<div class="row" style="align-items:center;gap:8px"><span class="hint">Umum:</span>${L.suggestions.map((q, i) => `<button type="button" class="btn ghost small" data-act="use-query" data-i="${i}">${esc(q)}</button>`).join("")}</div>` : "";
  const lenses = L.perProdi.length
    ? `<div class="lens-list">${L.perProdi.map((x, i) => `<button type="button" class="lens-btn" data-act="use-lens" data-i="${i}"><b>${esc(x.prodi)}</b><span>${esc(x.query)}</span></button>`).join("")}</div>
       <p class="hint" style="margin:0">Klik satu lensa untuk mencari. Makalah yang dipilih dari pencarian itu otomatis ditandai dengan prodi lensanya.</p>` : "";
  return `
    ${header(1, "Literatur lintas prodi", `Judul: <b>${esc(state.me.title || "(belum diisi)")}</b>. Kumpulkan referensi dari sudut pandang beberapa prodi. Semua makalah berasal dari OpenAlex dan punya DOI.`)}
    <section class="card ai">
      <h2>AI menyarankan kata kunci per prodi</h2>
      <p class="hint" style="margin:0">AI menerjemahkan judul menjadi kata kunci bahasa Inggris, umum dan per lensa prodi tim (${esc(lensProdi().join(", "))}).</p>
      <div>${btn("suggest-keywords", L.suggestions.length ? "Sarankan ulang" : "Sarankan kata kunci", { disabled: !state.me.title.trim() })}</div>
      ${errBox("suggest-keywords")}
      ${lenses}
      ${general}
    </section>
    <section class="card human">
      <h2>Pencarian</h2>
      <div class="row">
        <label class="field" style="flex:3 1 260px"><span>Kata kunci (bahasa Inggris)</span><input data-bind="lit.query" value="${esc(L.query)}" placeholder="mis. batik export consumer perception"></label>
        <label class="field" style="flex:1 1 170px"><span>Lensa prodi</span>${prodiSelect("lens", L.lens).replace("Belum ditandai", "Umum")}</label>
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
        <span class="hint">Minimal 3 referensi dari minimal 2 prodi; disarankan 5–10 dari 3 prodi atau lebih.</span>
      </div>
      ${prodiChips(litProdi(), "Prodi pada referensi:")}
      ${L.selected.length ? `<ul class="selected-list">${sel}</ul>` : '<p class="hint">Belum ada. Centang makalah dari hasil pencarian.</p>'}
    </section>
    ${L.searched ? `<section class="card"><h3>Hasil pencarian${L.lastLens ? ` · lensa ${esc(L.lastLens)}` : ""} <span class="hint">(${L.results.length} ditampilkan dari ±${Number(L.total).toLocaleString("id-ID")})</span></h3><div class="results">${list || '<p class="hint">Tidak ada hasil. Coba kata kunci lain.</p>'}</div></section>` : ""}
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
    <p class="hint">Isi sel dinilai AI hanya dari judul dan abstrak. Klik sel untuk mengoreksi (Ya → Sebagian → Belum). Cek minimal dua sel dengan membaca abstraknya sendiri.</p>` : "";
  const gaps = state.gap.gaps.length ? state.gap.gaps.map((g, i) => `
    <label class="qcard"><input type="radio" name="gap" data-act="choose-gap" value="${i}" ${state.gap.chosen === i ? "checked" : ""}>
      <div><div class="q">${esc(g.statement)}</div>${g.evidence.length ? `<div class="hint">Paling dekat: ${g.evidence.map((n) => `[${n}]`).join(", ")}</div>` : ""}</div></label>`).join("") : "";
  const few = state.lit.selected.length < 2;
  return `
    ${header(2, "Matriks gap lintas prodi", `Judul: <b>${esc(state.me.title)}</b>`)}
    <section class="card ai">
      <h2>AI memetakan</h2>
      <p class="hint">AI membaca ${state.lit.selected.length} abstrak referensi terpilih, menilai judul Anda dari sudut pandang beberapa prodi tim, lalu mengusulkan gap di irisan antar-disiplin. AI tidak boleh menambah makalah lain.</p>
      <div>${btn("make-gap", m ? "Buat ulang matriks" : "Buat matriks gap", { disabled: few })}</div>
      ${few ? '<div class="alert warn">Pilih minimal dua referensi di langkah Literatur.</div>' : ""}
      ${errBox("make-gap")}
      ${table}
      ${gaps ? `<h3 style="margin-top:6px">Kandidat gap</h3>${gaps}` : ""}
    </section>
    <section class="card human">
      <h2>Keputusan tim</h2>
      <label class="field"><span>Gap yang dipilih (sunting dengan kalimat sendiri)</span><textarea data-bind="gap.text" rows="3">${esc(state.gap.text)}</textarea></label>
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
      ${opts}
      ${kws}
    </section>`;
}
function viewDraft() {
  const d = state.draft.data;
  const editor = d ? `
    <label class="field"><span>${isId() ? "Abstrak" : "Abstract"}</span><textarea class="paper" data-act="edit-abstract" rows="7">${esc(d.abstract)}</textarea></label>
    ${d.sections.map((s, i) => `<label class="field"><span>${i + 1}. ${esc(s.heading)}</span><textarea class="paper" data-act="edit-section" data-i="${i}" rows="${Math.min(18, 4 + s.paragraphs.join(" ").length / 110 | 0)}">${esc(s.paragraphs.join("\n\n"))}</textarea></label>`).join("")}
    <p class="hint">Pisahkan paragraf dengan satu baris kosong. Sitasi ditulis [nomor] sesuai daftar referensi terpilih; penomoran IEEE dirapikan otomatis saat ekspor. Teks dalam [kurung siku] lain adalah placeholder yang wajib diisi dari data atau analisis tim.</p>` : "";
  const canDraft = state.me.title.trim() && state.gap.text.trim() && state.lit.selected.length >= 2;
  return `
    ${header(3, "Judul dan draf paper", "Pertajam judul sesuai gap yang dipilih, tetapkan kata kunci, lalu susun draf. Draf adalah rencana penelitian: belum ada hasil, jadi semua angka hasil ditulis sebagai placeholder.")}
    ${titleCard()}
    <section class="card human">
      <h2>Keputusan tim: judul dan kata kunci final</h2>
      <label class="field"><span>Judul final (boleh disunting)</span><input data-bind="me.title" value="${esc(state.me.title)}"></label>
      <label class="field"><span>Kata kunci (pisahkan dengan koma)</span><input data-bind="draft.keywords" value="${esc(state.draft.keywords)}"></label>
    </section>
    <section class="card ai">
      <h2>AI menyusun draf</h2>
      <p class="hint">Bahasa naskah: <b>${isId() ? "Bahasa Indonesia" : "English"}</b>. AI hanya boleh mengutip ${state.lit.selected.length} referensi terpilih dan diminta mengaitkan sudut pandang antarprodi. Proses 20–60 detik.</p>
      <div>${btn("make-draft", d ? "Susun ulang draf (suntingan akan tertimpa)" : "Susun draf paper", { disabled: !canDraft, busyLabel: "Menyusun draf… (20–60 detik)" })}</div>
      ${!canDraft ? '<div class="alert warn">Isi judul, gap yang dipilih, dan minimal dua referensi terlebih dahulu.</div>' : ""}
      ${errBox("make-draft")}
      <div id="draftStats">${draftStats()}</div>
      ${editor}
    </section>
    ${navRow("Lanjut ke integritas dan ekspor")}`;
}

// ---------- Langkah 5 ----------
function paperPreview() {
  const d = state.draft.data;
  if (!d) return '<div class="alert warn">Draf belum ada. Susun draf di langkah sebelumnya.</div>';
  const { order, map } = citationMap();
  const byN = new Map(state.lit.selected.map((w) => [w.n, w]));
  const authors = state.me.authors.map((a) => `<div>${esc(a.name || "[Nama Penulis]")}${[a.dept, a.faculty, a.org].filter((x) => x.trim()).map((x) => `<i>${esc(x)}</i>`).join("")}${[a.city, a.email].filter((x) => x.trim()).map((x) => `${esc(x)}<br>`).join("")}</div>`).join("");
  const m = state.gap.matrix;
  const matrix = m?.rows?.length ? `<div class="tcap">${isId() ? "Tabel I. Matriks Gap Studi Terdahulu" : "Table I. Gap Matrix of Reviewed Studies"}</div><table><tr><th>Ref.</th>${m.aspects.map((a) => `<th>${esc(a)}</th>`).join("")}</tr>${m.rows.filter((r) => map.has(r.n)).sort((a, b) => map.get(a.n) - map.get(b.n)).map((r) => `<tr><td>[${map.get(r.n)}]</td>${r.cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>` : "";
  const ack = state.exp.ackEdited ? state.exp.ack : disclosure();
  return `<article class="paper-preview" aria-label="Pratinjau paper">
    <div class="pt">${esc(state.me.title || "[Judul Paper]")}</div>
    <div class="pa">${authors}</div>
    <div class="cols">
      <p class="abs noindent"><i>${isId() ? "Abstrak" : "Abstract"}</i>—${renderRich(d.abstract, map)}</p>
      <p class="abs noindent"><i>${isId() ? "Kata kunci" : "Keywords"}</i>—${esc(state.draft.keywords)}</p>
      ${d.sections.map((s, i) => `<h4>${["I", "II", "III", "IV", "V", "VI"][i]}. ${esc(s.heading)}</h4>${s.paragraphs.map((p) => `<p>${renderRich(p, map)}</p>`).join("")}${i === 1 ? matrix : ""}`).join("")}
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
    <label class="field"><span>${i + 1}. ${esc(a.name || `Penulis ${i + 1}`)}${a.dept || a.prodi ? ` · ${esc(a.dept || a.prodi)}` : ""}</span>
      <input data-act="contrib" data-i="${i}" value="${esc(state.exp.contrib[i] || "")}" placeholder="${isId() ? "mis. konseptualisasi, analisis penjualan e-commerce, penulisan—draf awal" : "e.g. conceptualization, e-commerce sales analysis, writing—original draft"}"></label>`).join("");
  return `
    <section class="card human">
      <h2>Open Contributionship</h2>
      <p class="hint" style="margin:0">Tuliskan peran setiap penulis (pisahkan dengan koma) memakai taksonomi CRediT, ditambah tugas spesifik bila perlu. Kalimat pernyataan disusun otomatis.</p>
      <div>${btn("suggest-contrib", "AI: sarankan pembagian peran", { kind: "ai", disabled: !authorsOk(), busyLabel: "Menyusun saran…" })}</div>
      ${errBox("suggest-contrib")}
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
  const fields = o.type === "third"
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
      <div class="statement" id="odPreview">${renderRich(openDataStatement(), null)}</div>
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
  const refProdi = new Set(order.map((n) => state.lit.selected.find((w) => w.n === n)?.prodi).filter(Boolean)).size;
  const auto = [
    [order.length > 0, `${order.length} referensi dari OpenAlex, semuanya ber-DOI, mewakili ${refProdi} prodi.`],
    [true, "Sitasi di luar daftar referensi terpilih sudah dibuang otomatis."],
    [Boolean(ack.trim()), "Pernyataan penggunaan AI ada di bagian Acknowledgment (sesuai kebijakan IEEE)."],
    [contribFilled === state.me.authors.length, `Open Contributionship terisi untuk ${contribFilled} dari ${state.me.authors.length} penulis.`],
    [odPh === 0, odPh ? `Pernyataan Open Data masih memiliki ${odPh} placeholder.` : "Pernyataan Open Data lengkap."],
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
        ${btn("export-docx", "Unduh .docx (template IEEE)", { kind: "primary", disabled: !d || !manualOk, busyLabel: "Menyiapkan .docx…" })}
        <button type="button" class="btn ghost" data-act="copy-text" ${d ? "" : "disabled"}>Salin teks draf</button>
        <button type="button" class="btn ghost" data-act="export-json">Unduh data sesi (.json)</button>
      </div>
      ${!manualOk ? '<p class="hint">Tombol unduh aktif setelah semua butir checklist manual dicentang.</p>' : ""}
      ${errBox("export-docx")}
    </section>
    ${navRow()}`;
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
    state.me.authors.forEach((a, i) => { if (i > 0) { for (const k of ["faculty", "org", "city"]) if (!a[k]) a[k] = a0[k]; } });
    save(); render(); toast("Fakultas, universitas, dan kota disalin ke penulis yang masih kosong.");
  },
  "suggest-keywords": () => runTask("suggest-keywords", async () => {
    const r = await api("/api/llm", { task: "keywords", ...ctx(), prodi: lensProdi() });
    state.lit.suggestions = r.result.queries; state.lit.perProdi = r.result.perProdi || []; state.lit.concepts = r.result.concepts; noteModel(r);
    if (!state.lit.query && r.result.queries[0]) state.lit.query = r.result.queries[0];
  }),
  "use-query": (el) => runTask("search", () => doSearch(state.lit.suggestions[Number(el.dataset.i)], "")),
  "use-lens": (el) => {
    const x = state.lit.perProdi[Number(el.dataset.i)];
    runTask("search", () => doSearch(x.query, PRODI.includes(x.prodi) ? x.prodi : ""));
  },
  search: () => runTask("search", () => doSearch(state.lit.query)),
  "remove-work": (el) => { state.lit.selected = state.lit.selected.filter((w) => w.id !== el.dataset.id); save(); render(); },
  "make-gap": () => runTask("make-gap", async () => {
    const r = await api("/api/llm", { task: "gap", ...ctx(), papers: paperPayload(false) });
    state.gap.matrix = { aspects: r.result.aspects, rows: r.result.rows };
    state.gap.gaps = r.result.gaps; state.gap.chosen = -1; noteModel(r);
  }),
  cell: (el) => {
    const order = ["Ya", "Sebagian", "Belum"];
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
  "add-keyword": (el) => {
    const k = state.draft.keywordSugs[Number(el.dataset.i)];
    const list = state.draft.keywords.split(",").map((s) => s.trim()).filter(Boolean);
    if (!list.some((x) => x.toLowerCase() === k.toLowerCase())) list.push(k);
    state.draft.keywords = list.join(", "); save(); render();
  },
  "use-keywords": () => { state.draft.keywords = state.draft.keywordSugs.join(", "); save(); render(); },
  "make-draft": () => {
    if (state.draft.data && !window.confirm("Susun ulang draf? Suntingan pada draf saat ini akan tertimpa.")) return;
    runTask("make-draft", async () => {
      const r = await api("/api/llm", {
        task: "draft", ...ctx(), gap: state.gap.text, lang: state.me.lang, papers: paperPayload(true), matrix: state.gap.matrix, method: state.me.method,
      });
      state.draft.data = r.result;
      if (!state.draft.keywords.trim() && r.result.keywords?.length) state.draft.keywords = r.result.keywords.join(", ");
      noteModel(r);
    });
  },
  "suggest-contrib": () => {
    if (state.exp.contrib.some((c) => c.trim()) && !window.confirm("Ganti isian kontribusi dengan saran AI?")) return;
    runTask("suggest-contrib", async () => {
      const r = await api("/api/llm", { task: "contrib", title: state.me.title, aim: state.me.aim, method: state.me.method, lang: state.me.lang, authors: state.me.authors.map((a) => ({ name: a.name, prodi: [a.dept, a.prodi].filter(Boolean).join(" / ") })) });
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
    }, { raw: true });
    const blob = await resp.blob();
    const name = decodeURIComponent((resp.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || "draf-paper.docx");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("File .docx diunduh. Bagian kuning wajib diisi sebelum dikirim.");
  }),
  "copy-text": async () => {
    const d = state.draft.data; if (!d) return;
    const { order, map } = citationMap();
    const byN = new Map(state.lit.selected.map((w) => [w.n, w]));
    const strip = (t) => String(t).replace(/\[(\d+)\]/g, (m, n) => (map.has(Number(n)) ? `[${map.get(Number(n))}]` : ""));
    const tmp = document.createElement("div");
    const refs = order.map((n, i) => { tmp.innerHTML = ieeeRefHtml(byN.get(n)); return `[${i + 1}] ${tmp.textContent}`; });
    const text = [state.me.title, "", state.me.authors.map((a) => [a.name, a.dept, a.faculty, a.org, a.city, a.email].filter((x) => x.trim()).join(", ")).join("\n"), "",
      `Abstract—${d.abstract}`, `Keywords—${state.draft.keywords}`, "",
      ...d.sections.flatMap((s, i) => [`${["I", "II", "III", "IV", "V"][i]}. ${s.heading.toUpperCase()}`, ...s.paragraphs.map(strip), ""]),
      "ACKNOWLEDGMENT", state.exp.ackEdited ? state.exp.ack : disclosure(), "",
      "OPEN CONTRIBUTIONSHIP", contribStatement(), "", "OPEN DATA", openDataStatement(), "",
      "REFERENCES", ...refs].join("\n");
    try { await navigator.clipboard.writeText(text); toast("Teks draf disalin."); }
    catch { toast("Gagal menyalin otomatis. Gunakan Unduh .docx."); }
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
const INPUT_ACTS = ["model", "lens", "tag-prodi", "choose-title", "toggle-work", "choose-gap", "check", "lang", "od-type", "aspect", "edit-abstract", "edit-section", "ack", "contrib", "key-ai", "key-openalex"];
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled || INPUT_ACTS.includes(el.dataset.act)) return;
  if (actions[el.dataset.act]) { e.preventDefault(); actions[el.dataset.act](el); }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  const act = el.dataset?.act;
  if (act === "lang") { state.me.lang = el.value; save(); return; }
  if (act === "model") { el.value = config?.lockedModel || el.value; return; }
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
    // Judul diubah di langkah 1 = judul awal baru; saran judul lama tidak berlaku lagi.
    if (el.dataset.bind === "me.title" && state.step === 0) { state.draft.originalTitle = ""; state.draft.titleSugs = []; }
    save();
    if (el.dataset.live === "od") { const p = $("#odPreview"); if (p) p.innerHTML = renderRich(openDataStatement(), null); }
    if (el.dataset.bind === "me.title" || el.dataset.bind === "gap.text" || el.dataset.bind.startsWith("me.authors.")) refreshChrome();
    return;
  }
  const act = el.dataset?.act;
  if (act === "aspect") { state.gap.matrix.aspects[Number(el.dataset.i)] = el.value; save(); return; }
  if (act === "edit-abstract") { state.draft.data.abstract = el.value; save(); updateStats(); return; }
  if (act === "edit-section") {
    state.draft.data.sections[Number(el.dataset.i)].paragraphs = el.value.split(/\n\s*\n/).map((s) => s.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
    save(); updateStats(); return;
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
  const ai = kind === "OpenRouter" || kind === "Gemini" ? kind : config.llm.configured ? config.llm.label : "";
  if (config.mock) { chip.textContent = "Mode uji · data contoh"; chip.className = "chip warn"; }
  else if (ai && hasOpenAlexKey()) { chip.textContent = `${ai} · OpenAlex`; chip.className = "chip ok"; }
  else { chip.textContent = !ai && !hasOpenAlexKey() ? "Isi 2 API key" : !ai ? "Isi API key OpenRouter" : "Isi API key OpenAlex"; chip.className = "chip err"; }
}

async function init() {
  render();
  try {
    config = await api("/api/config");
    if (config.eventName) $("#eventName").textContent = config.eventName;
    updateChip();
    render();
    if (config.accessRequired && !accessCode()) showAccess(true);
  } catch {
    const chip = $("#statusChip"); chip.textContent = "Server tidak terjangkau"; chip.className = "chip err";
  }
}
init();
