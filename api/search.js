import { readJson, sendJson, sendError, checkAccess, rateLimit, isMock } from "../lib/http.js";
import { searchWorks } from "../lib/openalex.js";
import { mockSearch } from "../lib/mock.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return sendError(res, 405, "Gunakan POST.");
  if (!checkAccess(req, res)) return;
  if (!rateLimit(req, res, { limit: 30 })) return;
  const body = await readJson(req);
  try {
    if (isMock()) return sendJson(res, 200, { ...mockSearch(body.query || ""), mock: true });
    const out = await searchWorks({ query: body.query, yearFrom: body.yearFrom, sort: body.sort, perPage: body.perPage });
    sendJson(res, 200, out);
  } catch (e) {
    sendError(res, e.status || 500, e.message || "Pencarian gagal.");
  }
}
