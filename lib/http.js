// Helper HTTP kecil yang bekerja di Vercel maupun server lokal (tanpa dependensi).
import { loginRequired, verifyToken, tokenFrom } from "./auth.js";

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

export function sendError(res, status, message, extra = {}) {
  sendJson(res, status, { error: message, ...extra });
}

// Login: bila env APP_USERS diisi, setiap permintaan API wajib membawa token login yang sah.
// Bila tidak, berlaku kode akses opsional lama: env ACCESS_CODE + header x-access-code.
export function checkAccess(req, res) {
  if (loginRequired()) {
    const u = verifyToken(tokenFrom(req));
    if (u) { req.user = u; return true; }
    sendError(res, 401, "Silakan masuk dengan username dan password.", { code: "login" });
    return false;
  }
  const code = (process.env.ACCESS_CODE || "").trim();
  if (!code) return true;
  const given = String(req.headers["x-access-code"] || "").trim();
  if (given && given === code) return true;
  sendError(res, 401, "Kode akses salah atau belum diisi.", { code: "access" });
  return false;
}

// API key milik pengguna, dikirim per permintaan dari browser. Tidak pernah disimpan atau dicatat di server.
export function userKeys(req) {
  const clean = (v) => {
    const s = String(v || "").trim();
    return s.length >= 10 && s.length <= 200 && /^[A-Za-z0-9_\-.]+$/.test(s) ? s : "";
  };
  return {
    ai: clean(req.headers["x-ai-key"] || req.headers["x-gemini-key"]),
    openalex: clean(req.headers["x-openalex-key"]),
  };
}

export function isMock() {
  return process.env.MOCK === "1";
}

// Pembatas laju sederhana per IP (cukup untuk pelatihan; bukan pengaman produksi).
const hits = new Map();
// Batas dihitung per perangkat peserta (header x-client-id acak dari browser). Peserta di satu
// kampus berbagi IP (NAT) dan bisa memakai Research Lab key yang sama, jadi IP/key saja tidak cukup.
export function rateLimit(req, res, { limit = 40, windowMs = 60_000 } = {}) {
  const cid = String(req.headers["x-client-id"] || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);
  const k = userKeys(req).ai;
  const ip = cid
    ? `cid:${cid}`
    : String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "local").split(",")[0].trim() + (k ? `:${k.slice(-6)}` : "");
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    sendError(res, 429, "Terlalu banyak permintaan dalam satu menit. Tunggu sebentar lalu coba lagi.", { code: "rate" });
    return false;
  }
  arr.push(now);
  hits.set(ip, arr);
  return true;
}
