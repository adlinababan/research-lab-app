import { readJson, sendJson, sendError } from "../lib/http.js";
import { loginRequired, checkPassword, signToken, verifyToken, tokenFrom, tooManyFails, noteFail } from "../lib/auth.js";

// POST {username, password} -> {token, user, exp}.  GET -> cek token yang sedang dipakai.
export default async function handler(req, res) {
  if (!loginRequired()) return sendJson(res, 200, { loginRequired: false });
  if (req.method === "GET") {
    const u = verifyToken(tokenFrom(req));
    return u ? sendJson(res, 200, { user: u }) : sendError(res, 401, "Sesi login berakhir. Silakan masuk lagi.", { code: "login" });
  }
  if (req.method !== "POST") return sendError(res, 405, "Gunakan POST.");
  if (tooManyFails(req)) return sendError(res, 429, "Terlalu banyak percobaan masuk yang gagal. Coba lagi 15 menit lagi atau hubungi narasumber.", { code: "rate" });
  const b = await readJson(req);
  const user = checkPassword(b.username, b.password);
  if (!user) {
    noteFail(req);
    await new Promise((r) => setTimeout(r, 400));
    return sendError(res, 401, "Username atau password salah.", { code: "login" });
  }
  const { token, exp } = signToken(user);
  sendJson(res, 200, { token, user, exp });
}
