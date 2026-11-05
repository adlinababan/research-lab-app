// Research Lab — pelatihan riset berbantuan AI, alur individu.
// Prinsip: judul milik peserta, AI hanya membantu. Referensi hanya dari OpenAlex; angka hasil tidak dikarang.

const PRODI = ["Ilmu Komputer", "Sistem Informasi", "Bisnis Digital", "Desain Komunikasi Visual", "International Trade", "Teknologi Rekayasa Perangkat Lunak"];
const STEPS = [
  { title: "Peserta dan judul", sub: "Judul Anda sendiri" },
  { title: "Literatur", sub: "Cari di OpenAlex" },
  { title: "Matriks gap", sub: "Temukan celah riset" },
  { title: "Draf paper", sub: "Disusun AI, disunting Anda" },
  { title: "Integritas dan ekspor", sub: "Checklist, .docx IEEE" },
];
const MAX_PAPERS = 15;
const STORE_KEY = "research-lab-state-v2";
const CODE_KEY = "research-lab-access";
const KEYS_KEY = "research-lab-keys-v2"; // API key pengguna: hanya di browser ini, tidak ikut ekspor .json

const blankAuthor = () => ({ name: "", dept: "", org: "", city: "", email: "" });
const defaultState = () => ({
  step: 0,
  me: { lang: "en", prodi: "", title: "", aim: "", method: "", authors: [blankAuthor()] },
  lit: { query: "", yearFrom: 2016, sort: "relevance", results: [], total: 0, searched: false, selected: [], suggestions: [], concepts: [] },
  gap: { matrix: null, gaps: [], chosen: -1, text: "" },
  draft: { keywords: "", data: null },
  exp: { ack: "", ackEdited: false, checks: {} },
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
    if (raw) return deepMerge(defaultState(), JSON.parse(raw));
  } catch {}
  return defaultState();
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
const MODEL_KEY = "research-lab-model";
function getModel() { try { return localStorage.getItem(MODEL_KEY) || ""; } catch { return ""; } }
function setModel(v) { try { localStorage.setItem(MODEL_KEY, v); } catch {} }
function usesOpenRouter() { return keyKind(getKeys().ai) === "OpenRouter" || (!getKeys().ai && config?.llm?.label === "OpenRouter"); }
function clearKeys() { memKeys = { ai: "", openalex: "" }; try { localStorage.removeItem(KEYS_KEY); } catch {} }
function keyKind(k) { return k.startsWith("sk-or-") ? "OpenRouter" : k.startsWith("AIza") ? "Gemini" : k ? "tidak dikenal" : ""; }
function serverHasKey() { return Boolean(config && (config.mock || config.llm?.configured)); }
function hasAiKey() { return !config || serverHasKey() || ["OpenRouter", "Gemini"].includes(keyKind(getKeys().ai)); }

// ---------- utilitas ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const words = (s) => (String(s || "").trim().match(/\S+/g) || []).length;
const PH_RE = /\[(?!\d+\])[^[\]]+\]/g;
const CITE_RE = /\[(\d+)\]/g;
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
const ctx = () => ({ title: state.me.title, aim: state.me.aim, prodi: state.me.prodi });

async function api(path, body, { raw = false } = {}) {
  const h = { "Content-Type": "application/json", "x-access-code": accessCode() };
  const k = getKeys();
  if (k.ai) h["x-ai-key"] = k.ai;
  if (k.openalex) h["x-openalex-key"] = k.openalex;
  if (getModel()) h["x-ai-model"] = getModel();
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
function disclosure() {
  const sys = `${state.meta.label || config?.llm?.label || "[nama sistem AI]"}${state.meta.model ? ` (${state.meta.model})` : ""}`;
  if (state.me.lang === "id") {
    return `Penulis menggunakan sistem AI generatif ${sys} melalui aplikasi Research Lab untuk mengusulkan kata kunci pencarian, menyusun matriks gap (Tabel I), dan menyusun draf awal seluruh bagian naskah. Judul dan arah penelitian ditentukan oleh penulis. Literatur diambil dari basis data OpenAlex. Seluruh referensi telah diverifikasi dan seluruh isi telah ditinjau serta disunting oleh penulis, yang bertanggung jawab penuh atas naskah ini. [Sesuaikan dengan kontribusi AI yang sebenarnya dan tambahkan pendanaan bila ada.]`;
  }
  return `The authors used the generative AI system ${sys}, through the Research Lab application, to suggest search keywords, build the gap matrix (Table I), and prepare an initial draft of all sections of this paper. The title and research direction were defined by the authors. Literature was retrieved from the OpenAlex database. All references were verified, and all content was reviewed and edited by the authors, who take full responsibility for this paper. [Adjust to the actual extent of AI use and add funding information if any.]`;
}

// ---------- status langkah ----------
function stepDone(i) {
  switch (i) {
    case 0: return Boolean(state.me.title.trim() && hasAiKey());
    case 1: return state.lit.selected.length >= 3;
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

function keyStateTag() {
  const k = getKeys().ai;
  const kind = keyKind(k);
  if (kind === "OpenRouter" || kind === "Gemini") return `<span class="tag" style="background:var(--ok-tint);color:var(--ok)">Key ${kind} tersimpan di perangkat ini</span>`;
  if (kind) return '<span class="tag" style="background:var(--err-tint);color:var(--err)">Format key tidak dikenal</span>';
  return serverHasKey() ? '<span class="tag muted">Tidak perlu diisi</span>' : '<span class="tag" style="background:var(--err-tint);color:var(--err)">Wajib diisi</span>';
}
function keyCard() {
  const k = getKeys();
  const optional = serverHasKey();
  return `
    <section class="card" id="keyCard">
      <div class="row" style="justify-content:space-between;align-items:center"><h3>API key AI</h3><span id="keyState">${keyStateTag()}</span></div>
      <p class="hint" style="margin:0">${optional
        ? "Aplikasi ini sudah memakai API key narasumber. Kolom ini boleh dikosongkan; isi hanya bila ingin memakai key Anda sendiri."
        : "Tempel API key <b>OpenRouter</b> (diawali <code>sk-or-</code>) atau <b>Gemini</b> (diawali <code>AIza</code>). Jenis key dikenali otomatis."}</p>
      <details ${optional || k.ai ? "" : "open"}><summary>Cara membuat key OpenRouter</summary>
        <ol style="margin:6px 0 0;padding-left:20px;font-size:14px">
          <li>Masuk ke <a href="https://openrouter.ai" target="_blank" rel="noopener">openrouter.ai</a>, buka menu <b>Keys</b>, klik <b>Create Key</b>.</li>
          <li>Isi kredit di menu <b>Credits</b> (minimal US$5). Dengan model bawaan, satu alur penuh kurang dari US$0,01.</li>
          <li>Salin key yang diawali <code>sk-or-</code> dan tempel di bawah.</li>
        </ol></details>
      <div class="grid2">
        <label class="field"><span>API key OpenRouter atau Gemini</span><input type="password" autocomplete="off" spellcheck="false" data-act="key-ai" value="${esc(k.ai)}" placeholder="sk-or-… atau AIza…"></label>
        <label class="field"><span>API key OpenAlex ${config?.openalexKey ? "(opsional, server sudah punya)" : "(sangat disarankan)"}</span><input type="password" autocomplete="off" spellcheck="false" data-act="key-openalex" value="${esc(k.openalex)}" placeholder="${config?.openalexKey ? "Kosongkan bila tidak punya" : "Tempel key dari openalex.org/settings/api"}"></label>
      </div>
      ${modelPicker()}
      <div class="row" style="align-items:center">
        <button type="button" class="btn ghost small" data-act="clear-keys" ${k.ai || k.openalex ? "" : "disabled"}>Hapus key dari perangkat ini</button>
        <span class="hint">Key hanya disimpan di browser ini dan diteruskan ke penyedia AI saat dipakai; server tidak menyimpannya.</span>
      </div>
    </section>`;
}

function modelPicker() {
  const models = config?.openrouterModels || [];
  if (!models.length || !usesOpenRouter()) return "";
  const cur = getModel() || models[0].id;
  return `<label class="field" style="max-width:640px"><span>Model AI (OpenRouter) · harga per 1 juta token input / output</span>
    <select data-act="model">${models.map((m) => `<option value="${esc(m.id)}" ${m.id === cur ? "selected" : ""}>${esc(m.label)} (${esc(m.price)})</option>`).join("")}</select></label>`;
}

function viewMe() {
  const m = state.me;
  const authors = m.authors.map((a, i) => `
    <div class="grid3" style="align-items:end">
      <label class="field"><span>${i === 0 ? "Nama Anda" : `Nama penulis ${i + 1}`}</span><input data-bind="me.authors.${i}.name" value="${esc(a.name)}" placeholder="Nama lengkap"></label>
      <label class="field"><span>Prodi / departemen</span><input data-bind="me.authors.${i}.dept" value="${esc(a.dept)}"></label>
      <label class="field"><span>Institusi</span><input data-bind="me.authors.${i}.org" value="${esc(a.org)}" placeholder="Nama universitas"></label>
      <label class="field"><span>Kota, negara</span><input data-bind="me.authors.${i}.city" value="${esc(a.city)}" placeholder="Jakarta, Indonesia"></label>
      <label class="field"><span>Email atau ORCID</span><input data-bind="me.authors.${i}.email" value="${esc(a.email)}"></label>
      <div>${i > 0 ? `<button type="button" class="btn ghost small" data-act="del-author" data-i="${i}">Hapus penulis ${i + 1}</button>` : ""}</div>
    </div>`).join('<hr style="border:0;border-top:1px solid var(--line);margin:4px 0">');
  return `
    ${header(0, "Judul penelitian Anda", "Tulis judul Anda sendiri. Aplikasi akan mencarikan makalah terkait di OpenAlex, membantu menemukan gap, lalu menyusun draf paper untuk judul tersebut.")}
    ${keyCard()}
    <section class="card human">
      <h2>Ide penelitian Anda</h2>
      <label class="field"><span>Judul penelitian (wajib)</span><textarea data-bind="me.title" rows="2" placeholder="mis. Pengaruh Motif Batik pada Kemasan terhadap Niat Beli Konsumen Mancanegara">${esc(m.title)}</textarea></label>
      <label class="field"><span>Tujuan atau pertanyaan penelitian (opsional, membantu AI lebih tepat)</span><textarea data-bind="me.aim" rows="2">${esc(m.aim)}</textarea></label>
      <label class="field"><span>Rencana data dan metode (opsional)</span><textarea data-bind="me.method" rows="2" placeholder="mis. survei 200 responden, analisis SEM-PLS">${esc(m.method)}</textarea></label>
      <div class="grid2">
        <label class="field"><span>Bidang / prodi</span><input list="prodiList" data-bind="me.prodi" value="${esc(m.prodi)}" placeholder="Pilih atau ketik"><datalist id="prodiList">${PRODI.map((p) => `<option value="${esc(p)}">`).join("")}</datalist></label>
        <div class="field"><span>Bahasa naskah</span>
          <div class="checks">
            <label class="check-pill"><input type="radio" name="lang" data-act="lang" value="en" ${m.lang === "en" ? "checked" : ""}>English (IEEE)</label>
            <label class="check-pill"><input type="radio" name="lang" data-act="lang" value="id" ${m.lang === "id" ? "checked" : ""}>Bahasa Indonesia</label>
          </div>
        </div>
      </div>
    </section>
    <section class="card">
      <h3>Penulis (untuk blok penulis di template IEEE, maksimal 3)</h3>
      ${authors}
      ${m.authors.length < 3 ? `<div><button type="button" class="btn ghost small" data-act="add-author">+ Tambah penulis</button></div>` : ""}
    </section>
    <div id="meAlerts">${meAlerts()}</div>
    ${navRow("Lanjut cari literatur")}`;
}
function meAlerts() {
  const a = [];
  if (!state.me.title.trim()) a.push("Isi judul penelitian Anda untuk melanjutkan.");
  if (!hasAiKey()) a.push("Tempel API key OpenRouter atau Gemini di bagian atas halaman ini.");
  return a.map((t) => `<div class="alert warn">${t}</div>`).join("");
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
        <div class="s">DOI: <a href="https://doi.org/${esc(w.doi)}" target="_blank" rel="noopener">${esc(w.doi)}</a> ${w.abstract ? "" : '<span class="tag muted">tanpa abstrak</span>'}</div>
        ${w.abstract ? `<details><summary>Abstrak</summary><p class="abs">${esc(w.abstract)}</p></details>` : ""}
      </div>
    </div>`).join("");
  const sel = L.selected.map((w) => `
    <li><span class="n">[${w.n}]</span><span>${esc(w.title)} <span class="hint">(${w.year || "t.t."})</span>${w.abstract ? "" : ' <span class="tag muted">tanpa abstrak</span>'}</span>
    <button type="button" class="btn ghost small" data-act="remove-work" data-id="${esc(w.id)}">Hapus</button></li>`).join("");
  const sug = L.suggestions.length
    ? `<div class="tags" style="gap:8px">${L.suggestions.map((q, i) => `<button type="button" class="btn ghost small" data-act="use-query" data-i="${i}">${esc(q)}</button>`).join("")}</div><p class="hint">Klik salah satu untuk langsung mencari.</p>`
    : "";
  return `
    ${header(1, "Cari literatur nyata", `Judul Anda: <b>${esc(state.me.title || "(belum diisi)")}</b>. Semua makalah berasal dari OpenAlex dan punya DOI.`)}
    <section class="card ai">
      <h2>AI menyarankan kata kunci</h2>
      <p class="hint">AI menerjemahkan judul Anda menjadi kata kunci bahasa Inggris untuk OpenAlex. Anda tetap bisa mengetik kata kunci sendiri.</p>
      <div>${btn("suggest-keywords", L.suggestions.length ? "Sarankan ulang" : "Sarankan kata kunci dari judul", { disabled: !state.me.title.trim() })}</div>
      ${errBox("suggest-keywords")}
      ${sug}
    </section>
    <section class="card human">
      <h2>Pencarian</h2>
      <div class="row">
        <label class="field" style="flex:3 1 280px"><span>Kata kunci (bahasa Inggris)</span><input data-bind="lit.query" value="${esc(L.query)}" placeholder="mis. batik export consumer perception"></label>
        <label class="field" style="flex:1 1 110px"><span>Terbit sejak</span><input type="number" min="1950" max="2100" data-bind="lit.yearFrom" value="${esc(L.yearFrom)}"></label>
        <label class="field" style="flex:1 1 150px"><span>Urutkan</span><select data-bind="lit.sort"><option value="relevance" ${L.sort === "relevance" ? "selected" : ""}>Paling relevan</option><option value="cited" ${L.sort === "cited" ? "selected" : ""}>Paling banyak dikutip</option></select></label>
        ${btn("search", "Cari di OpenAlex", { kind: "primary", busyLabel: "Mencari…" })}
      </div>
      <p class="hint">Tulis 3–6 kata tanpa AND/OR. Ulangi pencarian dengan kata kunci lain; pilihan sebelumnya tetap tersimpan.</p>
      ${errBox("search")}
    </section>
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3>Makalah terpilih <span class="counter">${L.selected.length}</span> / ${MAX_PAPERS}</h3>
        <span class="hint">Disarankan 5–10 makalah yang punya abstrak.</span>
      </div>
      ${L.selected.length ? `<ul class="selected-list">${sel}</ul>` : '<p class="hint">Belum ada. Centang makalah dari hasil pencarian.</p>'}
    </section>
    ${L.searched ? `<section class="card"><h3>Hasil pencarian <span class="hint">(${L.results.length} ditampilkan dari ±${Number(L.total).toLocaleString("id-ID")})</span></h3><div class="results">${list || '<p class="hint">Tidak ada hasil. Coba kata kunci lain.</p>'}</div></section>` : ""}
    ${navRow("Lanjut ke matriks gap")}`;
}

function viewGap() {
  const m = state.gap.matrix;
  const byN = new Map(state.lit.selected.map((w) => [w.n, w]));
  const table = m ? `
    <div class="tbl-wrap"><table class="matrix">
      <thead><tr><th style="width:44%">Makalah</th>${m.aspects.map((a, i) => `<th><input data-act="aspect" data-i="${i}" value="${esc(a)}" aria-label="Nama kolom ${i + 1}"></th>`).join("")}</tr></thead>
      <tbody>${m.rows.map((r, ri) => `<tr><td><b>[${r.n}]</b> ${esc(byN.get(r.n)?.title || "(makalah sudah dihapus)")}<div class="hint">${esc(r.note || "")}</div></td>${r.cells.map((c, ci) => `<td class="c"><button type="button" class="cell-btn" data-act="cell" data-r="${ri}" data-c="${ci}" data-v="${esc(c)}" title="Klik untuk mengubah">${esc(c)}</button></td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <p class="hint">Isi sel dinilai AI hanya dari judul dan abstrak. Klik sel untuk mengoreksi (Ya → Sebagian → Belum). Cek minimal dua sel dengan membaca abstraknya sendiri.</p>` : "";
  const gaps = state.gap.gaps.length ? state.gap.gaps.map((g, i) => `
    <label class="qcard"><input type="radio" name="gap" data-act="choose-gap" value="${i}" ${state.gap.chosen === i ? "checked" : ""}>
      <div><div class="q">${esc(g.statement)}</div>${g.evidence.length ? `<div class="hint">Paling dekat: ${g.evidence.map((n) => `[${n}]`).join(", ")}</div>` : ""}</div></label>`).join("") : "";
  const few = state.lit.selected.length < 2;
  return `
    ${header(2, "Matriks gap", `Judul Anda: <b>${esc(state.me.title)}</b>`)}
    <section class="card ai">
      <h2>AI memetakan</h2>
      <p class="hint">AI membaca ${state.lit.selected.length} abstrak makalah terpilih, menandai aspek judul Anda yang sudah atau belum dibahas, lalu mengusulkan gap. AI tidak boleh menambah makalah lain.</p>
      <div>${btn("make-gap", m ? "Buat ulang matriks" : "Buat matriks gap", { disabled: few })}</div>
      ${few ? '<div class="alert warn">Pilih minimal dua makalah di langkah Literatur.</div>' : ""}
      ${errBox("make-gap")}
      ${table}
      ${gaps ? `<h3 style="margin-top:6px">Kandidat gap</h3>${gaps}` : ""}
    </section>
    <section class="card human">
      <h2>Keputusan Anda</h2>
      <label class="field"><span>Gap yang dipilih (sunting dengan kalimat Anda sendiri)</span><textarea data-bind="gap.text" rows="3">${esc(state.gap.text)}</textarea></label>
    </section>
    ${navRow("Lanjut ke draf paper")}`;
}

function draftStats() {
  const d = state.draft.data;
  if (!d) return "";
  const all = [d.abstract, ...d.sections.flatMap((s) => s.paragraphs)].join("\n");
  const ph = (all.match(PH_RE) || []).length;
  const { order } = citationMap();
  const uncited = state.lit.selected.filter((w) => !order.includes(w.n)).length;
  return `<div class="stats"><span class="stat"><b>${words(all)}</b> kata</span><span class="stat"><b>${ph}</b> placeholder</span><span class="stat"><b>${order.length}</b> dari ${state.lit.selected.length} makalah dikutip</span>${uncited ? `<span class="stat" style="color:var(--warn)">${uncited} makalah belum dikutip</span>` : ""}</div>`;
}

function viewDraft() {
  const d = state.draft.data;
  const editor = d ? `
    <label class="field"><span>${state.me.lang === "id" ? "Abstrak" : "Abstract"}</span><textarea class="paper" data-act="edit-abstract" rows="7">${esc(d.abstract)}</textarea></label>
    ${d.sections.map((s, i) => `<label class="field"><span>${i + 1}. ${esc(s.heading)}</span><textarea class="paper" data-act="edit-section" data-i="${i}" rows="${Math.min(18, 4 + s.paragraphs.join(" ").length / 110 | 0)}">${esc(s.paragraphs.join("\n\n"))}</textarea></label>`).join("")}
    <p class="hint">Pisahkan paragraf dengan satu baris kosong. Sitasi ditulis [nomor] sesuai daftar makalah terpilih; penomoran IEEE dirapikan otomatis saat ekspor. Teks dalam [kurung siku] lain adalah placeholder yang wajib diisi dari data atau analisis Anda.</p>` : "";
  const canDraft = state.me.title.trim() && state.gap.text.trim() && state.lit.selected.length >= 2;
  return `
    ${header(3, "Draf paper", "Draf adalah rencana penelitian: belum ada hasil, jadi semua angka hasil ditulis sebagai placeholder.")}
    <section class="card human">
      <h2>Judul dan kata kunci Anda</h2>
      <label class="field"><span>Judul (milik Anda; AI tidak mengubahnya)</span><input data-bind="me.title" value="${esc(state.me.title)}"></label>
      <label class="field"><span>Kata kunci (pisahkan dengan koma; terisi otomatis setelah draf disusun)</span><input data-bind="draft.keywords" value="${esc(state.draft.keywords)}"></label>
    </section>
    <section class="card ai">
      <h2>AI menyusun draf</h2>
      <p class="hint">Bahasa naskah: <b>${state.me.lang === "id" ? "Bahasa Indonesia" : "English"}</b>. AI hanya boleh mengutip ${state.lit.selected.length} makalah terpilih. Proses 20–60 detik.</p>
      <div>${btn("make-draft", d ? "Susun ulang draf (suntingan akan tertimpa)" : "Susun draf paper", { disabled: !canDraft, busyLabel: "Menyusun draf… (20–60 detik)" })}</div>
      ${!canDraft ? '<div class="alert warn">Isi judul, gap yang dipilih, dan minimal dua makalah terlebih dahulu.</div>' : ""}
      ${errBox("make-draft")}
      <div id="draftStats">${draftStats()}</div>
      ${editor}
    </section>
    ${navRow("Lanjut ke integritas dan ekspor")}`;
}

function paperPreview() {
  const d = state.draft.data;
  if (!d) return '<div class="alert warn">Draf belum ada. Susun draf di langkah sebelumnya.</div>';
  const { order, map } = citationMap();
  const byN = new Map(state.lit.selected.map((w) => [w.n, w]));
  const isId = state.me.lang === "id";
  const authors = state.me.authors.slice(0, 3).map((a) => `<div>${esc(a.name || "[Nama Penulis]")}<i>${esc(a.dept || "[Prodi / departemen]")}</i><i>${esc(a.org || "[Institusi]")}</i>${esc(a.city || "[Kota], Indonesia")}<br>${esc(a.email || "[email atau ORCID]")}</div>`).join("");
  const m = state.gap.matrix;
  const matrix = m?.rows?.length ? `<div class="tcap">${isId ? "Tabel I. Matriks Gap Studi Terdahulu" : "Table I. Gap Matrix of Reviewed Studies"}</div><table><tr><th>Ref.</th>${m.aspects.map((a) => `<th>${esc(a)}</th>`).join("")}</tr>${m.rows.filter((r) => map.has(r.n)).sort((a, b) => map.get(a.n) - map.get(b.n)).map((r) => `<tr><td>[${map.get(r.n)}]</td>${r.cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>` : "";
  const ack = state.exp.ackEdited ? state.exp.ack : disclosure();
  return `<article class="paper-preview" aria-label="Pratinjau paper">
    <div class="pt">${esc(state.me.title || "[Judul Paper]")}</div>
    <div class="pa">${authors}</div>
    <div class="cols">
      <p class="abs noindent"><i>${isId ? "Abstrak" : "Abstract"}</i>—${renderRich(d.abstract, map)}</p>
      <p class="abs noindent"><i>${isId ? "Kata kunci" : "Keywords"}</i>—${esc(state.draft.keywords)}</p>
      ${d.sections.map((s, i) => `<h4>${["I", "II", "III", "IV", "V", "VI"][i]}. ${esc(s.heading)}</h4>${s.paragraphs.map((p) => `<p>${renderRich(p, map)}</p>`).join("")}${i === 1 ? matrix : ""}`).join("")}
      <h4>${isId ? "Ucapan Terima Kasih" : "Acknowledgment"}</h4><p>${renderRich(ack, null)}</p>
      <h4>${isId ? "Referensi" : "References"}</h4>
      <div class="refs">${order.map((n, i) => `<p>[${i + 1}] ${ieeeRefHtml(byN.get(n))}</p>`).join("")}</div>
    </div>
  </article>`;
}

const MANUAL_CHECKS = [
  ["edited", "Saya sudah membaca dan menyunting setiap bagian draf dengan kalimat saya sendiri."],
  ["doi", "Saya sudah membuka beberapa DOI dan memastikan makalahnya memang relevan dengan klaim yang mengutipnya."],
  ["numbers", "Saya paham bahwa setiap [placeholder] hanya boleh diisi dari data dan analisis saya sendiri."],
  ["ethics", "Bila memakai data responden, saya akan mengurus persetujuan etik sebelum pengambilan data."],
];

function viewExport() {
  const d = state.draft.data;
  const { order } = citationMap();
  const all = d ? [d.abstract, ...d.sections.flatMap((s) => s.paragraphs)].join("\n") : "";
  const ph = (all.match(PH_RE) || []).length;
  const uncited = state.lit.selected.filter((w) => !order.includes(w.n));
  const ack = state.exp.ackEdited ? state.exp.ack : disclosure();
  const manualOk = MANUAL_CHECKS.every(([k]) => state.exp.checks[k]);
  const auto = [
    [order.length > 0, `${order.length} referensi, semuanya dari OpenAlex dan ber-DOI.`],
    [true, "Sitasi di luar daftar makalah terpilih sudah dibuang otomatis."],
    [Boolean(ack.trim()), "Pernyataan penggunaan AI ada di bagian Acknowledgment (sesuai kebijakan IEEE)."],
    [ph === 0, ph ? `${ph} placeholder masih perlu diisi setelah analisis (ditandai kuning di .docx).` : "Tidak ada placeholder tersisa."],
  ];
  return `
    ${header(4, "Integritas dan ekspor", "Periksa pratinjau, lengkapi pernyataan penggunaan AI, centang checklist, lalu unduh draf dalam template IEEE.")}
    ${paperPreview()}
    ${uncited.length ? `<div class="alert warn">${uncited.length} makalah terpilih belum dikutip dan tidak akan masuk daftar referensi: ${uncited.map((w) => `[${w.n}]`).join(", ")}.</div>` : ""}
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
async function doSearch(query) {
  const q = String(query || "").trim();
  if (!q) throw new Error("Isi kata kunci terlebih dahulu.");
  state.lit.query = q;
  const r = await api("/api/search", { query: q, yearFrom: state.lit.yearFrom, sort: state.lit.sort });
  state.lit.results = r.results; state.lit.total = r.total; state.lit.searched = true;
  if (r.mock) toast("Mode uji: hasil pencarian adalah data contoh.");
}

const actions = {
  goto: (el) => goto(Number(el.dataset.i)),
  "clear-keys": () => { clearKeys(); updateChip(); render(); toast("Key dihapus dari perangkat ini."); },
  "add-author": () => { if (state.me.authors.length < 3) state.me.authors.push(blankAuthor()); save(); render(); },
  "del-author": (el) => { state.me.authors.splice(Number(el.dataset.i), 1); save(); render(); },
  "suggest-keywords": () => runTask("suggest-keywords", async () => {
    const r = await api("/api/llm", { task: "keywords", ...ctx() });
    state.lit.suggestions = r.result.queries; state.lit.concepts = r.result.concepts; noteModel(r);
    if (!state.lit.query && r.result.queries[0]) state.lit.query = r.result.queries[0];
  }),
  "use-query": (el) => runTask("search", () => doSearch(state.lit.suggestions[Number(el.dataset.i)])),
  search: () => runTask("search", () => doSearch(state.lit.query)),
  "remove-work": (el) => { state.lit.selected = state.lit.selected.filter((w) => w.id !== el.dataset.id); save(); render(); },
  "make-gap": () => runTask("make-gap", async () => {
    const papers = state.lit.selected.map((w) => ({ n: w.n, title: w.title, year: w.year, abstract: w.abstract }));
    const r = await api("/api/llm", { task: "gap", ...ctx(), papers });
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
  "make-draft": () => {
    if (state.draft.data && !window.confirm("Susun ulang draf? Suntingan Anda pada draf saat ini akan tertimpa.")) return;
    runTask("make-draft", async () => {
      const papers = state.lit.selected.map((w) => ({ n: w.n, title: w.title, year: w.year, authors: w.authors, venue: w.venue, abstract: w.abstract }));
      const r = await api("/api/llm", {
        task: "draft", ...ctx(), gap: state.gap.text, lang: state.me.lang, papers, matrix: state.gap.matrix, method: state.me.method,
      });
      state.draft.data = r.result;
      if (!state.draft.keywords.trim() && r.result.keywords?.length) state.draft.keywords = r.result.keywords.join(", ");
      noteModel(r);
    });
  },
  "export-docx": () => runTask("export-docx", async () => {
    const d = state.draft.data;
    const resp = await api("/api/docx", {
      lang: state.me.lang, title: state.me.title, authors: state.me.authors,
      abstract: d.abstract, keywords: state.draft.keywords.split(",").map((s) => s.trim()).filter(Boolean),
      sections: d.sections, matrix: state.gap.matrix, papers: state.lit.selected,
      acknowledgment: state.exp.ackEdited ? state.exp.ack : disclosure(),
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
    const text = [state.me.title, "", `Abstract—${d.abstract}`, `Keywords—${state.draft.keywords}`, "",
      ...d.sections.flatMap((s, i) => [`${["I", "II", "III", "IV", "V"][i]}. ${s.heading.toUpperCase()}`, ...s.paragraphs.map(strip), ""]),
      "ACKNOWLEDGMENT", state.exp.ackEdited ? state.exp.ack : disclosure(), "", "REFERENCES", ...refs].join("\n");
    try { await navigator.clipboard.writeText(text); toast("Teks draf disalin."); }
    catch { toast("Gagal menyalin otomatis. Gunakan Unduh .docx."); }
  },
  "export-json": () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const who = (state.me.authors[0]?.name || "peserta").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40);
    a.href = URL.createObjectURL(blob); a.download = `research-lab-${who}.json`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
};

// ---------- delegasi event ----------
const INPUT_ACTS = ["model", "toggle-work", "choose-gap", "check", "lang", "aspect", "edit-abstract", "edit-section", "ack", "key-ai", "key-openalex"];
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled || INPUT_ACTS.includes(el.dataset.act)) return;
  if (actions[el.dataset.act]) { e.preventDefault(); actions[el.dataset.act](el); }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  const act = el.dataset?.act;
  if (act === "lang") { state.me.lang = el.value; save(); return; }
  if (act === "model") { setModel(el.value); state.meta.model = ""; save(); toast("Model AI diganti."); return; }
  if (act === "toggle-work") {
    const id = el.dataset.id;
    if (state.lit.selected.find((w) => w.id === id)) state.lit.selected = state.lit.selected.filter((w) => w.id !== id);
    else {
      if (state.lit.selected.length >= MAX_PAPERS) { el.checked = false; toast(`Maksimal ${MAX_PAPERS} makalah.`); return; }
      const w = state.lit.results.find((x) => x.id === id);
      const n = state.lit.selected.reduce((mx, x) => Math.max(mx, x.n), 0) + 1;
      state.lit.selected.push({ ...w, n });
    }
    save(); render(); return;
  }
  if (act === "choose-gap") { const i = Number(el.value); state.gap.chosen = i; state.gap.text = state.gap.gaps[i].statement; save(); render(); return; }
  if (act === "check") { state.exp.checks[el.dataset.k] = el.checked; save(); render(); return; }
  if (el.dataset?.bind && el.tagName === "SELECT") { setPath(state, el.dataset.bind, el.value); save(); }
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset?.bind) {
    let v = el.value;
    if (el.type === "number") v = Number(v) || "";
    setPath(state, el.dataset.bind, v); save();
    if (el.dataset.bind === "me.title" || el.dataset.bind === "gap.text") refreshChrome();
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
  if (act === "key-ai" || act === "key-openalex") {
    const k = getKeys();
    k[act === "key-ai" ? "ai" : "openalex"] = el.value.trim();
    setKeys(k); updateChip(); refreshChrome();
    const tag = $("#keyState"); if (tag) tag.innerHTML = keyStateTag();
    const hadPicker = Boolean(document.querySelector('[data-act="model"]'));
    if (hadPicker !== Boolean(modelPicker())) { const kc = $("#keyCard"); if (kc) { kc.outerHTML = keyCard(); const inp = document.querySelector(`[data-act="${act}"]`); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } } }
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
  state = defaultState(); clearKeys(); Object.keys(errors).forEach((k) => delete errors[k]); flushSave(); updateChip(); render();
});

function updateChip() {
  const chip = $("#statusChip");
  if (!config) return;
  const kind = keyKind(getKeys().ai);
  if (config.mock) { chip.textContent = "Mode uji · data contoh"; chip.className = "chip warn"; }
  else if (kind === "OpenRouter" || kind === "Gemini") { chip.textContent = `${kind} (key Anda) · OpenAlex`; chip.className = "chip ok"; }
  else if (config.llm.configured) { chip.textContent = `${config.llm.label} · OpenAlex`; chip.className = "chip ok"; }
  else { chip.textContent = "Isi API key AI"; chip.className = "chip err"; }
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
