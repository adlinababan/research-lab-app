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
function authorsPara(authors) {
  const blocks = authors.map((a) => {
    let xml = run(a.name || "[Nama Penulis]", { size: 22 });
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
        xml += `<w:r><w:rPr>${s.i ? "<w:i/><w:iCs/>" : ""}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:br/><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`;
      }
    }
    return xml;
  });
  return para("Author", blocks.join('<w:r><w:br w:type="column"/></w:r>'), '<w:spacing w:before="5pt" w:beforeAutospacing="1"/>');
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
  out.push(para("Author", "", `<w:spacing w:before="5pt" w:beforeAutospacing="1" w:after="5pt" w:afterAutospacing="1" w:line="6pt" w:lineRule="auto"/>${sectTitle}`));
  // Penulis (maks. 6: dua baris x 3 kolom)
  rows.forEach((row, i) => {
    out.push(authorsPara(row));
    out.push(`<w:p><w:pPr>${authorSects[i].replace(/w:num="\d+"/, `w:num="${row.length}"`)}</w:pPr></w:p>`);
  });

  // Abstrak & kata kunci
  out.push(para("Abstract", run(isId ? "Abstrak" : "Abstract", { italic: true }) + run("—") + richRuns(paper.abstract), '<w:spacing w:before="12pt"/>'));
  out.push(para("Keywords", run((isId ? "Kata kunci" : "Keywords") + "—") + run((paper.keywords || []).join(", "))));

  // Isi
  const matrixAfter = 1; // tabel matriks gap diletakkan di akhir bagian kedua (Related Work)
  (paper.sections || []).forEach((s, idx) => {
    out.push(para("Heading1", run(s.heading)));
    for (const p of s.paragraphs || []) out.push(para("BodyText", richRuns(p)));
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

  // Perbarui judul di properti dokumen (docProps/core.xml) bila ada.
  const core = entries.find((e) => e.name === "docProps/core.xml");
  if (core) {
    const c = core.data.toString("utf8");
    core.data = Buffer.from(c.replace(/<dc:title>[\s\S]*?<\/dc:title>|<dc:title\/>/, `<dc:title>${esc(paper.title || "")}</dc:title>`), "utf8");
  }
  return writeZip(entries);
}
