// Pencarian literatur nyata lewat OpenAlex API (https://api.openalex.org).
// API key dibaca dari env OPENALEX_API_KEY dan hanya dipakai di server.

const BASE = `${(process.env.OPENALEX_BASE_URL || "https://api.openalex.org").replace(/\/$/, "")}/works`;
const SELECT = [
  "id", "doi", "display_name", "publication_year", "authorships",
  "primary_location", "biblio", "cited_by_count", "abstract_inverted_index", "type", "language", "primary_topic",
].join(",");

export function rebuildAbstract(inv) {
  if (!inv || typeof inv !== "object") return "";
  const words = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions || []) words[p] = word;
  }
  return words.filter((w) => w !== undefined).join(" ").replace(/\s+/g, " ").trim();
}

function cleanDoi(doi) {
  if (!doi) return "";
  return String(doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
}

// Judul atau nama yang seluruhnya kapital ("DIGITAL ARCHIVING OF FOLK ART", "Y. LIU") dirapikan untuk gaya IEEE.
const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "via", "with", "dan", "di", "ke", "dari", "untuk", "pada", "yang", "dengan"]);
export function fixTitleCaps(t) {
  const s = String(t || "");
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 8 || letters !== letters.toUpperCase()) return s;
  return s.toLowerCase().replace(/[A-Za-z][^\s\-/]*/g, (w, i) => (i > 0 && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)));
}
export const fixNameCaps = (n) => String(n || "").replace(/\b([A-Z])([A-Z]{2,})\b/g, (m, a, b) => a + b.toLowerCase());

export function normalizeWork(w) {
  const authors = (w.authorships || [])
    .map((a) => fixNameCaps(a?.author?.display_name || a?.raw_author_name || ""))
    .filter(Boolean);
  const src = w.primary_location?.source || {};
  return {
    id: w.id || "",
    doi: cleanDoi(w.doi),
    title: fixTitleCaps((w.display_name || w.title || "").replace(/<[^>]+>/g, "").trim()),
    year: w.publication_year || null,
    authors,
    venue: src.display_name || "",
    venueType: src.type || "",
    volume: w.biblio?.volume || "",
    issue: w.biblio?.issue || "",
    firstPage: w.biblio?.first_page || "",
    lastPage: w.biblio?.last_page || "",
    citedBy: w.cited_by_count || 0,
    // Bidang ilmu menurut klasifikasi topik OpenAlex (membantu memilih referensi lintas disiplin).
    field: w.primary_topic?.field?.display_name || "",
    domain: w.primary_topic?.domain?.display_name || "",
    type: w.type || "",
    abstract: rebuildAbstract(w.abstract_inverted_index),
  };
}

function buildUrl({ query, yearFrom, sort, perPage, strict, apiKey }) {
  const p = new URLSearchParams();
  p.set("search", query);
  const filters = ["has_doi:true"];
  if (yearFrom) filters.push(`from_publication_date:${yearFrom}-01-01`);
  if (strict) filters.push("has_abstract:true");
  p.set("filter", filters.join(","));
  if (strict) p.set("select", SELECT);
  p.set("per-page", String(perPage));
  if (sort === "cited") p.set("sort", "cited_by_count:desc");
  else if (sort === "recent") p.set("sort", "publication_date:desc");
  const key = (apiKey || process.env.OPENALEX_API_KEY || "").trim();
  if (key) p.set("api_key", key);
  return `${BASE}?${p.toString()}`;
}

export async function searchWorks({ query, yearFrom, sort = "relevance", perPage = 25, apiKey = "" }) {
  const q = String(query || "").trim().slice(0, 300);
  if (!q) throw Object.assign(new Error("Kata kunci pencarian kosong."), { status: 400 });
  const yf = Number(yearFrom) >= 1900 && Number(yearFrom) <= 2100 ? Number(yearFrom) : null;
  const pp = Math.min(Math.max(Number(perPage) || 25, 5), 50);

  const usedKey = Boolean((apiKey || process.env.OPENALEX_API_KEY || "").trim());
  const get = (strict) => fetch(buildUrl({ query: q, yearFrom: yf, sort, perPage: pp, strict, apiKey }), {
    headers: { Accept: "application/json", "User-Agent": "ResearchLabPelatihan/1.0" },
    signal: AbortSignal.timeout(25000),
  }).catch((e) => {
    throw Object.assign(new Error(e?.name === "TimeoutError" ? "OpenAlex terlalu lama menjawab. Coba cari lagi." : "Server aplikasi gagal menghubungi OpenAlex. Coba lagi."), { status: 504 });
  });
  // Coba versi lengkap dulu; jika OpenAlex menolak parameter (400), ulangi dengan versi minimal.
  let resp = await get(true);
  if (resp.status === 400) resp = await get(false);
  // Batas per detik (banyak peserta mencari bersamaan): coba ulang hingga 3 kali dengan jeda acak.
  for (let attempt = 1; resp.status === 429 && usedKey && attempt <= 3; attempt++) {
    await new Promise((r) => setTimeout(r, Math.round(900 * attempt * (0.6 + Math.random() * 0.8))));
    resp = await get(true);
  }
  if (resp.status === 429) {
    const t = (await resp.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
    const msg = usedKey
      ? "OpenAlex menolak karena batas kuota atau kecepatan untuk API key ini tercapai. Tunggu beberapa detik lalu cari lagi; bila terus terjadi, cek sisa kuota di openalex.org/settings/api."
      : "Pencarian belum memakai API key OpenAlex. Tanpa key, OpenAlex memakai kuota gratis per alamat IP yang dipakai bersama banyak aplikasi di server Vercel, sehingga cepat habis. Tempel API key OpenAlex di langkah 1, atau isi OPENALEX_API_KEY (environment Production) di Vercel lalu Redeploy.";
    throw Object.assign(new Error(`${msg}${t ? ` [Pesan OpenAlex: ${t}]` : ""}`), { status: 429, code: usedKey ? "rate" : "nokey" });
  }
  if (resp.status === 401 || resp.status === 403) {
    throw Object.assign(new Error("API key OpenAlex ditolak. Periksa key yang ditempel atau buat key baru di openalex.org/settings/api."), { status: 400, code: "badkey" });
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw Object.assign(new Error(`OpenAlex mengembalikan status ${resp.status}. ${t.slice(0, 200)}`), { status: 502 });
  }
  const data = await resp.json();
  const results = (data.results || []).map(normalizeWork).filter((w) => w.title && w.doi);
  return { total: data.meta?.count ?? results.length, results };
}

// ---------- Format referensi IEEE ----------

function initials(name) {
  const parts = String(name).replace(/\s+/g, " ").trim().split(" ");
  if (parts.length === 1) return parts[0];
  const last = parts.pop();
  const ini = parts
    .map((p) => p.split("-").map((s) => (s ? s[0].toUpperCase() + "." : "")).join("-"))
    .join(" ");
  return `${ini} ${last}`;
}

export function ieeeAuthors(authors) {
  const a = (authors || []).map(initials);
  if (a.length === 0) return "";
  if (a.length > 6) return `${a[0]} et al.`;
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`;
}

// Mengembalikan potongan [{text, italic}] supaya nama jurnal bisa dicetak miring di .docx.
export function ieeeReferenceParts(w) {
  const parts = [];
  const auth = ieeeAuthors((w.authors || []).map(fixNameCaps));
  parts.push({ text: `${auth ? auth + ", " : ""}“${fixTitleCaps(w.title)},” ` });
  if (w.venue) parts.push({ text: w.venue, italic: true });
  const tail = [];
  if (w.volume) tail.push(`vol. ${w.volume}`);
  if (w.issue) tail.push(`no. ${w.issue}`);
  if (w.firstPage && w.lastPage && w.firstPage !== w.lastPage) tail.push(`pp. ${w.firstPage}–${w.lastPage}`);
  else if (w.firstPage) tail.push(`p. ${w.firstPage}`);
  if (w.year) tail.push(String(w.year));
  if (w.doi) tail.push(`doi: ${w.doi}`);
  parts.push({ text: (w.venue ? ", " : "") + tail.join(", ") + "." });
  return parts;
}

export function ieeeReferenceText(w) {
  return ieeeReferenceParts(w).map((p) => p.text).join("");
}
