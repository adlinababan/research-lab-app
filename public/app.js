// Research Lab — antarmuka pelatihan riset lintas prodi berbantuan AI.
// Prinsip: AI mengusulkan, kelompok memutuskan. Referensi hanya dari OpenAlex; angka hasil tidak dikarang.

const PRODI = ["Ilmu Komputer", "Sistem Informasi", "Bisnis Digital", "DKV", "International Trade"];
const THEMES = {
  "1": "Kopi Nusantara: dari kebun ke pasar global",
  "2": "Batik dan fesyen lokal di pasar digital global",
  "3": "Live shopping dan social commerce UMKM",
  "4": "Pariwisata digital Indonesia",
};
const STEPS = [
  { title: "Kelompok", sub: "Tema dan anggota" },
  { title: "Pertanyaan riset", sub: "Hands-on 1" },
  { title: "Literatur", sub: "Cari di OpenAlex" },
  { title: "Matriks gap", sub: "Hands-on 2" },
  { title: "Judul dan draf", sub: "Hands-on 3" },
  { title: "Integritas dan ekspor", sub: "Checklist, .docx" },
];
const MAX_PAPERS = 15;
const STORE_KEY = "research-lab-state-v1";
const CODE_KEY = "research-lab-access";

const blankAuthor = () => ({ name: "", dept: "", org: "", city: "", email: "" });
const defaultState = () => ({
  step: 0,
  group: { num: "1", theme: THEMES["1"], prodi: [], other: "", lang: "en", note: "", authors: [blankAuthor()] },
  q: { result: null, chosen: -1, question: "", method: "", query: "" },
  lit: { query: "", yearFrom: 2016, sort: "relevance", results: [], total: 0, searched: false, selected: [] },
  gap: { matrix: null, gaps: [], chosen: -1, text: "" },
  draft: { titles: [], keywordsSuggested: [], chosenTitle: -1, title: "", keywords: "", data: null },
  exp: { ack: "", ackEdited: false, checks: {} },
  meta: { model: "", label: "" },
});

let state = load();
let config = null;
const busy = {};
const errors = {};

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
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} }, 250);
}
function accessCode() { try { return localStorage.getItem(CODE_KEY) || ""; } catch { return ""; } }

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
function getPath(obj, path) { return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, path, val) {
  const ks = path.split("."); const last = ks.pop();
  const tgt = ks.reduce((o, k) => o[k], obj); tgt[last] = val;
}
function allProdi() {
  const p = [...state.group.prodi];
  if (state.group.other.trim()) p.push(...state.group.other.split(",").map((s) => s.trim()).filter(Boolean));
  return p;
}
function shortAuthors(a) {
  if (!a?.length) return "Penulis tidak tercantum";
  return a.length > 3 ? `${a.slice(0, 3).join(", ")}, dkk.` : a.join(", ");
}

async function api(path, body, { raw = false } = {}) {
  const resp = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-access-code": accessCode() },
    body: body ? JSON.stringify(body) : undefined,
  });
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
  t = t.replace(/\[(?!\d+\])[^[\]]+\]/g, (m) => `<mark>${m}</mark>`);
  return t;
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
  if (w.volume) tail.push(`vol. ${w.volume}`);
  if (w.issue) tail.push(`no. ${w.issue}`);
  if (w.firstPage && w.lastPage && w.firstPage !== w.lastPage) tail.push(`pp. ${w.firstPage}–${w.lastPage}`);
  else if (w.firstPage) tail.push(`p. ${w.firstPage}`);
  if (w.year) tail.push(w.year);
  if (w.doi) tail.push(`doi: <a href="https://doi.org/${esc(w.doi)}" target="_blank" rel="noopener">${esc(w.doi)}</a>`);
  return `${au ? esc(au) + ", " : ""}“${esc(w.title)},” ${w.venue ? `<i>${esc(w.venue)}</i>, ` : ""}${tail.join(", ")}.`;
}
function disclosure() {
  const sys = `${state.meta.label || config?.llm?.label || "[nama sistem AI]"}${state.meta.model ? ` (${state.meta.model})` : ""}`;
  if (state.group.lang === "id") {
    return `Penulis menggunakan sistem AI generatif ${sys} melalui aplikasi Research Lab untuk membantu merumuskan pertanyaan riset, mengusulkan kata kunci pencarian, menyusun matriks gap (Tabel I), dan menyusun draf awal seluruh bagian naskah. Literatur diambil dari basis data OpenAlex. Seluruh referensi telah diverifikasi dan seluruh isi telah ditinjau serta disunting oleh penulis, yang bertanggung jawab penuh atas naskah ini. [Sesuaikan dengan kontribusi AI yang sebenarnya dan tambahkan pendanaan bila ada.]`;
  }
  return `The authors used the generative AI system ${sys}, through the Research Lab application, to help formulate the research question, suggest search keywords, build the gap matrix (Table I), and prepare an initial draft of all sections of this paper. Literature was retrieved from the OpenAlex database. All references were verified, and all content was reviewed and edited by the authors, who take full responsibility for this paper. [Adjust to the actual extent of AI use and add funding information if any.]`;
}

// ---------- status langkah ----------
function stepDone(i) {
  switch (i) {
    case 0: return Boolean(state.group.theme.trim() && allProdi().length >= 2);
    case 1: return Boolean(state.q.question.trim());
    case 2: return state.lit.selected.length >= 3;
    case 3: return Boolean(state.gap.text.trim());
    case 4: return Boolean(state.draft.title.trim() && state.draft.data);
    case 5: return false;
  }
  return false;
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
  const views = [viewGroup, viewQuestion, viewLiterature, viewGap, viewDraft, viewExport];
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
function navRow(prevOk = true, nextLabel = "Lanjut", nextOk = true) {
  return `<div class="nav-row">
    ${state.step > 0 && prevOk ? `<button type="button" class="btn ghost" data-act="goto" data-i="${state.step - 1}">← Kembali</button>` : "<span></span>"}
    ${state.step < STEPS.length - 1 ? `<button type="button" class="btn primary" data-act="goto" data-i="${state.step + 1}" ${nextOk ? "" : "disabled"}>${nextLabel} →</button>` : ""}
  </div>`;
}

function viewGroup() {
  const g = state.group;
  const themeOpts = Object.entries(THEMES).map(([k, v]) => `<option value="${k}" ${g.num === k ? "selected" : ""}>Kelompok ${k} · ${esc(v)}</option>`).join("") + `<option value="lain" ${g.num === "lain" ? "selected" : ""}>Tema lain (tulis sendiri)</option>`;
  const authors = g.authors.map((a, i) => `
    <div class="grid3" style="align-items:end">
      <label class="field"><span>Nama penulis ${i + 1}</span><input data-bind="group.authors.${i}.name" value="${esc(a.name)}" placeholder="Nama lengkap"></label>
      <label class="field"><span>Prodi / departemen</span><input data-bind="group.authors.${i}.dept" value="${esc(a.dept)}" placeholder="mis. Desain Komunikasi Visual"></label>
      <label class="field"><span>Institusi</span><input data-bind="group.authors.${i}.org" value="${esc(a.org)}" placeholder="Nama universitas"></label>
      <label class="field"><span>Kota, negara</span><input data-bind="group.authors.${i}.city" value="${esc(a.city)}" placeholder="Jakarta, Indonesia"></label>
      <label class="field"><span>Email atau ORCID</span><input data-bind="group.authors.${i}.email" value="${esc(a.email)}"></label>
      <div>${g.authors.length > 1 ? `<button type="button" class="btn ghost small" data-act="del-author" data-i="${i}">Hapus penulis ${i + 1}</button>` : ""}</div>
    </div>`).join('<hr style="border:0;border-top:1px solid var(--line);margin:4px 0">');
  return `
    ${header(0, "Kelompok dan tema", "Isi identitas kelompok. Pertanyaan riset nanti wajib menggabungkan minimal dua sudut pandang prodi.")}
    <section class="card human">
      <h2>Keputusan kelompok</h2>
      <label class="field"><span>Nomor kelompok</span><select data-act="theme-select">${themeOpts}</select></label>
      <label class="field"><span>Tema kelompok</span><textarea data-bind="group.theme" rows="2">${esc(g.theme)}</textarea></label>
      <div class="field"><span>Prodi anggota kelompok (pilih minimal dua)</span>
        <div class="checks">${PRODI.map((p) => `<label class="check-pill"><input type="checkbox" data-act="prodi" value="${esc(p)}" ${g.prodi.includes(p) ? "checked" : ""}>${esc(p)}</label>`).join("")}</div>
      </div>
      <label class="field"><span>Prodi lain (opsional, pisahkan dengan koma)</span><input data-bind="group.other" value="${esc(g.other)}"></label>
      <div class="field"><span>Bahasa naskah</span>
        <div class="checks">
          <label class="check-pill"><input type="radio" name="lang" data-act="lang" value="en" ${g.lang === "en" ? "checked" : ""}>English (konferensi IEEE)</label>
          <label class="check-pill"><input type="radio" name="lang" data-act="lang" value="id" ${g.lang === "id" ? "checked" : ""}>Bahasa Indonesia</label>
        </div>
      </div>
      <label class="field"><span>Konteks tambahan (opsional)</span><textarea data-bind="group.note" rows="2" placeholder="mis. fokus pada UMKM di Jawa Barat, atau data yang sudah dimiliki kelompok">${esc(g.note)}</textarea></label>
    </section>
    <section class="card">
      <h3>Penulis (opsional, maksimal 3)</h3>
      <p class="hint">Dipakai untuk blok penulis di template IEEE. Boleh dikosongkan; nanti terisi sebagai placeholder.</p>
      ${authors}
      ${g.authors.length < 3 ? `<div><button type="button" class="btn ghost small" data-act="add-author">+ Tambah penulis</button></div>` : ""}
    </section>
    ${allProdi().length < 2 ? `<div class="alert warn">Pilih minimal dua prodi agar AI bisa mengusulkan pertanyaan lintas disiplin.</div>` : ""}
    ${navRow(true, "Lanjut ke pertanyaan riset", stepDone(0))}`;
}

function viewQuestion() {
  const r = state.q.result;
  const phen = r?.phenomena?.length ? `<details><summary>Fenomena per prodi (${r.phenomena.length})</summary><div class="phen">${r.phenomena.map((p) => `<div><b>${esc(p.prodi)}</b><ul>${p.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`).join("")}</div></details>` : "";
  const qs = r?.questions?.length ? r.questions.map((q, i) => `
    <label class="qcard"><input type="radio" name="q" data-act="choose-q" value="${i}" ${state.q.chosen === i ? "checked" : ""}>
      <div>
        <div class="q">${esc(q.question)}</div>
        <div class="tags" style="margin-top:6px">${q.prodi.map((p) => `<span class="tag">${esc(p)}</span>`).join("")}</div>
        <div class="meta"><b>Data</b><span>${esc(q.data)}</span><b>Metode</b><span>${esc(q.method)}</span><b>Risiko</b><span>${esc(q.risk)}</span><b>Kata kunci</b><span style="font-family:var(--f-mono);font-size:12.5px">${esc(q.search_query)}</span></div>
      </div></label>`).join("") : "";
  return `
    ${header(1, "Dari tema ke pertanyaan riset", `Tema: <b>${esc(state.group.theme)}</b> · Prodi: ${esc(allProdi().join(", "))}`)}
    <section class="card ai">
      <h2>AI mengusulkan</h2>
      <p class="hint">AI memberi dua fenomena per prodi dan tiga pertanyaan riset lintas prodi. AI tidak diminta menyebut referensi; referensi dicari di langkah berikutnya.</p>
      <div>${btn("ask-questions", r ? "Usulkan ulang" : "Usulkan pertanyaan riset", { disabled: allProdi().length < 2 })}</div>
      ${errBox("ask-questions")}
      ${phen}
      ${qs}
    </section>
    <section class="card human">
      <h2>Keputusan kelompok</h2>
      <label class="field"><span>Pertanyaan riset kelompok (pertajam: siapa, di mana, kapan)</span><textarea data-bind="q.question" rows="3">${esc(state.q.question)}</textarea></label>
      <label class="field"><span>Rencana data dan metode</span><textarea data-bind="q.method" rows="2">${esc(state.q.method)}</textarea></label>
      <label class="field"><span>Kata kunci pencarian awal (bahasa Inggris)</span><input data-bind="q.query" value="${esc(state.q.query)}"></label>
    </section>
    ${navRow(true, "Lanjut cari literatur", stepDone(1))}`;
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
    <button type="button" class="btn ghost small" data-act="remove-work" data-id="${esc(w.id)}" aria-label="Hapus">Hapus</button></li>`).join("");
  const n = L.selected.length;
  return `
    ${header(2, "Cari literatur nyata", "Semua makalah berasal dari basis data OpenAlex dan punya DOI. Gabungkan kata kunci dari dua prodi supaya irisan disiplinnya muncul.")}
    <section class="card human">
      <h2>Pencarian</h2>
      <div class="row">
        <label class="field" style="flex:3 1 280px"><span>Kata kunci (bahasa Inggris)</span><input data-bind="lit.query" value="${esc(L.query || state.q.query)}" placeholder="mis. batik export consumer perception"></label>
        <label class="field" style="flex:1 1 110px"><span>Terbit sejak</span><input type="number" min="1950" max="2100" data-bind="lit.yearFrom" value="${esc(L.yearFrom)}"></label>
        <label class="field" style="flex:1 1 150px"><span>Urutkan</span><select data-bind="lit.sort"><option value="relevance" ${L.sort === "relevance" ? "selected" : ""}>Paling relevan</option><option value="cited" ${L.sort === "cited" ? "selected" : ""}>Paling banyak dikutip</option></select></label>
        ${btn("search", "Cari di OpenAlex", { kind: "primary", busyLabel: "Mencari…" })}
      </div>
      <p class="hint">Tips: tulis 3–6 kata, tanpa AND/OR. Ulangi pencarian dengan kombinasi lain; pilihan sebelumnya tetap tersimpan.</p>
      ${errBox("search")}
    </section>
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3>Makalah terpilih <span class="counter">${n}</span> / ${MAX_PAPERS}</h3>
        <span class="hint">Disarankan 5–10 makalah yang punya abstrak.</span>
      </div>
      ${n ? `<ul class="selected-list">${sel}</ul>` : '<p class="hint">Belum ada. Centang makalah dari hasil pencarian.</p>'}
    </section>
    ${L.searched ? `<section class="card"><h3>Hasil pencarian <span class="hint">(${L.results.length} ditampilkan dari ±${Number(L.total).toLocaleString("id-ID")})</span></h3><div class="results">${list || '<p class="hint">Tidak ada hasil. Coba kata kunci lain.</p>'}</div></section>` : ""}
    ${navRow(true, "Lanjut ke matriks gap", stepDone(2))}`;
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
    ${header(3, "Matriks gap", `Pertanyaan riset: <b>${esc(state.q.question || "(belum diisi)")}</b>`)}
    <section class="card ai">
      <h2>AI memetakan</h2>
      <p class="hint">AI membaca ${state.lit.selected.length} abstrak makalah terpilih dan menandai aspek yang sudah atau belum dibahas. AI tidak boleh menambah makalah lain.</p>
      <div>${btn("make-gap", m ? "Buat ulang matriks" : "Buat matriks gap", { disabled: few })}</div>
      ${few ? '<div class="alert warn">Pilih minimal dua makalah di langkah Literatur.</div>' : ""}
      ${errBox("make-gap")}
      ${table}
      ${gaps ? `<h3 style="margin-top:6px">Kandidat gap</h3>${gaps}` : ""}
    </section>
    <section class="card human">
      <h2>Keputusan kelompok</h2>
      <label class="field"><span>Gap yang dipilih (sunting dengan kalimat kelompok sendiri)</span><textarea data-bind="gap.text" rows="3">${esc(state.gap.text)}</textarea></label>
    </section>
    ${navRow(true, "Lanjut ke judul dan draf", stepDone(3))}`;
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
  const D = state.draft;
  const titles = D.titles.length ? D.titles.map((t, i) => `<label class="qcard"><input type="radio" name="title" data-act="choose-title" value="${i}" ${D.chosenTitle === i ? "checked" : ""}><div class="q">${esc(t)}</div></label>`).join("") : "";
  const d = D.data;
  const editor = d ? `
    <label class="field"><span>${state.group.lang === "id" ? "Abstrak" : "Abstract"}</span><textarea class="paper" data-act="edit-abstract" rows="7">${esc(d.abstract)}</textarea></label>
    ${d.sections.map((s, i) => `<label class="field"><span>${i + 1}. ${esc(s.heading)}</span><textarea class="paper" data-act="edit-section" data-i="${i}" rows="${Math.min(18, 4 + s.paragraphs.join(" ").length / 110 | 0)}">${esc(s.paragraphs.join("\n\n"))}</textarea></label>`).join("")}
    <p class="hint">Pisahkan paragraf dengan satu baris kosong. Sitasi ditulis [nomor] sesuai daftar makalah terpilih; penomoran IEEE dirapikan otomatis saat ekspor. Teks dalam [kurung siku] lain adalah placeholder yang wajib diisi dari data atau analisis kelompok.</p>` : "";
  const canDraft = D.title.trim() && state.gap.text.trim() && state.lit.selected.length >= 2;
  return `
    ${header(4, "Judul dan draf paper", "Draf adalah rencana penelitian: belum ada hasil, jadi semua angka hasil ditulis sebagai placeholder.")}
    <section class="card ai">
      <h2>AI mengusulkan judul</h2>
      <div>${btn("make-titles", D.titles.length ? "Usulkan ulang judul" : "Usulkan 3 judul", { disabled: !state.gap.text.trim() })}</div>
      ${errBox("make-titles")}
      ${titles}
    </section>
    <section class="card human">
      <h2>Keputusan kelompok</h2>
      <label class="field"><span>Judul paper (maksimal 15 kata)</span><input data-bind="draft.title" value="${esc(D.title)}"></label>
      <label class="field"><span>Kata kunci (pisahkan dengan koma)</span><input data-bind="draft.keywords" value="${esc(D.keywords)}"></label>
    </section>
    <section class="card ai">
      <h2>AI menyusun draf</h2>
      <p class="hint">Bahasa naskah: <b>${state.group.lang === "id" ? "Bahasa Indonesia" : "English"}</b>. AI hanya boleh mengutip ${state.lit.selected.length} makalah terpilih. Proses 20–60 detik.</p>
      <div>${btn("make-draft", d ? "Susun ulang draf (suntingan akan tertimpa)" : "Susun draf paper", { disabled: !canDraft, busyLabel: "Menyusun draf… (20–60 detik)" })}</div>
      ${!canDraft ? '<div class="alert warn">Isi judul, gap yang dipilih, dan minimal dua makalah terlebih dahulu.</div>' : ""}
      ${errBox("make-draft")}
      <div id="draftStats">${draftStats()}</div>
      ${editor}
    </section>
    ${navRow(true, "Lanjut ke integritas dan ekspor", stepDone(4))}`;
}

function paperPreview() {
  const d = state.draft.data;
  if (!d) return '<div class="alert warn">Draf belum ada. Susun draf di langkah sebelumnya.</div>';
  const { order, map } = citationMap();
  const byN = new Map(state.lit.selected.map((w) => [w.n, w]));
  const isId = state.group.lang === "id";
  const authors = state.group.authors.slice(0, 3).map((a) => `<div>${esc(a.name || "[Nama Penulis]")}<i>${esc(a.dept || "[Prodi / departemen]")}</i><i>${esc(a.org || "[Institusi]")}</i>${esc(a.city || "[Kota], Indonesia")}<br>${esc(a.email || "[email atau ORCID]")}</div>`).join("");
  const m = state.gap.matrix;
  const matrix = m?.rows?.length ? `<div class="tcap">${isId ? "Tabel I. Matriks Gap Studi Terdahulu" : "Table I. Gap Matrix of Reviewed Studies"}</div><table><tr><th>Ref.</th>${m.aspects.map((a) => `<th>${esc(a)}</th>`).join("")}</tr>${m.rows.filter((r) => map.has(r.n)).sort((a, b) => map.get(a.n) - map.get(b.n)).map((r) => `<tr><td>[${map.get(r.n)}]</td>${r.cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>` : "";
  const ack = state.exp.ackEdited ? state.exp.ack : disclosure();
  return `<article class="paper-preview" aria-label="Pratinjau paper">
    <div class="pt">${esc(state.draft.title || "[Judul Paper]")}</div>
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
  ["edited", "Kami sudah membaca dan menyunting setiap bagian draf dengan kalimat kami sendiri."],
  ["doi", "Kami sudah membuka beberapa DOI dan memastikan makalahnya memang relevan dengan klaim yang mengutipnya."],
  ["numbers", "Kami paham bahwa setiap [placeholder] hanya boleh diisi dari data dan analisis kami sendiri."],
  ["ethics", "Bila memakai data responden, kami akan mengurus persetujuan etik sebelum pengambilan data."],
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
    ${header(5, "Integritas dan ekspor", "Periksa pratinjau, lengkapi pernyataan penggunaan AI, centang checklist, lalu unduh draf dalam template IEEE.")}
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
    ${navRow(true)}`;
}

// ---------- aksi ----------
async function runTask(key, fn) {
  busy[key] = true; errors[key] = ""; render();
  try { await fn(); } catch (e) { errors[key] = e.message || String(e); }
  busy[key] = false; save(); render();
}

const actions = {
  goto: (el) => goto(Number(el.dataset.i)),
  "add-author": () => { if (state.group.authors.length < 3) state.group.authors.push(blankAuthor()); save(); render(); },
  "del-author": (el) => { state.group.authors.splice(Number(el.dataset.i), 1); save(); render(); },
  "ask-questions": () => runTask("ask-questions", async () => {
    const r = await api("/api/llm", { task: "questions", theme: state.group.theme, prodi: allProdi(), note: state.group.note });
    state.q.result = r.result; state.q.chosen = -1; noteModel(r);
  }),
  search: () => runTask("search", async () => {
    const query = (state.lit.query || state.q.query || "").trim();
    if (!query) throw new Error("Isi kata kunci terlebih dahulu.");
    state.lit.query = query;
    const r = await api("/api/search", { query, yearFrom: state.lit.yearFrom, sort: state.lit.sort });
    state.lit.results = r.results; state.lit.total = r.total; state.lit.searched = true;
    if (r.mock) toast("Mode uji: hasil pencarian adalah data contoh.");
  }),
  "remove-work": (el) => { state.lit.selected = state.lit.selected.filter((w) => w.id !== el.dataset.id); save(); render(); },
  "make-gap": () => runTask("make-gap", async () => {
    const papers = state.lit.selected.map((w) => ({ n: w.n, title: w.title, year: w.year, abstract: w.abstract }));
    const r = await api("/api/llm", { task: "gap", question: state.q.question, prodi: allProdi(), papers });
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
  "make-titles": () => runTask("make-titles", async () => {
    const r = await api("/api/llm", { task: "titles", question: state.q.question, gap: state.gap.text, lang: state.group.lang });
    state.draft.titles = r.result.titles; state.draft.keywordsSuggested = r.result.keywords; state.draft.chosenTitle = -1;
    if (!state.draft.keywords.trim()) state.draft.keywords = r.result.keywords.join(", ");
    noteModel(r);
  }),
  "make-draft": () => {
    if (state.draft.data && !window.confirm("Susun ulang draf? Suntingan kelompok pada draf saat ini akan tertimpa.")) return;
    runTask("make-draft", async () => {
      const papers = state.lit.selected.map((w) => ({ n: w.n, title: w.title, year: w.year, authors: w.authors, venue: w.venue, abstract: w.abstract }));
      const r = await api("/api/llm", {
        task: "draft", title: state.draft.title, question: state.q.question, gap: state.gap.text, prodi: allProdi(),
        lang: state.group.lang, papers, matrix: state.gap.matrix, method: state.q.method,
      });
      state.draft.data = r.result;
      if (!state.draft.keywords.trim() && r.result.keywords?.length) state.draft.keywords = r.result.keywords.join(", ");
      noteModel(r);
    });
  },
  "export-docx": () => runTask("export-docx", async () => {
    const d = state.draft.data;
    const body = {
      lang: state.group.lang, title: state.draft.title, authors: state.group.authors,
      abstract: d.abstract, keywords: state.draft.keywords.split(",").map((s) => s.trim()).filter(Boolean),
      sections: d.sections, matrix: state.gap.matrix, papers: state.lit.selected,
      acknowledgment: state.exp.ackEdited ? state.exp.ack : disclosure(),
    };
    const resp = await api("/api/docx", body, { raw: true });
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
    const text = [state.draft.title, "", `Abstract—${d.abstract}`, `Keywords—${state.draft.keywords}`, "",
      ...d.sections.flatMap((s, i) => [`${["I", "II", "III", "IV", "V"][i]}. ${s.heading.toUpperCase()}`, ...s.paragraphs.map(strip), ""]),
      "ACKNOWLEDGMENT", state.exp.ackEdited ? state.exp.ack : disclosure(), "", "REFERENCES", ...refs].join("\n");
    try { await navigator.clipboard.writeText(text); toast("Teks draf disalin."); }
    catch { toast("Gagal menyalin otomatis. Gunakan Unduh .docx."); }
  },
  "export-json": () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `research-lab-kelompok-${state.group.num}.json`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
};
function noteModel(r) { if (r.model) state.meta.model = r.model; if (r.label) state.meta.label = r.label; }

// Delegasi event
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (["choose-q", "toggle-work", "choose-gap", "choose-title", "check", "prodi", "lang", "theme-select", "aspect", "edit-abstract", "edit-section", "ack"].includes(act)) return;
  if (actions[act]) { e.preventDefault(); actions[act](el); }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  const act = el.dataset?.act;
  if (act === "prodi") {
    const set = new Set(state.group.prodi);
    el.checked ? set.add(el.value) : set.delete(el.value);
    state.group.prodi = PRODI.filter((p) => set.has(p)); save(); render(); return;
  }
  if (act === "lang") { state.group.lang = el.value; save(); return; }
  if (act === "theme-select") {
    state.group.num = el.value;
    if (THEMES[el.value]) state.group.theme = THEMES[el.value]; else state.group.theme = "";
    save(); render(); return;
  }
  if (act === "choose-q") {
    const i = Number(el.value); const q = state.q.result.questions[i];
    state.q.chosen = i; state.q.question = q.question; state.q.method = `${q.data} — ${q.method}`; state.q.query = q.search_query;
    state.lit.query = q.search_query; save(); render(); return;
  }
  if (act === "toggle-work") {
    const id = el.dataset.id;
    const exists = state.lit.selected.find((w) => w.id === id);
    if (exists) state.lit.selected = state.lit.selected.filter((w) => w.id !== id);
    else {
      if (state.lit.selected.length >= MAX_PAPERS) { el.checked = false; toast(`Maksimal ${MAX_PAPERS} makalah.`); return; }
      const w = state.lit.results.find((x) => x.id === id);
      const n = state.lit.selected.reduce((mx, x) => Math.max(mx, x.n), 0) + 1;
      state.lit.selected.push({ ...w, n });
    }
    save(); render(); return;
  }
  if (act === "choose-gap") { const i = Number(el.value); state.gap.chosen = i; state.gap.text = state.gap.gaps[i].statement; save(); render(); return; }
  if (act === "choose-title") { const i = Number(el.value); state.draft.chosenTitle = i; state.draft.title = state.draft.titles[i]; save(); render(); return; }
  if (act === "check") { state.exp.checks[el.dataset.k] = el.checked; save(); render(); return; }
  if (el.dataset?.bind && el.tagName === "SELECT") { setPath(state, el.dataset.bind, el.value); save(); }
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset?.bind) {
    let v = el.value;
    if (el.type === "number") v = Number(v) || "";
    setPath(state, el.dataset.bind, v); save();
    if (["group.theme", "group.other", "q.question", "gap.text", "draft.title"].includes(el.dataset.bind)) refreshChrome();
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
});
function updateStats() { const s = $("#draftStats"); if (s) s.innerHTML = draftStats(); }
// Perbarui status langkah & tombol Lanjut tanpa merender ulang kolom yang sedang diketik.
function refreshChrome() {
  document.querySelectorAll(".step-link").forEach((b, i) => {
    b.classList.toggle("done", stepDone(i));
    $(".step-num", b).textContent = stepDone(i) ? "✓" : i + 1;
  });
  const next = document.querySelector(`.nav-row [data-i="${state.step + 1}"]`);
  if (next) next.disabled = !stepDone(state.step);
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
  if (!window.confirm("Mulai sesi baru? Semua isian di perangkat ini akan dihapus. Unduh data sesi (.json) dulu bila perlu.")) return;
  state = defaultState(); Object.keys(errors).forEach((k) => delete errors[k]); save(); render();
});

async function init() {
  render();
  try {
    config = await api("/api/config");
    if (config.eventName) $("#eventName").textContent = config.eventName;
    const chip = $("#statusChip");
    if (config.mock) { chip.textContent = "Mode uji · data contoh"; chip.className = "chip warn"; }
    else if (!config.llm.configured) { chip.textContent = "AI belum dikonfigurasi"; chip.className = "chip err"; }
    else { chip.textContent = `${config.llm.label} · OpenAlex`; chip.className = "chip ok"; }
    if (config.accessRequired && !accessCode()) showAccess(true);
  } catch {
    const chip = $("#statusChip"); chip.textContent = "Server tidak terjangkau"; chip.className = "chip err";
  }
}
init();
