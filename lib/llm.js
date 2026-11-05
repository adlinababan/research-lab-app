// Pemanggil model AI. Urutan pemilihan:
//   1. Key yang ditempel pengguna di aplikasi (header x-ai-key): "sk-or-…" = OpenRouter, "AIza…" = Gemini.
//   2. OPENROUTER_API_KEY di env server.
//   Model OpenRouter: pilihan peserta dari daftar selectable; bawaan LOCKED_MODEL (google/gemini-2.5-flash-lite, env OPENROUTER_MODEL).
//   3. GEMINI_API_KEY di env server (model: GEMINI_MODEL, atau dipilih otomatis).
//   4. OPENAI_COMPAT_API_KEY (format OpenAI, mis. Groq) bila LLM_PROVIDER=openai.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER_BASE = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
// Batas waktu satu panggilan AI (draf terpanjang ±60 detik); mencegah permintaan menggantung.
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 100000);
const jitter = (ms) => Math.round(ms * (0.75 + Math.random() * 0.5));
// Daftar model di aplikasi. selectable = boleh dipilih peserta; selain itu tampil tetapi nonaktif.
// Model ":free" gratis di OpenRouter, tetapi dibatasi ±20 permintaan/menit per akun dan kuota harian.
export const OPENROUTER_MODELS = [
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", selectable: true },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "NVIDIA Nemotron 3 Ultra (free)", selectable: true, free: true },
  { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B (free)", selectable: true, free: true },
  { id: "google/gemma-4-26b-a4b-it:free", label: "Gemma 4 26B A4B (free)", selectable: true, free: true },
  { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna" },
  { id: "google/gemini-3.6-flash", label: "Gemini 3.6 Flash" },
];
// Model bawaan (terpilih saat pertama kali dibuka). Bisa diganti lewat env OPENROUTER_MODEL.
export const LOCKED_MODEL = () => env("OPENROUTER_MODEL") || "google/gemini-2.5-flash-lite";
const isFree = (m) => /:free$/.test(String(m || ""));
// Hanya model selectable (atau model bawaan) yang diterima server; pilihan lain diganti model bawaan.
export function resolveModel(requested) {
  const id = String(requested || "").trim();
  if (id && (id === LOCKED_MODEL() || OPENROUTER_MODELS.some((m) => m.id === id && m.selectable))) return id;
  return LOCKED_MODEL();
}
const OPENROUTER_DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
let cachedGeminiModel = null;

const env = (k) => (process.env[k] || "").trim();

export function keyKind(key) {
  const k = String(key || "");
  if (k.startsWith("sk-or-")) return "openrouter";
  if (k.startsWith("AIza")) return "gemini";
  return "";
}

export function providerInfo() {
  if (env("OPENROUTER_API_KEY")) {
    return { provider: "openrouter", configured: true, model: LOCKED_MODEL(), label: "OpenRouter" };
  }
  if (env("GEMINI_API_KEY")) {
    return { provider: "gemini", configured: true, model: env("GEMINI_MODEL") || cachedGeminiModel || "Gemini Flash (otomatis)", label: "Google Gemini API" };
  }
  if ((env("LLM_PROVIDER") || "").toLowerCase() === "openai" && env("OPENAI_COMPAT_API_KEY")) {
    return { provider: "openai", configured: true, model: env("OPENAI_COMPAT_MODEL") || "openai/gpt-oss-120b", label: env("OPENAI_COMPAT_LABEL") || "Groq" };
  }
  return { provider: "", configured: false, model: "", label: "" };
}

function err(message, status, code) { return Object.assign(new Error(message), { status, code }); }

// ---------- Gemini (Google AI Studio) ----------
function versionScore(name) {
  const m = name.match(/(\d+)(?:\.(\d+))?/);
  return m ? Number(m[1]) * 100 + Number(m[2] || 0) : 0;
}
const BAD_KEY_MSG = "Key ditolak. Periksa kembali key yang ditempel (tanpa spasi), atau minta key baru ke narasumber.";

async function pickGeminiModel(key) {
  if (env("GEMINI_MODEL")) return env("GEMINI_MODEL");
  if (cachedGeminiModel) return cachedGeminiModel;
  const r = await fetch(`${GEMINI_BASE}/models?pageSize=1000`, { headers: { "x-goog-api-key": key } });
  if ([400, 401, 403].includes(r.status)) throw err(BAD_KEY_MSG, 400, "badkey");
  if (!r.ok) throw err(`Gagal membaca daftar model Gemini (status ${r.status}).`, 502);
  const data = await r.json();
  const bad = /(image|tts|live|audio|embed|transcribe|translate|vision|robotics|computer-use|exp)/i;
  const names = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""))
    .filter((n) => /^gemini-/.test(n) && /flash/.test(n) && !bad.test(n));
  if (!names.length) throw err("Tidak ada model Gemini Flash yang tersedia untuk API key ini.", 502);
  names.sort((a, b) => {
    const pa = /preview/.test(a) ? 1 : 0, pb = /preview/.test(b) ? 1 : 0;
    if (pa !== pb) return pa - pb;
    const la = /lite/.test(a) ? 1 : 0, lb = /lite/.test(b) ? 1 : 0;
    if (la !== lb) return la - lb;
    return versionScore(b) - versionScore(a);
  });
  cachedGeminiModel = names[0];
  return cachedGeminiModel;
}

async function callGemini(system, user, { temperature, key }) {
  const model = await pickGeminiModel(key);
  const r = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature, responseMimeType: "application/json" },
    }),
  });
  if (r.status === 429) throw err("Kuota Gemini per menit untuk API key ini tercapai. Tunggu sekitar satu menit lalu klik lagi.", 429);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    if ([400, 401, 403].includes(r.status) && /API key|API_KEY|PERMISSION_DENIED|invalid/i.test(t)) throw err(BAD_KEY_MSG, 400, "badkey");
    if (/location is not supported|User location/i.test(t)) throw err("Gemini API tidak tersedia dari lokasi server ini. Gunakan Research Lab key.", 502);
    throw err(`Gemini mengembalikan status ${r.status}. ${t.slice(0, 300)}`, 502);
  }
  const data = await r.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
  if (!text) throw err("Gemini tidak mengembalikan teks (mungkin diblokir filter keamanan). Ubah input lalu coba lagi.", 502);
  return { text, model, label: "Google Gemini API" };
}

// ---------- Format OpenAI: OpenRouter dan penyedia lain ----------
// label = nama sistem AI (untuk pernyataan penggunaan AI); who = nama yang ditampilkan di pesan error untuk peserta.
async function callChat({ base, key, model, label, who = label, extraHeaders = {} }, system, user, { temperature, maxTokens }) {
  const free = isFree(model);
  // Model gratis tidak memotong saldo, jadi batas output boleh lebih longgar (model penalaran butuh token ekstra).
  if (free && maxTokens) maxTokens = Math.min(Math.max(maxTokens * 2, 4000), 16000);
  let withReasoning = free;
  const send = (withFormat) => fetch(`${base}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(free ? Math.max(AI_TIMEOUT_MS, 200000) : AI_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify({
      model,
      temperature,
      // max_tokens wajib dibatasi: OpenRouter menolak (402) bila saldo tidak cukup menutup batas output maksimum model.
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(withFormat ? { response_format: { type: "json_object" } } : {}),
      // Model penalaran (mis. Nemotron): kurangi "berpikir" agar cepat dan token tidak habis sebelum jawaban.
      ...(withReasoning ? { reasoning: { effort: "low", exclude: true } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  let withFormat = true;
  let r = await send(withFormat);
  if (r.status === 400) {
    const t = await r.clone().text().catch(() => "");
    if (/response_format|json_object|structured|reasoning/i.test(t)) { withFormat = false; withReasoning = false; r = await send(withFormat); }
  }
  // 429 biasanya berasal dari penyedia model (mis. Google) yang sedang padat, bukan dari kuota key.
  // Coba ulang otomatis hingga 3 kali dengan jeda bertahap (menghormati Retry-After bila ada).
  for (let attempt = 1; r.status === 429 && attempt <= 3; attempt++) {
    const ra = Number(r.headers?.get?.("retry-after"));
    // Jitter agar 20+ peserta yang tertolak bersamaan tidak mencoba ulang pada detik yang sama.
    const waitMs = Math.min(jitter(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * attempt * attempt), 12000);
    await new Promise((res) => setTimeout(res, waitMs));
    r = await send(withFormat);
  }
  if (r.status === 401) throw err(BAD_KEY_MSG, 400, "badkey");
  if (r.status === 404 && free) {
    const t = await r.text().catch(() => "");
    throw err(`Model gratis ${model} tidak tersedia untuk key ini. Bila pesannya menyebut "data policy", aktifkan model gratis di openrouter.ai/settings/privacy; atau pilih Gemini 2.5 Flash-Lite.${t ? ` [${t.replace(/\s+/g, " ").slice(0, 160)}]` : ""}`, 502, "model");
  }
  if (r.status === 402) {
    let detail = "", source = "";
    try { const j = await r.json(); detail = j?.error?.message || ""; source = j?.error?.metadata?.limit_source || ""; } catch {}
    const why = source === "openrouter_key_limit"
      ? "Kuota pada key ini sudah habis."
      : /afford|max_tokens/i.test(detail)
        ? "Saldo tersisa terlalu kecil untuk permintaan ini."
        : "Saldo key ini 0.";
    throw err(`${who} ditolak karena kredit tidak cukup. ${why} Hubungi narasumber.${detail ? ` [${detail.slice(0, 160)}]` : ""}`, 402, "credits");
  }
  if (r.status === 429) {
    let detail = "";
    try { const j = await r.json(); detail = j?.error?.metadata?.raw || j?.error?.message || ""; } catch {}
    const upstream = /upstream|provider|temporarily|rate-limited/i.test(String(detail));
    if (free) throw err(`Model gratis ${model} sedang dibatasi (OpenRouter membatasi model gratis ±20 permintaan per menit per akun dan kuota harian). Sudah dicoba ulang 3 kali. Pilih Gemini 2.5 Flash-Lite atau tunggu 1 menit.${detail ? ` [${String(detail).slice(0, 160)}]` : ""}`, 429, "rate");
    throw err(`${upstream ? `Server model AI (${model}) sedang padat` : `Batas permintaan ${who} tercapai`} dan sudah dicoba ulang otomatis 3 kali. Tunggu 30–60 detik lalu klik lagi.${detail ? ` [${String(detail).slice(0, 180)}]` : ""}`, 429, "rate");
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw err(`${who} mengembalikan status ${r.status}. ${t.slice(0, 300)}`, 502);
  }
  const data = await r.json();
  if (data.error) throw err(`${who}: ${data.error.message || "permintaan gagal"}`, 502);
  const text = data.choices?.[0]?.message?.content || "";
  if (!text) throw err(`${who} tidak mengembalikan teks${free ? " (model gratis kadang kehabisan token saat bernalar)" : ""}. Klik lagi untuk mencoba ulang${free ? " atau pilih Gemini 2.5 Flash-Lite" : ""}.`, 502);
  return { text, model: data.model || model, label, finish: data.choices?.[0]?.finish_reason || "" };
}

// Model: pilihan peserta bila termasuk daftar yang diizinkan; selain itu model bawaan.
const openRouterCfg = (key, model) => ({
  base: OPENROUTER_BASE,
  key,
  model: resolveModel(model) || OPENROUTER_DEFAULT_MODEL,
  label: "OpenRouter",
  who: "Research Lab key",
  extraHeaders: { "X-Title": "Research Lab", ...(env("APP_URL") ? { "HTTP-Referer": env("APP_URL") } : {}) },
});

export function parseJsonLoose(text, finish = "") {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try { return JSON.parse(t); } catch {}
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try { return JSON.parse(t.slice(s, e + 1)); } catch {}
  }
  // finish_reason "length" = jawaban terpotong karena batas token; ditangani dengan versi ringkas di api/llm.js.
  if (finish === "length") throw err("Jawaban AI terpotong karena terlalu panjang. Klik lagi untuk mencoba ulang.", 502, "truncated");
  throw err("Jawaban AI tidak berformat JSON yang valid. Klik lagi untuk mencoba ulang.", 502, "badjson");
}

async function askJsonInner(system, user, { temperature = 0.4, userKey = "", model = "", maxTokens = 4000 } = {}) {
  let out;
  const kind = keyKind(userKey);
  if (kind === "openrouter") out = await callChat(openRouterCfg(userKey, model), system, user, { temperature, maxTokens });
  else if (kind === "gemini") out = await callGemini(system, user, { temperature, key: userKey });
  else if (env("OPENROUTER_API_KEY")) out = await callChat(openRouterCfg(env("OPENROUTER_API_KEY"), model), system, user, { temperature, maxTokens });
  else if (env("GEMINI_API_KEY")) out = await callGemini(system, user, { temperature, key: env("GEMINI_API_KEY") });
  else if ((env("LLM_PROVIDER") || "").toLowerCase() === "openai" && env("OPENAI_COMPAT_API_KEY")) {
    out = await callChat({
      base: (env("OPENAI_COMPAT_BASE_URL") || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
      key: env("OPENAI_COMPAT_API_KEY"),
      model: env("OPENAI_COMPAT_MODEL") || "openai/gpt-oss-120b",
      label: env("OPENAI_COMPAT_LABEL") || "Groq",
    }, system, user, { temperature, maxTokens });
  } else {
    throw err("Research Lab key belum diisi. Tempel key dari narasumber di langkah 1.", 400, "nokey");
  }
  return { json: parseJsonLoose(out.text, out.finish), model: out.model, label: out.label };
}

export async function askJson(system, user, opts = {}) {
  try {
    return await askJsonInner(system, user, opts);
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw err("Layanan AI terlalu lama menjawab. Klik lagi; bila berulang, tunggu sebentar.", 504, "timeout");
    }
    if (e instanceof TypeError && /fetch failed/i.test(e.message)) {
      throw err("Server aplikasi gagal menghubungi layanan AI. Coba lagi beberapa saat.", 502, "network");
    }
    throw e;
  }
}
