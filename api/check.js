// Memeriksa API key peserta: OpenRouter (validitas + saldo) dan OpenAlex (diterima atau tidak).
// Key tidak disimpan; hanya dipakai untuk satu panggilan uji yang murah.
import { sendJson, sendError, checkAccess, rateLimit, isMock, userKeys } from "../lib/http.js";
import { keyKind } from "../lib/llm.js";

const money = (n) => `US$${Number(n).toFixed(2)}`;
const OR_BASE = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
const OA_BASE = (process.env.OPENALEX_BASE_URL || "https://api.openalex.org").replace(/\/$/, "");
const T = () => AbortSignal.timeout(15000);

async function checkOpenRouter(key) {
  const h = { Authorization: `Bearer ${key}` };
  const r = await fetch(`${OR_BASE}/key`, { headers: h, signal: T() });
  if (r.status === 401 || r.status === 403) return { ok: false, msg: "Research Lab key ditolak. Periksa apakah key tersalin utuh tanpa spasi, atau minta key baru ke narasumber." };
  if (!r.ok) return { ok: false, msg: `Layanan AI mengembalikan status ${r.status}. Coba lagi sebentar.` };
  const info = (await r.json().catch(() => ({})))?.data || {};
  let balance = null;
  try {
    const c = await fetch(`${OR_BASE}/credits`, { headers: h, signal: T() });
    if (c.ok) {
      const d = (await c.json())?.data || {};
      if (d.total_credits != null) balance = Number(d.total_credits) - Number(d.total_usage || 0);
    }
  } catch {}
  if (info.limit_remaining != null && Number(info.limit_remaining) <= 0) {
    return { ok: false, msg: "Key valid, tetapi kuota pada key ini sudah habis. Hubungi narasumber." };
  }
  if (balance != null && balance <= 0) {
    return { ok: false, msg: `Key valid, tetapi saldo ${money(balance)}. Hubungi narasumber agar saldo diisi.` };
  }
  return { ok: true, msg: `Research Lab key valid${info.limit_remaining != null ? `, sisa kuota ${money(info.limit_remaining)}` : balance != null ? `, saldo ${money(balance)}` : ""}.` };
}

async function checkGemini(key) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=5", { headers: { "x-goog-api-key": key } });
  if (r.ok) return { ok: true, msg: "Key Gemini valid." };
  if ([400, 401, 403].includes(r.status)) return { ok: false, msg: "Key Gemini ditolak Google. Buat key baru di aistudio.google.com/apikey." };
  return { ok: false, msg: `Google mengembalikan status ${r.status}.` };
}

async function checkOpenAlex(key) {
  // Panggilan filter (bukan search) dengan 1 hasil: termasuk kuota gratis terbesar.
  const url = `${OA_BASE}/works?filter=publication_year:2024&per-page=1&select=id&api_key=${encodeURIComponent(key)}`;
  const get = () => fetch(url, { headers: { Accept: "application/json", "User-Agent": "ResearchLabPelatihan/1.0" }, signal: T() });
  let r = await get();
  // Banyak peserta mengecek bersamaan dengan key yang sama dapat menyentuh batas per detik: coba ulang dengan jeda acak.
  for (let attempt = 1; r.status === 429 && attempt <= 3; attempt++) {
    await new Promise((res) => setTimeout(res, Math.round(800 * attempt * (0.6 + Math.random() * 0.8))));
    r = await get();
  }
  if (r.ok) return { ok: true, msg: "Key OpenAlex diterima. Kuota gratis US$1 per hari (sekitar 1.000 pencarian)." };
  const t = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 140);
  if (r.status === 401 || r.status === 403) return { ok: false, msg: `Key OpenAlex ditolak. Salin ulang dari openalex.org/settings/api.${t ? ` [${t}]` : ""}` };
  if (r.status === 429) {
    const daily = /daily|budget|quota/i.test(t);
    return { ok: false, msg: daily
      ? `Kuota harian key OpenAlex ini sudah habis; akan pulih pukul 07.00 WIB.${t ? ` [${t}]` : ""}`
      : `OpenAlex sedang membatasi permintaan (mungkin banyak peserta mengecek bersamaan). Tunggu beberapa detik lalu klik Cek lagi.${t ? ` [${t}]` : ""}` };
  }
  return { ok: false, msg: `OpenAlex mengembalikan status ${r.status}.${t ? ` [${t}]` : ""}` };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendError(res, 405, "Gunakan POST.");
  if (!checkAccess(req, res)) return;
  if (!rateLimit(req, res, { limit: 30 })) return;
  if (isMock()) return sendJson(res, 200, { ai: { ok: true, msg: "Mode uji: key tidak diperiksa." }, openalex: { ok: true, msg: "Mode uji: key tidak diperiksa." } });
  const k = userKeys(req);
  const out = {};
  try {
    const kind = keyKind(k.ai);
    if (kind === "openrouter") out.ai = await checkOpenRouter(k.ai);
    else if (kind === "gemini") out.ai = await checkGemini(k.ai);
    else if (k.ai) out.ai = { ok: false, msg: "Format Research Lab key tidak dikenal. Salin ulang key dari narasumber." };
    else if ((process.env.OPENROUTER_API_KEY || "").trim()) out.ai = await checkOpenRouter(process.env.OPENROUTER_API_KEY.trim()).then((r) => ({ ...r, msg: `Memakai key narasumber di server. ${r.msg}` }));
    else out.ai = { ok: false, msg: "Research Lab key belum diisi." };
  } catch (e) { out.ai = { ok: false, msg: `Gagal memeriksa key AI: ${e.message}` }; }
  try {
    const oa = k.openalex || (process.env.OPENALEX_API_KEY || "").trim();
    out.openalex = oa ? await checkOpenAlex(oa) : { ok: false, msg: "Key OpenAlex belum diisi." };
    if (!k.openalex && oa) out.openalex.msg = `Memakai key narasumber di server. ${out.openalex.msg}`;
  } catch (e) { out.openalex = { ok: false, msg: `Gagal memeriksa key OpenAlex: ${e.message}` }; }
  sendJson(res, 200, out);
}
