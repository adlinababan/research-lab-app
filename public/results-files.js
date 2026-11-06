// Membaca hasil analisis milik dosen di browser (tanpa library): ZIP, CSV/TSV, XLSX, JSON, TXT/LOG/MD,
// kode (.py/.R), gambar (PNG/JPG/WebP), dan notebook .ipynb yang sudah dijalankan.
// Tidak ada data yang diolah ulang; file hanya dibaca dan diringkas untuk ditata ke dalam paper.

const MAX_ZIP = 25 * 1024 * 1024;
const MAX_ENTRY = 30 * 1024 * 1024;
const TABLE_ROWS = 60, TABLE_COLS = 15; // lebih besar dari ini dianggap data mentah
const TEXT_CHARS = 3500;
const LIMITS = { figures: 12, tables: 15, texts: 10 };

const ext = (n) => (String(n).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
const base = (n) => String(n).split("/").pop();
const td = new TextDecoder("utf-8");

// ---------- ZIP ----------
async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}
export async function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("File ZIP tidak valid atau rusak.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const comp = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (name.endsWith("/")) continue;
    if (flags & 1) { out.push({ name, skip: "terenkripsi" }); continue; }
    if (size > MAX_ENTRY) { out.push({ name, skip: "terlalu besar" }); continue; }
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const raw = u8.subarray(start, start + comp);
    try {
      out.push({ name, data: method === 0 ? raw.slice() : method === 8 ? await inflateRaw(raw) : null, skip: method === 0 || method === 8 ? "" : "kompresi tidak didukung" });
    } catch { out.push({ name, skip: "gagal diekstrak" }); }
  }
  return out;
}

// ---------- tabel ----------
function parseDelimited(text) {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] || "";
  const d = ["\t", ";", ","].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
    if (rows.length > 100000) break;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}
// Kolom indeks pandas tanpa nama ("", "Unnamed: 0") yang isinya 0,1,2,… dibuang.
function dropIndexCol(grid) {
  const h = grid[0] || [];
  if (h.length > 1 && /^(|unnamed: ?0)$/i.test(String(h[0]).trim()) && grid.slice(1).every((r, i) => String(r[0]).trim() === String(i) || String(r[0]).trim() === "")) return grid.map((r) => r.slice(1));
  return grid;
}
function asTable(name, grid, source = "") {
  grid = dropIndexCol(grid.map((r) => r.map((c) => String(c ?? "").trim())));
  if (!grid.length) return null;
  const headers = grid[0];
  const rows = grid.slice(1);
  const cols = Math.max(...grid.map((r) => r.length));
  if (rows.length > TABLE_ROWS || cols > TABLE_COLS) return { raw: true, name, rows: rows.length, headers: headers.slice(0, 30) };
  return { name, source, headers: Array.from({ length: cols }, (_, i) => headers[i] || ""), rows: rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? "")) };
}
function htmlTables(html, name) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("table")].map((tb, k) => {
    const grid = [...tb.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.textContent.trim()));
    return asTable(`${name}#tabel${k + 1}`, grid, "notebook");
  }).filter(Boolean);
}
function xmlDoc(bytes) { return new DOMParser().parseFromString(td.decode(bytes), "application/xml"); }
const tag = (el, t) => [...el.getElementsByTagNameNS("*", t)];
function colIndex(ref) { let n = 0; for (const ch of String(ref).replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
async function readXlsx(bytes, name) {
  const files = new Map((await unzip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).filter((e) => e.data).map((e) => [e.name, e.data]));
  const shared = files.has("xl/sharedStrings.xml") ? tag(xmlDoc(files.get("xl/sharedStrings.xml")), "si").map((si) => tag(si, "t").map((t) => t.textContent).join("")) : [];
  const wb = files.get("xl/workbook.xml") ? xmlDoc(files.get("xl/workbook.xml")) : null;
  const rels = files.get("xl/_rels/workbook.xml.rels") ? xmlDoc(files.get("xl/_rels/workbook.xml.rels")) : null;
  const relMap = new Map(rels ? tag(rels, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]) : []);
  const sheets = wb ? tag(wb, "sheet").map((s) => ({ title: s.getAttribute("name"), target: relMap.get(s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")) })) : [];
  const out = [];
  for (const [i, s] of (sheets.length ? sheets : [{ title: "Sheet1", target: "worksheets/sheet1.xml" }]).slice(0, 6).entries()) {
    const path = s.target ? (s.target.startsWith("/") ? s.target.slice(1) : `xl/${s.target.replace(/^\.\.\//, "")}`) : `xl/worksheets/sheet${i + 1}.xml`;
    const x = files.get(path); if (!x) continue;
    const grid = [];
    for (const r of tag(xmlDoc(x), "row").slice(0, 5000)) {
      const row = [];
      for (const c of tag(r, "c")) {
        const t = c.getAttribute("t"); const v = tag(c, "v")[0]?.textContent ?? "";
        const val = t === "s" ? shared[Number(v)] ?? "" : t === "inlineStr" ? tag(c, "t").map((e) => e.textContent).join("") : v;
        row[colIndex(c.getAttribute("r") || "A")] = val;
      }
      grid.push(Array.from(row, (x) => x ?? ""));
    }
    const tb = asTable(`${name} › ${s.title}`, grid, "xlsx");
    if (tb) out.push(tb);
  }
  return out;
}
function jsonToTable(name, j) {
  if (Array.isArray(j) && j.length && j.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
    const keys = [...new Set(j.flatMap((o) => Object.keys(o)))];
    return asTable(name, [keys, ...j.map((o) => keys.map((k) => (typeof o[k] === "object" ? JSON.stringify(o[k]) : o[k])))], "json");
  }
  if (j && typeof j === "object" && !Array.isArray(j)) {
    const rows = [];
    const walk = (o, pre, depth) => {
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === "object" && !Array.isArray(v) && depth < 2) walk(v, pre ? `${pre}.${k}` : k, depth + 1);
        else rows.push([pre ? `${pre}.${k}` : k, Array.isArray(v) ? JSON.stringify(v) : String(v)]);
      }
    };
    walk(j, "", 0);
    if (rows.length && rows.length <= TABLE_ROWS) return asTable(name, [["key", "value"], ...rows], "json");
  }
  return null;
}

// ---------- gambar ----------
async function normImage(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 1600 / bmp.width);
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
  let dataUrl = cv.toDataURL("image/png"), mime = "image/png";
  if (dataUrl.length > 1_200_000) { dataUrl = cv.toDataURL("image/jpeg", 0.88); mime = "image/jpeg"; }
  return { dataUrl, mime, w, h };
}
const b64ToBlob = (b64, type) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });

// ---------- notebook ----------
function nbText(x) { return Array.isArray(x) ? x.join("") : String(x || ""); }
async function readNotebook(bytes, name, push) {
  const nb = JSON.parse(td.decode(bytes));
  const lines = [];
  let k = 0;
  for (const c of nb.cells || []) {
    if (c.cell_type !== "code") continue;
    k++;
    const src = nbText(c.source).trim();
    const ctx = src.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).slice(-3).join(" ; ").slice(0, 300);
    for (const o of c.outputs || []) {
      const d = o.data || {};
      if (o.output_type === "stream") lines.push(`[sel ${k}] ${nbText(o.text).trim()}`);
      if (d["image/png"]) push({ kind: "image", name: `${name} › sel ${k}`, blob: b64ToBlob(nbText(d["image/png"]).replace(/\s/g, ""), "image/png"), context: ctx });
      else if (d["image/jpeg"]) push({ kind: "image", name: `${name} › sel ${k}`, blob: b64ToBlob(nbText(d["image/jpeg"]).replace(/\s/g, ""), "image/jpeg"), context: ctx });
      if (d["text/html"] && /<table/i.test(nbText(d["text/html"]))) for (const t of htmlTables(nbText(d["text/html"]), `${name} › sel ${k}`)) push({ kind: "table", table: t });
      else if (d["text/plain"] && (o.output_type === "execute_result")) lines.push(`[sel ${k}] ${nbText(d["text/plain"]).trim()}`);
    }
  }
  if (lines.length) push({ kind: "text", name: `${name} (output)`, text: lines.join("\n").slice(-TEXT_CHARS * 2) });
}

// ---------- titik masuk ----------
// files: FileList/array of File. Mengembalikan inventaris + data gambar (dataUrl) terpisah.
export async function readUploads(files) {
  const items = [];
  const ignored = [];
  const push = (x) => items.push(x);
  const handle = async (name, bytes, depth = 0) => {
    const b = base(name);
    if (!b || b.startsWith(".") || name.includes("__MACOSX/") || b === "Thumbs.db") return;
    const e = ext(b);
    try {
      if (e === "zip" && depth === 0) {
        if (bytes.byteLength > MAX_ZIP) { ignored.push(`${b} (ZIP lebih dari 25 MB)`); return; }
        for (const z of await unzip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))) {
          if (z.skip) ignored.push(`${z.name} (${z.skip})`); else await handle(z.name, z.data, 1);
        }
      } else if (["csv", "tsv"].includes(e)) { const t = asTable(name, parseDelimited(td.decode(bytes)), e); if (t) push({ kind: "table", table: t }); }
      else if (["xlsx", "xlsm"].includes(e)) { for (const t of await readXlsx(bytes, name)) push({ kind: "table", table: t }); }
      else if (e === "ipynb") await readNotebook(bytes, name, push);
      else if (e === "json") {
        const j = JSON.parse(td.decode(bytes));
        const t = jsonToTable(name, j);
        if (t) push({ kind: "table", table: t }); else push({ kind: "text", name, text: JSON.stringify(j, null, 1).slice(0, TEXT_CHARS) });
      } else if (["txt", "log", "md", "out", "tex"].includes(e)) push({ kind: "text", name, text: td.decode(bytes).slice(0, TEXT_CHARS) });
      else if (["py", "r", "m", "sql", "yaml", "yml", "cfg", "toml"].includes(e)) push({ kind: "text", name, code: true, text: td.decode(bytes).slice(0, TEXT_CHARS) });
      else if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(e)) push({ kind: "image", name, blob: new Blob([bytes], { type: `image/${e === "jpg" ? "jpeg" : e}` }) });
      else ignored.push(`${name} (format .${e || "?"} belum didukung)`);
    } catch (err) { ignored.push(`${name} (gagal dibaca: ${String(err.message || err).slice(0, 60)})`); }
  };
  for (const f of files) await handle(f.name, new Uint8Array(await f.arrayBuffer()));

  const out = { figures: [], tables: [], texts: [], raw: [], ignored, figData: {} };
  for (const it of items) {
    if (it.kind === "table") {
      if (it.table.raw) out.raw.push({ name: it.table.name, rows: it.table.rows, headers: it.table.headers });
      else if (out.tables.length < LIMITS.tables) out.tables.push({ id: `T${out.tables.length + 1}`, ...it.table });
      else ignored.push(`${it.table.name} (melebihi ${LIMITS.tables} tabel)`);
    } else if (it.kind === "text") {
      if (out.texts.length < LIMITS.texts) out.texts.push({ id: `X${out.texts.length + 1}`, name: it.name, kind: it.code ? "code" : "text", text: it.text });
      else ignored.push(`${it.name} (melebihi ${LIMITS.texts} output teks)`);
    } else if (it.kind === "image") {
      if (out.figures.length >= LIMITS.figures) { ignored.push(`${it.name} (melebihi ${LIMITS.figures} gambar)`); continue; }
      try {
        const im = await normImage(it.blob);
        const id = `F${out.figures.length + 1}`;
        out.figures.push({ id, name: it.name, w: im.w, h: im.h, mime: im.mime, context: it.context || "" });
        out.figData[id] = im.dataUrl;
      } catch { ignored.push(`${it.name} (gambar tidak dapat dibuka)`); }
    }
  }
  return out;
}

// ---------- penyimpanan gambar (IndexedDB; localStorage terlalu kecil) ----------
const DB = "research-lab-figs", ST = "figs";
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function saveFigs(map) {
  try {
    const db = await idb();
    await new Promise((res, rej) => { const tx = db.transaction(ST, "readwrite"); const s = tx.objectStore(ST); s.clear(); for (const [k, v] of Object.entries(map)) s.put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch {}
}
export async function loadFigs() {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const out = {}; const tx = db.transaction(ST, "readonly"); const req = tx.objectStore(ST).openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue(); } else res(out); };
      req.onerror = () => res({});
    });
  } catch { return {}; }
}
