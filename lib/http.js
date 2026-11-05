// Helper HTTP kecil yang bekerja di Vercel maupun server lokal (tanpa dependensi).

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

// Kode akses opsional: jika env ACCESS_CODE diisi, setiap permintaan wajib membawa header x-access-code.
export function checkAccess(req, res) {
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
  return { gemini: clean(req.headers["x-gemini-key"]), openalex: clean(req.headers["x-openalex-key"]) };
}

export function isMock() {
  return process.env.MOCK === "1";
}

// Pembatas laju sederhana per IP (cukup untuk pelatihan; bukan pengaman produksi).
const hits = new Map();
// Peserta dalam satu kampus sering berbagi satu IP (NAT), jadi batas dihitung per IP + key pengguna.
export function rateLimit(req, res, { limit = 40, windowMs = 60_000 } = {}) {
  const k = userKeys(req).gemini;
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "local").split(",")[0].trim() + (k ? `:${k.slice(-6)}` : "");
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
