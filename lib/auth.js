// Login username + password tanpa database.
// Akun diatur lewat env APP_USERS (di Vercel: Settings › Environment Variables), satu akun per baris
// atau dipisah koma/titik koma, dengan format  username:password  atau  username:sha256:<hex>.
// Contoh:  dosen01:Rahasia#2026, dosen02:sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
// Token login ditandatangani HMAC (AUTH_SECRET bila ada) dan otomatis tidak berlaku bila akun dihapus
// atau password-nya diganti.
import crypto from "node:crypto";

const sha256 = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
export const normUser = (u) => String(u || "").trim().toLowerCase();

export function users() {
  const raw = String(process.env.APP_USERS || "");
  const map = new Map();
  for (const part of raw.split(/[\n,;]+/)) {
    const t = part.trim();
    const i = t.indexOf(":");
    if (i < 1) continue;
    const u = normUser(t.slice(0, i));
    const p = t.slice(i + 1);
    if (/^[a-z0-9._@-]{2,60}$/.test(u) && p) map.set(u, p);
  }
  return map;
}
export const loginRequired = () => users().size > 0;

function secret() {
  return process.env.AUTH_SECRET || sha256(`research-lab-auth:${process.env.APP_USERS || ""}`);
}
// Sidik jari password: token lama tidak berlaku lagi bila password diganti.
const pwTag = (stored) => sha256(`tag:${stored}`).slice(0, 12);

function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export function checkPassword(username, password) {
  const u = normUser(username);
  const stored = users().get(u);
  // Bandingkan tetap dijalankan walau akun tidak ada, agar waktu respons tidak membocorkan nama akun.
  const given = String(password || "");
  const ok = stored
    ? stored.startsWith("sha256:") ? safeEq(sha256(given), stored.slice(7).trim().toLowerCase()) : safeEq(sha256(given), sha256(stored))
    : (safeEq(sha256(given), sha256("x")), false);
  return ok ? u : "";
}

const TTL_DAYS = Number(process.env.AUTH_TTL_DAYS) > 0 ? Number(process.env.AUTH_TTL_DAYS) : 7;
export function signToken(user) {
  const exp = Date.now() + TTL_DAYS * 86400_000;
  const body = b64u(JSON.stringify({ u: user, exp, v: pwTag(users().get(user) || "") }));
  const sig = b64u(crypto.createHmac("sha256", secret()).update(body).digest());
  return { token: `${body}.${sig}`, exp };
}
export function verifyToken(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return "";
  const want = b64u(crypto.createHmac("sha256", secret()).update(body).digest());
  if (!safeEq(sig, want)) return "";
  try {
    const p = JSON.parse(unb64u(body).toString("utf8"));
    const stored = users().get(p.u);
    if (!stored || p.exp < Date.now() || p.v !== pwTag(stored)) return "";
    return p.u;
  } catch { return ""; }
}
export function tokenFrom(req) {
  const h = String(req.headers["authorization"] || "");
  return h.startsWith("Bearer ") ? h.slice(7).trim() : String(req.headers["x-auth-token"] || "").trim();
}

// Batas percobaan login gagal per IP (mencegah tebak password beruntun).
const fails = new Map();
const WINDOW = 15 * 60_000, MAX_FAILS = 12;
const ipOf = (req) => String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "local").split(",")[0].trim();
export function tooManyFails(req) {
  const now = Date.now();
  const list = (fails.get(ipOf(req)) || []).filter((t) => now - t < WINDOW);
  fails.set(ipOf(req), list);
  return list.length >= MAX_FAILS;
}
export function noteFail(req) {
  const list = fails.get(ipOf(req)) || [];
  list.push(Date.now()); fails.set(ipOf(req), list);
}
