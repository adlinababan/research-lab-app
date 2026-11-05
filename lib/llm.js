// Pemanggil model AI. Penyedia dipilih lewat env:
//   LLM_PROVIDER = "gemini" (bawaan) | "openai"  (format OpenAI-compatible, misalnya Groq)
//   GEMINI_API_KEY, GEMINI_MODEL (opsional; jika kosong, dipilih otomatis model "flash" terbaru)
//   OPENAI_COMPAT_API_KEY, OPENAI_COMPAT_BASE_URL (bawaan Groq), OPENAI_COMPAT_MODEL

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
let cachedGeminiModel = null;

export function providerInfo() {
  const provider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  if (provider === "openai") {
    return {
      provider,
      configured: Boolean(process.env.OPENAI_COMPAT_API_KEY),
      model: process.env.OPENAI_COMPAT_MODEL || "openai/gpt-oss-120b",
      label: process.env.OPENAI_COMPAT_LABEL || "Groq",
    };
  }
  return {
    provider: "gemini",
    configured: Boolean(process.env.GEMINI_API_KEY),
    model: process.env.GEMINI_MODEL || cachedGeminiModel || "otomatis (Gemini Flash)",
    label: "Google Gemini API",
  };
}

function versionScore(name) {
  const m = name.match(/(\d+)(?:\.(\d+))?/);
  if (!m) return 0;
  return Number(m[1]) * 100 + Number(m[2] || 0);
}

async function pickGeminiModel(key) {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  if (cachedGeminiModel) return cachedGeminiModel;
  const r = await fetch(`${GEMINI_BASE}/models?pageSize=1000`, { headers: { "x-goog-api-key": key } });
  if (r.status === 400 || r.status === 401 || r.status === 403) throw Object.assign(new Error("API key Gemini ditolak Google. Periksa kembali key yang dimasukkan (diawali AIza…), atau buat key baru di Google AI Studio."), { status: 400, code: "badkey" });
  if (!r.ok) throw Object.assign(new Error(`Gagal membaca daftar model Gemini (status ${r.status}).`), { status: 502 });
  const data = await r.json();
  const bad = /(image|tts|live|audio|embed|transcribe|translate|vision|robotics|computer-use|exp)/i;
  const names = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""))
    .filter((n) => /^gemini-/.test(n) && /flash/.test(n) && !bad.test(n));
  if (!names.length) throw Object.assign(new Error("Tidak ada model Gemini Flash yang tersedia untuk API key ini. Isi GEMINI_MODEL secara manual."), { status: 502 });
  names.sort((a, b) => {
    const pa = /preview/.test(a) ? 1 : 0, pb = /preview/.test(b) ? 1 : 0;
    if (pa !== pb) return pa - pb; // utamakan versi stabil
    const la = /lite/.test(a) ? 1 : 0, lb = /lite/.test(b) ? 1 : 0;
    if (la !== lb) return la - lb; // utamakan Flash (bukan Lite) untuk kualitas tulisan
    return versionScore(b) - versionScore(a);
  });
  cachedGeminiModel = names[0];
  return cachedGeminiModel;
}

async function callGemini(system, user, { temperature, userKey }) {
  const key = userKey || process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error("API key Gemini belum diisi. Masukkan API key Anda di langkah 1 (Kelompok)."), { status: 400, code: "nokey" });
  const model = await pickGeminiModel(key);
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { temperature, responseMimeType: "application/json" },
  };
  const r = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  if (r.status === 429) throw Object.assign(new Error("Kuota Gemini per menit untuk API key ini tercapai. Tunggu sekitar satu menit lalu klik lagi."), { status: 429 });
  if (r.status === 400 || r.status === 401 || r.status === 403) {
    const t = await r.text().catch(() => "");
    if (/API key|API_KEY|permission|PERMISSION_DENIED|invalid/i.test(t)) {
      throw Object.assign(new Error("API key Gemini ditolak Google. Periksa kembali key yang dimasukkan (diawali AIza…), atau buat key baru di Google AI Studio."), { status: 400, code: "badkey" });
    }
    throw Object.assign(new Error(`Gemini mengembalikan status ${r.status}. ${t.slice(0, 300)}`), { status: 502 });
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw Object.assign(new Error(`Gemini mengembalikan status ${r.status}. ${t.slice(0, 300)}`), { status: 502 });
  }
  const data = await r.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
  if (!text) throw Object.assign(new Error("Gemini tidak mengembalikan teks (mungkin diblokir filter keamanan). Ubah input lalu coba lagi."), { status: 502 });
  return { text, model };
}

async function callOpenAICompat(system, user, { temperature }) {
  const key = process.env.OPENAI_COMPAT_API_KEY;
  if (!key) throw Object.assign(new Error("OPENAI_COMPAT_API_KEY belum diisi di pengaturan Vercel."), { status: 500, code: "nokey" });
  const base = (process.env.OPENAI_COMPAT_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_COMPAT_MODEL || "openai/gpt-oss-120b";
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (r.status === 429) throw Object.assign(new Error("Kuota model AI per menit tercapai. Tunggu sekitar satu menit lalu klik lagi."), { status: 429 });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw Object.assign(new Error(`Penyedia AI mengembalikan status ${r.status}. ${t.slice(0, 300)}`), { status: 502 });
  }
  const data = await r.json();
  return { text: data.choices?.[0]?.message?.content || "", model };
}

export function parseJsonLoose(text) {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try { return JSON.parse(t); } catch {}
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try { return JSON.parse(t.slice(s, e + 1)); } catch {}
  }
  throw Object.assign(new Error("Jawaban AI tidak berformat JSON yang valid. Klik lagi untuk mencoba ulang."), { status: 502 });
}

// Key milik pengguna (dari header x-gemini-key) didahulukan; env GEMINI_API_KEY menjadi cadangan.
// Bila pengguna membawa key sendiri, Gemini selalu dipakai walau LLM_PROVIDER diatur lain.
export async function askJson(system, user, { temperature = 0.4, userKey = "" } = {}) {
  const { provider } = providerInfo();
  const out = provider === "openai" && !userKey
    ? await callOpenAICompat(system, user, { temperature })
    : await callGemini(system, user, { temperature, userKey });
  return { json: parseJsonLoose(out.text), model: out.model };
}
