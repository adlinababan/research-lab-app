// Pemanggil model AI. Urutan pemilihan:
//   1. Key yang ditempel pengguna di aplikasi (header x-ai-key): "sk-or-…" = OpenRouter, "AIza…" = Gemini.
//   2. OPENROUTER_API_KEY di env server (model: OPENROUTER_MODEL, bawaan google/gemini-3.6-flash).
//   3. GEMINI_API_KEY di env server (model: GEMINI_MODEL, atau dipilih otomatis).
//   4. OPENAI_COMPAT_API_KEY (format OpenAI, mis. Groq) bila LLM_PROVIDER=openai.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
// Model OpenRouter yang boleh dipilih peserta (murah, cukup baik untuk tulisan akademik). Urutan pertama = bawaan.
export const OPENROUTER_MODELS = [
  { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5 — paling patuh instruksi (disarankan)", price: "$0,10 / $0,50" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash — paling hemat", price: "$0,09 / $0,18" },
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna — murah, serbaguna", price: "$0,10 / $0,50" },
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite — murah, cepat", price: "$0,10 / $0,40" },
  { id: "google/gemini-3.6-flash", label: "Gemini 3.6 Flash — lebih mahal", price: "$0,75 / $3,75" },
];
const OPENROUTER_DEFAULT_MODEL = OPENROUTER_MODELS[0].id;
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
    return { provider: "openrouter", configured: true, model: env("OPENROUTER_MODEL") || OPENROUTER_DEFAULT_MODEL, label: "OpenRouter" };
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
const BAD_KEY_MSG = "API key ditolak. Periksa kembali key yang ditempel (tanpa spasi), atau buat key baru.";

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
    if (/location is not supported|User location/i.test(t)) throw err("Gemini API tidak tersedia dari lokasi server ini. Gunakan API key OpenRouter.", 502);
    throw err(`Gemini mengembalikan status ${r.status}. ${t.slice(0, 300)}`, 502);
  }
  const data = await r.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
  if (!text) throw err("Gemini tidak mengembalikan teks (mungkin diblokir filter keamanan). Ubah input lalu coba lagi.", 502);
  return { text, model, label: "Google Gemini API" };
}

// ---------- Format OpenAI: OpenRouter dan penyedia lain ----------
async function callChat({ base, key, model, label, extraHeaders = {} }, system, user, { temperature, maxTokens }) {
  const send = (withFormat) => fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify({
      model,
      temperature,
      // max_tokens wajib dibatasi: OpenRouter menolak (402) bila saldo tidak cukup menutup batas output maksimum model.
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(withFormat ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  let r = await send(true);
  if (r.status === 400) {
    const t = await r.clone().text().catch(() => "");
    if (/response_format|json_object|structured/i.test(t)) r = await send(false);
  }
  if (r.status === 401) throw err(BAD_KEY_MSG, 400, "badkey");
  if (r.status === 402) {
    let detail = "", source = "";
    try { const j = await r.json(); detail = j?.error?.message || ""; source = j?.error?.metadata?.limit_source || ""; } catch {}
    const why = source === "openrouter_key_limit"
      ? "Batas kredit pada API key ini sudah habis. Naikkan limit key di openrouter.ai → Keys."
      : /afford|max_tokens/i.test(detail)
        ? "Saldo tersisa terlalu kecil untuk permintaan ini. Isi kredit di openrouter.ai → Credits."
        : "Saldo akun 0 atau minus. Isi kredit di openrouter.ai → Credits (minimal US$5).";
    throw err(`${label} menolak karena kredit tidak cukup (model ${model}). ${why}${detail ? ` [Pesan OpenRouter: ${detail.slice(0, 160)}]` : ""}`, 402, "credits");
  }
  if (r.status === 429) throw err(`Batas permintaan ${label} tercapai. Tunggu sekitar satu menit lalu klik lagi.`, 429);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw err(`${label} mengembalikan status ${r.status}. ${t.slice(0, 300)}`, 502);
  }
  const data = await r.json();
  if (data.error) throw err(`${label}: ${data.error.message || "permintaan gagal"}`, 502);
  const text = data.choices?.[0]?.message?.content || "";
  if (!text) throw err(`${label} tidak mengembalikan teks. Klik lagi untuk mencoba ulang.`, 502);
  return { text, model: data.model || model, label };
}

const openRouterCfg = (key, pickedModel) => ({
  base: OPENROUTER_BASE,
  key,
  model: (OPENROUTER_MODELS.some((m) => m.id === pickedModel) ? pickedModel : "") || env("OPENROUTER_MODEL") || OPENROUTER_DEFAULT_MODEL,
  label: "OpenRouter",
  extraHeaders: { "X-Title": "Research Lab", ...(env("APP_URL") ? { "HTTP-Referer": env("APP_URL") } : {}) },
});

export function parseJsonLoose(text) {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try { return JSON.parse(t); } catch {}
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try { return JSON.parse(t.slice(s, e + 1)); } catch {}
  }
  throw err("Jawaban AI tidak berformat JSON yang valid. Klik lagi untuk mencoba ulang.", 502);
}

export async function askJson(system, user, { temperature = 0.4, userKey = "", model = "", maxTokens = 4000 } = {}) {
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
    throw err("Belum ada API key AI. Tempel API key OpenRouter (sk-or-…) atau Gemini (AIza…) di langkah 1.", 400, "nokey");
  }
  return { json: parseJsonLoose(out.text), model: out.model, label: out.label };
}
