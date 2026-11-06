// Membaca hasil analisis milik dosen di browser (tanpa library). Format yang didukung:
// - ZIP berisi file-file di bawah ini, atau folder proyek aplikasi (mode proyek)
// - Tabel: CSV/TSV, XLSX (setiap sheet dipecah per blok tabel, cocok untuk ekspor SmartPLS/SPSS),
//   HTML (ekspor SPSS, JASP, Jamovi, SmartPLS), JSON, JUnit XML (hasil pengujian)
// - Teks: TXT/LOG/MD, DOCX (transkrip, laporan NVivo/ATLAS.ti, ekspor Word SPSS), kode (.py/.R)
// - Gambar: PNG/JPG/WebP; notebook .ipynb yang sudah dijalankan (gambar, tabel pandas, output teks)
// Tidak ada data yang diolah ulang; file hanya dibaca dan diringkas untuk ditata ke dalam paper.

const MAX_ZIP = 40 * 1024 * 1024;
const MAX_ENTRY = 30 * 1024 * 1024;
const TABLE_ROWS = 60, TABLE_COLS = 15; // lebih besar dari ini dianggap data mentah
const TEXT_CHARS = 20000; // disimpan di browser; server memotong sesuai jenis analisis
const LIMITS = { figures: 12, tables: 25, texts: 12 };

const ext = (n) => (String(n).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
const base = (n) => String(n).split("/").pop();
const td = new TextDecoder("utf-8");
const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// ---------- ZIP ----------
async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}
// Mengembalikan daftar entri; isi baru diekstrak saat dibutuhkan (folder proyek bisa berisi ribuan file).
export function zipEntries(buf) {
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
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    const comp = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (name.endsWith("/")) continue;
    out.push({
      name, size,
      skip: flags & 1 ? "terenkripsi" : size > MAX_ENTRY ? "terlalu besar" : method === 0 || method === 8 ? "" : "kompresi tidak didukung",
      read: async () => {
        const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
        const raw = u8.subarray(start, start + comp);
        return method === 0 ? raw.slice() : inflateRaw(raw);
      },
    });
  }
  return out;
}
export async function unzip(buf) {
  const out = [];
  for (const e of zipEntries(buf)) {
    if (e.skip) { out.push({ name: e.name, skip: e.skip }); continue; }
    try { out.push({ name: e.name, data: await e.read() }); } catch { out.push({ name: e.name, skip: "gagal diekstrak" }); }
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
  return rows;
}
const blank = (r) => !r || r.every((c) => String(c ?? "").trim() === "");
// Kolom indeks pandas tanpa nama ("", "Unnamed: 0") yang isinya 0,1,2,… dibuang.
function dropIndexCol(grid) {
  const h = grid[0] || [];
  if (h.length > 1 && /^(|unnamed: ?0)$/i.test(String(h[0]).trim()) && grid.slice(1).every((r, i) => String(r[0]).trim() === String(i) || String(r[0]).trim() === "")) return grid.map((r) => r.slice(1));
  return grid;
}
// Buang kolom yang kosong di semua baris (umum di ekspor Excel).
function dropEmptyCols(grid) {
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const keep = [];
  for (let c = 0; c < cols; c++) if (grid.some((r) => String(r[c] ?? "").trim() !== "")) keep.push(c);
  return grid.map((r) => keep.map((c) => r[c] ?? ""));
}
function asTable(name, grid, source = "") {
  grid = dropEmptyCols(dropIndexCol(grid.filter((r) => !blank(r)).map((r) => r.map((c) => String(c ?? "").trim()))));
  if (grid.length < 2) return null;
  const headers = grid[0];
  const rows = grid.slice(1);
  const cols = Math.max(...grid.map((r) => r.length));
  if (rows.length > TABLE_ROWS || cols > TABLE_COLS) return { raw: true, name, rows: rows.length, headers: headers.slice(0, 30) };
  return { name, source, headers: Array.from({ length: cols }, (_, i) => headers[i] || ""), rows: rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? "")) };
}
// Satu sheet bisa berisi beberapa tabel (SmartPLS, SPSS) yang dipisah baris kosong. Baris berisi satu sel
// tepat di atas blok dipakai sebagai judul tabel.
function splitBlocks(name, grid, source) {
  const blocks = []; let cur = [];
  for (const r of grid) { if (blank(r)) { if (cur.length) blocks.push(cur); cur = []; } else cur.push(r); }
  if (cur.length) blocks.push(cur);
  const out = []; let title = "";
  for (const b of blocks) {
    const filled = (r) => r.filter((c) => String(c ?? "").trim() !== "").length;
    let body = b;
    while (body.length && filled(body[0]) === 1 && (body.length === 1 || filled(body[1]) > 1)) { title = String(body[0].find((c) => String(c ?? "").trim() !== "")).trim(); body = body.slice(1); }
    if (body.length < 2) continue;
    const t = asTable(title ? `${name} › ${title}` : name, body, source);
    if (t) out.push(t);
    title = "";
  }
  return out.length ? out : [asTable(name, grid, source)].filter(Boolean);
}
function gridOf(tb) {
  return [...tb.querySelectorAll("tr")].map((tr) => {
    const row = [];
    for (const c of tr.children) { const span = Math.min(10, Number(c.getAttribute("colspan")) || 1); row.push(c.textContent.replace(/\s+/g, " ").trim()); for (let k = 1; k < span; k++) row.push(""); }
    return row;
  });
}
function htmlDoc(html, name, source) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tables = [...doc.querySelectorAll("table")].map((tb, k) => {
    // Judul: <caption>, atau judul/teks tebal terdekat sebelum tabel (gaya ekspor SPSS/SmartPLS).
    let title = tb.querySelector("caption")?.textContent.trim() || "";
    let el = tb.previousElementSibling, hop = 0;
    while (!title && el && hop++ < 4) { const t = el.textContent.replace(/\s+/g, " ").trim(); if (t && t.length < 120) title = t; el = el.previousElementSibling; }
    tb.querySelector("caption")?.remove();
    const t = asTable(`${name} › ${title || `tabel ${k + 1}`}`, gridOf(tb), source);
    return t;
  }).filter(Boolean);
  doc.querySelectorAll("table, script, style").forEach((x) => x.remove());
  const text = (doc.body?.innerText || doc.body?.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  return { tables, text };
}
function xmlDoc(bytes) { return new DOMParser().parseFromString(td.decode(bytes), "application/xml"); }
const tag = (el, t) => [...el.getElementsByTagNameNS("*", t)];
function colIndex(ref) { let n = 0; for (const ch of String(ref).replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
async function readXlsx(bytes, name) {
  const files = new Map((await unzip(ab(bytes))).filter((e) => e.data).map((e) => [e.name, e.data]));
  const shared = files.has("xl/sharedStrings.xml") ? tag(xmlDoc(files.get("xl/sharedStrings.xml")), "si").map((si) => tag(si, "t").map((t) => t.textContent).join("")) : [];
  const wb = files.get("xl/workbook.xml") ? xmlDoc(files.get("xl/workbook.xml")) : null;
  const rels = files.get("xl/_rels/workbook.xml.rels") ? xmlDoc(files.get("xl/_rels/workbook.xml.rels")) : null;
  const relMap = new Map(rels ? tag(rels, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]) : []);
  const sheets = wb ? tag(wb, "sheet").map((s) => ({ title: s.getAttribute("name"), target: relMap.get(s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")) })) : [];
  const out = [];
  for (const [i, s] of (sheets.length ? sheets : [{ title: "Sheet1", target: "worksheets/sheet1.xml" }]).slice(0, 25).entries()) {
    const path = s.target ? (s.target.startsWith("/") ? s.target.slice(1) : `xl/${s.target.replace(/^\.\.\//, "")}`) : `xl/worksheets/sheet${i + 1}.xml`;
    const x = files.get(path); if (!x) continue;
    const grid = [];
    for (const r of tag(xmlDoc(x), "row").slice(0, 5000)) {
      const row = []; const rn = Number(r.getAttribute("r")) || grid.length + 1;
      for (const c of tag(r, "c")) {
        const t = c.getAttribute("t"); const v = tag(c, "v")[0]?.textContent ?? "";
        let val = t === "s" ? shared[Number(v)] ?? "" : t === "inlineStr" ? tag(c, "t").map((e) => e.textContent).join("") : v;
        // Angka biner Excel (0.89740000000000004) dirapikan ke 10 digit bermakna.
        if ((!t || t === "n") && /^-?\d+\.\d{11,}$/.test(val)) val = String(Number(Number(val).toPrecision(10)));
        row[colIndex(c.getAttribute("r") || "A")] = val;
      }
      while (grid.length < rn - 1) grid.push([]); // baris kosong menjadi pemisah blok
      grid.push(Array.from(row, (x) => x ?? ""));
    }
    out.push(...splitBlocks(`${name} › ${s.title}`, grid, "xlsx"));
  }
  return out;
}
// DOCX: paragraf menjadi teks (transkrip, laporan NVivo), tabel menjadi tabel (ekspor Word SPSS, codebook).
async function readDocx(bytes, name) {
  const files = new Map((await unzip(ab(bytes))).filter((e) => e.data).map((e) => [e.name, e.data]));
  const x = files.get("word/document.xml"); if (!x) return { tables: [], text: "" };
  const doc = xmlDoc(x);
  const tables = tag(doc, "tbl").map((tb, k) => {
    const grid = tag(tb, "tr").map((tr) => tag(tr, "tc").map((tc) => tag(tc, "t").map((t) => t.textContent).join("").trim()));
    return asTable(`${name} › tabel ${k + 1}`, grid, "docx");
  }).filter(Boolean);
  tag(doc, "tbl").forEach((tb) => tb.parentNode.removeChild(tb));
  const text = tag(doc, "p").map((p) => tag(p, "t").map((t) => t.textContent).join("")).filter((s) => s.trim()).join("\n");
  return { tables, text };
}
// JUnit XML (PHPUnit, Jest, pytest, Gradle, Flutter): ringkasan per test suite.
function junitTable(bytes, name) {
  const doc = xmlDoc(bytes);
  const suites = tag(doc, "testsuite");
  if (!suites.length) return null;
  const rows = suites.slice(0, 60).map((s) => [s.getAttribute("name") || "", s.getAttribute("tests") || "", s.getAttribute("failures") || "0", s.getAttribute("errors") || "0", s.getAttribute("skipped") || "0", s.getAttribute("time") || ""]);
  return asTable(`${name} (hasil pengujian)`, [["suite", "tests", "failures", "errors", "skipped", "time (s)"], ...rows], "junit");
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
  return { dataUrl, mime, w, h, ow: bmp.width, oh: bmp.height };
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
      if (d["text/html"] && /<table/i.test(nbText(d["text/html"]))) for (const t of htmlDoc(nbText(d["text/html"]), `${name} › sel ${k}`, "notebook").tables) push({ kind: "table", table: t });
      else if (d["text/plain"] && o.output_type === "execute_result") lines.push(`[sel ${k}] ${nbText(d["text/plain"]).trim()}`);
    }
  }
  if (lines.length) push({ kind: "text", name: `${name} (output)`, text: lines.join("\n").slice(-TEXT_CHARS) });
}

// ---------- folder proyek aplikasi ----------
const SKIP_DIR = /(^|\/)(node_modules|vendor|bower_components|\.git|\.svn|\.idea|\.vscode|\.dart_tool|\.gradle|\.next|\.nuxt|\.cache|\.expo|build|dist|out|target|bin|obj|Pods|DerivedData|venv|\.venv|env|__pycache__|storage\/framework|public\/build|coverage\/lcov-report)(\/|$)/i;
const SECRET = /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.keystore|.*\.jks|google-services\.json|GoogleService-Info\.plist|credentials?\.json|service-?account.*\.json|id_rsa.*)$/i;
const MANIFEST = /(^|\/)(package\.json|composer\.json|pubspec\.yaml|build\.gradle(\.kts)?|pom\.xml|requirements\.txt|pyproject\.toml|Pipfile|go\.mod|Cargo\.toml|.*\.csproj|Gemfile|artisan|manage\.py)$/i;
const LANG = {
  js: "JavaScript", jsx: "JavaScript (React)", mjs: "JavaScript", cjs: "JavaScript", ts: "TypeScript", tsx: "TypeScript (React)", vue: "Vue", svelte: "Svelte",
  php: "PHP", py: "Python", java: "Java", kt: "Kotlin", kts: "Kotlin", dart: "Dart", swift: "Swift", go: "Go", rs: "Rust", cs: "C#", cpp: "C++", c: "C", rb: "Ruby",
  html: "HTML", css: "CSS", scss: "SCSS", sql: "SQL", blade: "Blade",
};
const STACK = [
  [/^laravel\/framework$/, "Laravel"], [/^codeigniter4?\/framework$/, "CodeIgniter"], [/^symfony\/framework-bundle$/, "Symfony"],
  [/^react$/, "React"], [/^react-native$/, "React Native"], [/^next$/, "Next.js"], [/^vue$/, "Vue"], [/^nuxt$/, "Nuxt"], [/^@angular\/core$/, "Angular"], [/^svelte$/, "Svelte"],
  [/^express$/, "Express"], [/^@nestjs\/core$/, "NestJS"], [/^electron$/, "Electron"], [/^@ionic\//, "Ionic"], [/^expo$/, "Expo"],
  [/^tailwindcss$/, "Tailwind CSS"], [/^bootstrap$/, "Bootstrap"], [/^firebase|^cloud_firestore$|^firebase_core$/, "Firebase"],
  [/^mysql2?$|^mysql-connector|^pymysql$|^mysqlclient$/, "MySQL"], [/^pg$|^psycopg2?(-binary)?$|^postgres/, "PostgreSQL"], [/^mongoose$|^mongodb$|^pymongo$/, "MongoDB"], [/^sqflite$|^sqlite3$/, "SQLite"],
  [/^django$/i, "Django"], [/^flask$/i, "Flask"], [/^fastapi$/i, "FastAPI"], [/^streamlit$/i, "Streamlit"], [/^tensorflow$|^tflite/i, "TensorFlow"], [/^torch$/i, "PyTorch"], [/^scikit-learn$/i, "scikit-learn"],
  [/spring-boot/, "Spring Boot"], [/^get$|^provider$|^flutter_bloc$|^riverpod$/, "Flutter state management"], [/^http$|^dio$|^axios$/, "HTTP client"],
];
function parseManifest(name, text) {
  const deps = new Set(); const stack = new Set();
  const b = base(name).toLowerCase();
  try {
    if (b === "package.json") { const j = JSON.parse(text); for (const k of Object.keys({ ...j.dependencies, ...j.devDependencies })) deps.add(k); }
    else if (b === "composer.json") { const j = JSON.parse(text); for (const k of Object.keys({ ...j.require })) if (!/^php$|^ext-/.test(k)) deps.add(k); }
    else if (b === "pubspec.yaml") {
      stack.add("Flutter");
      let inDeps = false;
      for (const l of text.split(/\r?\n/)) {
        if (/^(dependencies|dev_dependencies):/.test(l)) { inDeps = true; continue; }
        if (/^\S/.test(l)) inDeps = false;
        const m = inDeps && l.match(/^ {2}([a-z0-9_]+):/); if (m && m[1] !== "flutter") deps.add(m[1]);
      }
    } else if (b === "requirements.txt" || b === "pipfile") { for (const l of text.split(/\r?\n/)) { const m = l.trim().match(/^([A-Za-z0-9_.-]+)/); if (m && !l.trim().startsWith("#") && !l.startsWith("[")) deps.add(m[1].toLowerCase()); } }
    else if (b === "pyproject.toml") { for (const m of text.matchAll(/^\s*"?([A-Za-z0-9_.-]+)\s*[=<>~"]/gm)) deps.add(m[1].toLowerCase()); }
    else if (/^build\.gradle/.test(b)) { stack.add(/kotlin/i.test(text) ? "Android (Kotlin)" : "Android/Java (Gradle)"); for (const m of text.matchAll(/(?:implementation|api|kapt|ksp)\s*\(?\s*["']([^:"']+):([^:"']+)/g)) deps.add(`${m[1]}:${m[2]}`); }
    else if (b === "pom.xml") { for (const m of text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) deps.add(m[1]); }
    else if (b === "go.mod") { stack.add("Go"); for (const m of text.matchAll(/^\s*([a-z0-9.\-/]+)\s+v\d/gm)) deps.add(m[1]); }
    else if (b === "artisan") stack.add("Laravel");
    else if (b === "manage.py") stack.add("Django");
  } catch {}
  for (const d of deps) for (const [re, label] of STACK) if (re.test(d)) stack.add(label);
  return { deps, stack };
}
function looksLikeScreenshot(path, w, h) {
  const p = path.toLowerCase();
  if (/screenshot|screen|tangkapan|capture|dokumentasi|docs?\/|hasil|evaluasi|pengujian|diagram|erd|uml|use.?case|arsitektur|architecture|flowchart|mockup|wireframe|figma/.test(p)) return true;
  if (/(^|\/)(assets|res|mipmap|drawable|icons?|images\/icons|fonts|public\/img|static\/img|web|ios|android|macos|windows|linux)(\/|$)/.test(p)) return false;
  if (/icon|logo|favicon|splash|launcher|avatar|placeholder|sprite/.test(p)) return false;
  return w >= 600 && h >= 400;
}
async function readProject(entries, zipName, push, ignored) {
  const files = entries.filter((e) => !SKIP_DIR.test(e.name) && !base(e.name).startsWith(".") && !e.name.includes("__MACOSX/") || SECRET.test(e.name));
  const langs = new Map(); const deps = new Set(); const stack = new Set(); const dbTables = new Set(); const tops = new Map();
  let secrets = 0, total = 0, tests = 0;
  const root = (() => { const first = files.map((e) => e.name.split("/")); const r = first.length && first.every((p) => p.length > 1 && p[0] === first[0][0]) ? first[0][0] + "/" : ""; return r; })();
  const imgs = [];
  for (const e of files) {
    if (SECRET.test(e.name)) { secrets++; continue; }
    if (e.skip) continue;
    total++;
    const rel = e.name.slice(root.length); const parts = rel.split("/");
    const top = parts.length > 1 ? parts[0] + "/" + (parts.length > 2 ? parts[1] + "/" : "") : "(root)";
    tops.set(top, (tops.get(top) || 0) + 1);
    const x = ext(e.name); const lang = /\.blade\.php$/i.test(e.name) ? "Blade" : LANG[x];
    if (lang) langs.set(lang, (langs.get(lang) || 0) + 1);
    if (/(^|\/)(tests?|__tests__|spec|integration_test)\//i.test(rel) || /(test|spec)\.(js|ts|dart|php|py|java|kt)$/i.test(rel)) tests++;
    try {
      if (MANIFEST.test(e.name) && e.size < 2e6) { const r = parseManifest(e.name, td.decode(await e.read())); r.deps.forEach((d) => deps.add(d)); r.stack.forEach((s) => stack.add(s)); }
      else if (x === "sql" && e.size < 5e6) { for (const m of td.decode(await e.read()).matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?[`"[]?(\w+)/gi)) dbTables.add(m[1]); }
      else if (/database\/migrations\/.*\.php$/i.test(e.name) && e.size < 2e5) { for (const m of td.decode(await e.read()).matchAll(/Schema::create\(\s*['"](\w+)/g)) dbTables.add(m[1]); }
      else if (/(^|\/)readme(\.md|\.txt)?$/i.test(e.name) && parts.length <= 2) push({ kind: "text", name: e.name, text: td.decode(await e.read()).slice(0, 6000) });
      else if (["png", "jpg", "jpeg", "webp"].includes(x) && e.size < 15e6) imgs.push(e);
      else if (["csv", "tsv", "xlsx", "xlsm", "docx", "html", "htm", "pdf"].includes(x) || (x === "xml" && /test|junit|report/i.test(e.name)) || /(^|\/)coverage-summary\.json$/.test(e.name)) await handleFile(e.name, await e.read(), push, ignored, 1);
    } catch (err) { ignored.push(`${e.name} (gagal dibaca)`); }
  }
  // Gambar proyek: hanya screenshot/diagram, bukan ikon dan aset aplikasi.
  for (const e of imgs) {
    try {
      const blob = new Blob([await e.read()], { type: `image/${ext(e.name) === "jpg" ? "jpeg" : ext(e.name)}` });
      const bmp = await createImageBitmap(blob);
      if (looksLikeScreenshot(e.name, bmp.width, bmp.height)) push({ kind: "image", name: e.name, blob });
    } catch {}
  }
  const tree = [...tops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([d, n]) => `${d} (${n} file)`);
  return {
    name: root.replace(/\/$/, "") || zipName.replace(/\.zip$/i, ""), files: total, secretsSkipped: secrets, testFiles: tests,
    languages: [...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([lang, n]) => ({ lang, files: n })),
    stack: [...stack], deps: [...deps].slice(0, 60), dbTables: [...dbTables].slice(0, 60), tree,
  };
}
function isProject(entries) {
  const live = entries.filter((e) => !SKIP_DIR.test(e.name));
  if (live.some((e) => MANIFEST.test(e.name))) return true;
  return live.filter((e) => LANG[ext(e.name)] && !["html", "css", "sql"].includes(ext(e.name))).length >= 15;
}

// ---------- satu file ----------
async function handleFile(name, bytes, push, ignored, depth) {
  const b = base(name);
  if (!b || b.startsWith(".") || name.includes("__MACOSX/") || b === "Thumbs.db" || b === "desktop.ini") return;
  if (SECRET.test(name)) { ignored.push(`${name} (dilewati demi keamanan: berkas rahasia)`); return; }
  const e = ext(b);
  try {
    if (["csv", "tsv"].includes(e)) for (const t of splitBlocks(name, parseDelimited(td.decode(bytes)), e)) push({ kind: "table", table: t });
    else if (["xlsx", "xlsm"].includes(e)) for (const t of await readXlsx(bytes, name)) push({ kind: "table", table: t });
    else if (["html", "htm"].includes(e)) {
      const r = htmlDoc(td.decode(bytes), name, "html");
      r.tables.forEach((t) => push({ kind: "table", table: t }));
      if (r.text.length > 200) push({ kind: "text", name: `${name} (teks)`, text: r.text.slice(0, TEXT_CHARS) });
    } else if (e === "docx") {
      const r = await readDocx(bytes, name);
      r.tables.forEach((t) => push({ kind: "table", table: t }));
      if (r.text.trim()) push({ kind: "text", name, text: r.text.slice(0, TEXT_CHARS), transcript: /transkrip|transcript|wawancara|interview|fgd|informan|narasumber/i.test(name) });
    } else if (e === "xml") { const t = junitTable(bytes, name); if (t) push({ kind: "table", table: t }); else ignored.push(`${name} (XML bukan laporan pengujian)`); }
    else if (e === "ipynb") await readNotebook(bytes, name, push);
    else if (e === "json") {
      const j = JSON.parse(td.decode(bytes));
      const t = jsonToTable(name, j);
      if (t) push({ kind: "table", table: t }); else push({ kind: "text", name, text: JSON.stringify(j, null, 1).slice(0, 6000) });
    } else if (["txt", "log", "md", "out", "tex", "rtf"].includes(e)) {
      const text = td.decode(bytes).slice(0, TEXT_CHARS);
      push({ kind: "text", name, text, transcript: /transkrip|transcript|wawancara|interview|fgd|informan|narasumber/i.test(name) });
    } else if (["py", "r", "m", "sql", "do", "sps", "syn", "yaml", "yml", "cfg", "toml"].includes(e)) push({ kind: "text", name, code: true, text: td.decode(bytes).slice(0, 6000) });
    else if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(e)) push({ kind: "image", name, blob: new Blob([bytes], { type: `image/${e === "jpg" ? "jpeg" : e}` }) });
    else if (e === "pdf") ignored.push(`${name} (PDF belum dibaca; ekspor ulang tabel ke Excel/HTML)`);
    else if (e === "spv") ignored.push(`${name} (file output SPSS: buka di SPSS, lalu File › Export ke Excel atau HTML)`);
    else if (["splsm", "splsp"].includes(e)) ignored.push(`${name} (file proyek SmartPLS: ekspor laporan ke Excel atau HTML)`);
    else if (["nvp", "nvpx", "atlproj"].includes(e)) ignored.push(`${name} (proyek NVivo/ATLAS.ti: ekspor codebook ke Excel dan transkrip ke DOCX/TXT)`);
    else if (["sav", "dta", "rds", "parquet"].includes(e)) ignored.push(`${name} (data mentah, tidak dibaca)`);
    else if (e === "zip" && depth > 0) ignored.push(`${name} (ZIP di dalam ZIP tidak dibuka)`);
    else ignored.push(`${name} (format .${e || "?"} belum didukung)`);
  } catch (err) { ignored.push(`${name} (gagal dibaca: ${String(err.message || err).slice(0, 60)})`); }
}

// ---------- titik masuk ----------
// files: FileList/array of File. Mengembalikan inventaris + data gambar (dataUrl) terpisah.
export async function readUploads(files) {
  const items = [];
  const ignored = [];
  const push = (x) => items.push(x);
  let project = null;
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (ext(f.name) === "zip") {
      if (bytes.byteLength > MAX_ZIP) { ignored.push(`${f.name} (ZIP lebih dari 40 MB; keluarkan node_modules, vendor, build, dan data mentah)`); continue; }
      const entries = zipEntries(ab(bytes));
      if (isProject(entries)) { project = await readProject(entries, f.name, push, ignored); continue; }
      for (const z of entries) {
        if (z.skip) { ignored.push(`${z.name} (${z.skip})`); continue; }
        await handleFile(z.name, await z.read(), push, ignored, 1);
      }
    } else await handleFile(f.name, bytes, push, ignored, 0);
  }

  const out = { figures: [], tables: [], texts: [], raw: [], ignored, project, figData: {} };
  for (const it of items) {
    if (it.kind === "table") {
      if (it.table.raw) out.raw.push({ name: it.table.name, rows: it.table.rows, headers: it.table.headers });
      else if (out.tables.length < LIMITS.tables) out.tables.push({ id: `T${out.tables.length + 1}`, ...it.table });
      else ignored.push(`${it.table.name} (melebihi ${LIMITS.tables} tabel)`);
    } else if (it.kind === "text") {
      if (out.texts.length < LIMITS.texts) out.texts.push({ id: `X${out.texts.length + 1}`, name: it.name, kind: it.code ? "code" : it.transcript ? "transcript" : "text", text: it.text });
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
