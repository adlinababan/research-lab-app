// Mengisi template IEEE Conference (A4) milik pengguna dengan draf paper.
// Template asli dipertahankan: style, ukuran halaman, kolom, header/footer, penomoran heading & referensi.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readZip, writeZip } from "./zip.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATHS = [
  path.join(here, "..", "template", "ieee-conference-a4.docx"),
  path.join(process.cwd(), "template", "ieee-conference-a4.docx"),
];

function loadTemplate() {
  for (const p of TEMPLATE_PATHS) {
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  throw new Error("Template IEEE tidak ditemukan di folder template/.");
}

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  // buang karakter kontrol yang tidak sah di XML
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function run(text, { italic = false, bold = false, highlight = false, size = null } = {}) {
  let rpr = "";
  if (bold) rpr += "<w:b/><w:bCs/>";
  if (italic) rpr += "<w:i/><w:iCs/>";
  if (size) rpr += `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
  if (highlight) rpr += '<w:highlight w:val="yellow"/>';
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

// Teks dalam kurung siku yang bukan nomor sitasi = placeholder, diberi stabilo kuning.
const SPLIT_RE = /(\[(?!\d+\])[^[\]]+\])/;
const IS_PLACEHOLDER = /^\[(?!\d+\])[^[\]]+\]$/;
function richRuns(text, opts = {}) {
  return String(text || "")
    .split(SPLIT_RE)
    .filter((s) => s !== "")
    .map((seg) => (IS_PLACEHOLDER.test(seg) ? run(seg, { ...opts, highlight: true }) : run(seg, opts)))
    .join("");
}

const para = (style, runs, extraPPr = "") =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extraPPr}</w:pPr>${runs}</w:p>`;

// Semua penulis dalam satu paragraf, dipisah column break, agar setiap kolom sejajar di atas.
// Format per penulis (gaya IEEE): Nama / Departemen (miring) / Fakultas (miring) / Universitas (miring) / Kota, negara / email.
// Blok penulis 9 pt (sz dalam setengah poin): nama, departemen/fakultas/organisasi (miring), kota-negara, email/ORCID.
const AUTHOR_SZ = 18;
function authorsPara(authors) {
  const blocks = authors.map((a) => {
    let xml = run(a.name || "[Nama Penulis]", { size: AUTHOR_SZ });
    const sub = [
      { t: a.dept, i: true },
      { t: a.faculty, i: true },
      { t: a.org, i: true },
      { t: a.city, i: false },
      { t: a.email, i: false },
    ].filter((x) => String(x.t || "").trim());
    // Teks dengan "\n" (mis. "BINUS Business School\nUndergraduate Program") dicetak sebagai beberapa baris.
    for (const s of sub) {
      for (const line of String(s.t).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
        xml += `<w:r><w:rPr>${s.i ? "<w:i/><w:iCs/>" : ""}<w:sz w:val="${AUTHOR_SZ}"/><w:szCs w:val="${AUTHOR_SZ}"/></w:rPr><w:br/><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`;
      }
    }
    return xml;
  });
  return para("Author", blocks.join(`<w:r><w:rPr><w:sz w:val="${AUTHOR_SZ}"/><w:szCs w:val="${AUTHOR_SZ}"/></w:rPr><w:br w:type="column"/></w:r>`), `<w:spacing w:before="5pt" w:beforeAutospacing="1"/><w:rPr><w:sz w:val="${AUTHOR_SZ}"/><w:szCs w:val="${AUTHOR_SZ}"/></w:rPr>`);
}

function matrixTable(matrix, caption) {
  const aspects = matrix.aspects.slice(0, 4);
  const colPt = [34, 52, 52, 52, 52];
  const grid = colPt.map((pt) => `<w:gridCol w:w="${pt * 20}"/>`).join("");
  const border = (n) => `<w:${n} w:val="single" w:sz="2" w:space="0" w:color="auto"/>`;
  const cell = (text, i, style) =>
    `<w:tc><w:tcPr><w:tcW w:w="${colPt[i]}pt" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${para(style, run(text), style === "tablecopy" ? '<w:jc w:val="center"/>' : "")}</w:tc>`;
  const header = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/><w:jc w:val="center"/></w:trPr>${["Ref.", ...aspects].map((t, i) => cell(t, i, "tablecolhead")).join("")}</w:tr>`;
  const rows = matrix.rows.map((r) =>
    `<w:tr><w:trPr><w:cantSplit/><w:jc w:val="center"/></w:trPr>${[`[${r.n}]`, ...r.cells.slice(0, 4)].map((t, i) => cell(t, i, "tablecopy")).join("")}</w:tr>`
  ).join("");
  return para("tablehead", run(caption)) +
    `<w:tbl><w:tblPr><w:tblW w:w="0pt" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${["top", "start", "bottom", "end", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="0"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${header}${rows}</w:tbl>` +
    para("BodyText", "", '<w:ind w:firstLine="0pt"/>');
}

// Tabel hasil milik penulis (CSV/XLSX/teks) dengan gaya tabel template IEEE; lebar mengikuti satu kolom.
const COL_PT = 243;
function dataTable(t) {
  const n = Math.max(1, Math.min(8, t.headers.length));
  const first = n > 1 ? COL_PT * 1.4 / (n + 0.4) : COL_PT;
  const rest = n > 1 ? (COL_PT - first) / (n - 1) : 0;
  const colPt = Array.from({ length: n }, (_, i) => Math.floor(i === 0 ? first : rest));
  const grid = colPt.map((pt) => `<w:gridCol w:w="${pt * 20}"/>`).join("");
  const border = (b) => `<w:${b} w:val="single" w:sz="2" w:space="0" w:color="auto"/>`;
  const cell = (text, i, style) =>
    `<w:tc><w:tcPr><w:tcW w:w="${colPt[i]}pt" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${para(style, run(text), style === "tablecopy" ? `<w:jc w:val="${i === 0 ? "start" : "center"}"/>` : "")}</w:tc>`;
  const row = (cells, style, head) => `<w:tr><w:trPr><w:cantSplit/>${head ? "<w:tblHeader/>" : ""}<w:jc w:val="center"/></w:trPr>${colPt.map((_, i) => cell(cells[i] ?? "", i, style)).join("")}</w:tr>`;
  return para("tablehead", run(t.caption || "[Judul tabel]")) +
    `<w:tbl><w:tblPr><w:tblW w:w="0pt" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${["top", "start", "bottom", "end", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="0"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${row(t.headers, "tablecolhead", true)}${t.rows.map((r) => row(r, "tablecopy", false)).join("")}</w:tbl>` +
    para("BodyText", "", '<w:ind w:firstLine="0pt"/>');
}
// Gambar inline (DrawingML Strict, sesuai namespace template) + caption bernomor otomatis "Fig. n".
function figureBlock(f, rid, id) {
  const maxW = COL_PT * 12700, maxH = 300 * 12700;
  let cx = maxW, cy = Math.round(maxW * (f.h / f.w || 0.75));
  if (cy > maxH) { cx = Math.round(cx * maxH / cy); cy = maxH; }
  const A = "http://purl.oclc.org/ooxml/drawingml/main", PIC = "http://purl.oclc.org/ooxml/drawingml/picture";
  const drawing = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Figure ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A}" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(f.name || `figure${id}`)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  return para("", drawing, '<w:keepNext/><w:spacing w:before="6pt" w:after="0pt"/><w:jc w:val="center"/>') + para("figurecaption", richRuns(f.caption || "[Keterangan gambar]"));
}
const FIG_PLACEHOLDER = (isId) => para("figurecaption", run(isId ? "[Sisipkan gambar alur penelitian]" : "[Insert research workflow figure]", { highlight: true }));
// Sisipkan blok setelah paragraf pertama yang menyebut label-nya; bila tidak disebut, di akhir bagian.
function placeBlocks(paragraphs, blocks) {
  const after = new Map();
  for (const b of blocks) {
    const re = b.label ? new RegExp(`(^|[^\\w])${b.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`) : null;
    let at = re ? paragraphs.findIndex((p) => re.test(p)) : -1;
    if (at < 0) at = paragraphs.length - 1;
    if (!after.has(at)) after.set(at, []);
    after.get(at).push(b.xml);
  }
  return after;
}

/**
 * paper = { lang, title, authors:[{name,dept,org,city,email}], abstract, keywords:[],
 *           sections:[{heading, paragraphs:[]}], matrix:{aspects, rows:[{n,cells}]}|null,
 *           acknowledgment, references:[[{text, italic}]] }
 */
export function buildDocx(paper) {
  const entries = readZip(loadTemplate());
  const docEntry = entries.find((e) => e.name === "word/document.xml");
  if (!docEntry) throw new Error("Template tidak memiliki word/document.xml.");
  const xml = docEntry.data.toString("utf8");

  const bodyStart = xml.indexOf("<w:body>") + "<w:body>".length;
  const bodyEnd = xml.lastIndexOf("</w:body>");
  const head = xml.slice(0, bodyStart);
  const tail = xml.slice(bodyEnd);
  const body = xml.slice(bodyStart, bodyEnd);
  const sects = body.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) || [];
  if (sects.length < 4) throw new Error("Struktur section template tidak dikenali.");
  const sectTitle = sects[0];
  // Template IEEE: dua baris penulis, masing-masing section 3 kolom (penulis 1–3 dan 4–6).
  const allAuthors = (paper.authors?.length ? paper.authors : [{}]).slice(0, 6);
  const rows = [allAuthors.slice(0, 3), allAuthors.slice(3, 6)].filter((r) => r.length);
  const authorSects = [sects[1], /w:num="3"/.test(sects[2]) ? sects[2] : sects[1]];
  const sectBody = sects.find((s) => /w:num="2"/.test(s)) || sects[sects.length - 2];
  const sectFinal = sects[sects.length - 1];

  const isId = paper.lang === "id";
  const out = [];
  // Judul
  out.push(para("papertitle", run(paper.title || "[Judul Paper]"), '<w:spacing w:before="5pt" w:beforeAutospacing="1" w:after="5pt" w:afterAutospacing="1"/>'));
  // Pengingat status latihan di bawah judul (sengaja mudah dihapus oleh penulis).
  out.push(para("Author", run("Draf latihan Research Lab: tulis ulang, isi data asli, dan verifikasi sebelum digunakan. Hapus baris ini setelah naskah final.", { highlight: true, size: 18 }), '<w:spacing w:before="0pt" w:after="6pt"/><w:jc w:val="center"/>'));
  out.push(para("Author", "", `<w:spacing w:before="5pt" w:beforeAutospacing="1" w:after="5pt" w:afterAutospacing="1" w:line="6pt" w:lineRule="auto"/>${sectTitle}`));
  // Penulis (maks. 6: dua baris x 3 kolom)
  rows.forEach((row, i) => {
    out.push(authorsPara(row));
    out.push(`<w:p><w:pPr>${authorSects[i].replace(/w:num="\d+"/, `w:num="${row.length}"`)}</w:pPr></w:p>`);
  });

  // Abstrak & kata kunci
  out.push(para("Abstract", run(isId ? "Abstrak" : "Abstract", { italic: true }) + run("—") + richRuns(paper.abstract), '<w:spacing w:before="12pt"/>'));
  out.push(para("Keywords", run((isId ? "Kata kunci" : "Keywords") + "—") + run((paper.keywords || []).join(", "))));

  // Gambar dan tabel hasil milik penulis
  const media = [];
  const blocksFor = { 2: [], 3: [] };
  (paper.tables || []).forEach((t) => blocksFor[t.placement === "method" ? 2 : 3].push({ label: t.label, xml: dataTable(t) }));
  (paper.figures || []).forEach((f, i) => {
    const ext = f.mime === "image/jpeg" ? "jpeg" : "png";
    const rid = `rIdRlFig${i + 1}`;
    media.push({ rid, name: `word/media/rl_fig${i + 1}.${ext}`, target: `media/rl_fig${i + 1}.${ext}`, data: Buffer.from(f.data, "base64"), ext });
    blocksFor[f.placement === "method" ? 2 : 3].push({ label: f.label, xml: figureBlock(f, rid, 1000 + i) });
  });
  if (paper.methodFigPlaceholder) blocksFor[2].unshift({ label: isId ? "Gambar 1" : "Fig. 1", xml: FIG_PLACEHOLDER(isId) });

  // Isi
  const matrixAfter = 1; // tabel matriks gap diletakkan di akhir bagian kedua (Related Work)
  (paper.sections || []).forEach((s, idx) => {
    out.push(para("Heading1", run(s.heading)));
    const ps = s.paragraphs || [];
    const after = blocksFor[idx]?.length ? placeBlocks(ps, blocksFor[idx]) : new Map();
    ps.forEach((p, k) => { out.push(para("BodyText", richRuns(p))); for (const x of after.get(k) || []) out.push(x); });
    if (!ps.length) for (const x of after.get(-1) || []) out.push(x);
    if (idx === matrixAfter && paper.matrix?.rows?.length) {
      out.push(matrixTable(paper.matrix, isId ? "Matriks Gap Studi Terdahulu" : "Gap Matrix of Reviewed Studies"));
    }
  });

  // Ucapan terima kasih + pernyataan penggunaan AI
  out.push(para("Heading5", run(isId ? "Ucapan Terima Kasih" : "Acknowledgment")));
  out.push(para("BodyText", richRuns(paper.acknowledgment || "")));

  // Open Contributionship (CRediT) dan Open Data
  if (paper.contributionship) {
    out.push(para("Heading5", run("Open Contributionship")));
    out.push(para("BodyText", richRuns(paper.contributionship)));
  }
  if (paper.openData) {
    out.push(para("Heading5", run("Open Data")));
    out.push(para("BodyText", richRuns(paper.openData)));
  }

  // Referensi
  out.push(para("Heading5", run(isId ? "Referensi" : "References")));
  for (const parts of paper.references || []) {
    out.push(para("references", parts.map((p) => run(p.text, { italic: !!p.italic })).join(""), '<w:ind w:start="17.70pt" w:hanging="17.70pt"/>'));
  }
  out.push(`<w:p><w:pPr>${sectBody}</w:pPr></w:p>`);
  out.push(sectFinal);

  docEntry.data = Buffer.from(head + out.join("") + tail, "utf8");

  if (media.length) {
    const rels = entries.find((e) => e.name === "word/_rels/document.xml.rels");
    const ct = entries.find((e) => e.name === "[Content_Types].xml");
    let r = rels.data.toString("utf8");
    const add = media.map((m) => `<Relationship Id="${m.rid}" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/image" Target="${m.target}"/>`).join("");
    rels.data = Buffer.from(r.replace("</Relationships>", add + "</Relationships>"), "utf8");
    let c = ct.data.toString("utf8");
    for (const ext of new Set(media.map((m) => m.ext))) {
      if (!new RegExp(`Extension="${ext}"`, "i").test(c)) c = c.replace("<Default ", `<Default Extension="${ext}" ContentType="image/${ext === "jpeg" ? "jpeg" : "png"}"/><Default `);
    }
    ct.data = Buffer.from(c, "utf8");
    for (const m of media) entries.push({ name: m.name, data: m.data });
  }

  // Perbarui judul di properti dokumen (docProps/core.xml) bila ada.
  const core = entries.find((e) => e.name === "docProps/core.xml");
  if (core) {
    const c = core.data.toString("utf8");
    core.data = Buffer.from(c.replace(/<dc:title>[\s\S]*?<\/dc:title>|<dc:title\/>/, `<dc:title>${esc(paper.title || "")}</dc:title>`), "utf8");
  }
  return writeZip(entries);
}
