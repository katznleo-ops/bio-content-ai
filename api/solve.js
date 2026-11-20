// api/solve.js — Vercel serverless function
// POST { prompt } -> { answer }   |   GET ?diag=1 -> deployment/config check (no secrets)

const ALLOWED_ORIGINS = new Set([
  "https://katznleo-ops.github.io",
  // Optional: comma-separated extra origins, e.g. a preview URL, set in Vercel as EXTRA_ORIGINS
  ...(process.env.EXTRA_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)
]);

const COMMIT = (process.env.VERCEL_GIT_COMMIT_SHA || "unknown").slice(0, 12);

// Accept "gemini-3.5-flash", "models/gemini-3.5-flash", or a value pasted with quotes/whitespace.
function cleanModel(raw) {
  return (raw || "gemini-3.5-flash").trim().replace(/^["']|["']$/g, "").replace(/^models\//, "");
}

function send(res, status, body) {
  res.setHeader("X-Solve-Commit", COMMIT);
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "X-Solve-Commit");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(204).end();

  const model = cleanModel(process.env.GEMINI_MODEL);
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();

  // Safe diagnostics: never returns the key, only whether one exists.
  if (req.method === "GET" && req.query?.diag === "1") {
    return send(res, 200, {
      ok: true,
      commit: COMMIT,
      vercelEnv: process.env.VERCEL_ENV || "unknown", // production | preview | development
      model,
      rawModelHadJunk: (process.env.GEMINI_MODEL || "") !== model && !!process.env.GEMINI_MODEL,
      hasKey: apiKey.length > 0
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return send(res, 405, { error: "Method not allowed", code: "METHOD" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) return send(res, 400, { error: "Please enter a question", code: "EMPTY_PROMPT" });
  if (prompt.length > 8000) {
    return send(res, 413, { error: "Question must be 8,000 characters or fewer", code: "TOO_LONG" });
  }
  if (!apiKey) return send(res, 500, { error: "Gemini API key is not configured", code: "NO_KEY" });

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) + ":generateContent";

  let upstream;
  let data;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: "You are a helpful biology tutor. Answer the student's question accurately and clearly. Explain concepts in student-friendly language." }]
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        // Newer models spend output tokens on reasoning; 2000 can leave nothing for the answer.
        generationConfig: { temperature: 0.2, maxOutputTokens: 8192 }
      })
    });
    data = await upstream.json().catch(() => null);
  } catch (err) {
    console.error("[solve] network error reaching Gemini", { model, commit: COMMIT, err: String(err) });
    return send(res, 502, { error: "Unable to contact Gemini", code: "GEMINI_UNREACHABLE" });
  }

  if (!upstream.ok) {
    // Google's error object contains no secrets; status + reason are safe to surface.
    const reason = data?.error?.status || "UNKNOWN";      // NOT_FOUND, PERMISSION_DENIED, RESOURCE_EXHAUSTED...
    const message = (data?.error?.message || "").slice(0, 300);
    console.error("[solve] Gemini error", { upstreamStatus: upstream.status, reason, model, commit: COMMIT, message });
    return send(res, 502, {
      error: "Gemini could not answer this question",
      code: `GEMINI_${upstream.status}`,
      upstreamStatus: upstream.status,
      reason,
      model,
      message
    });
  }

  const candidate = data?.candidates?.[0];
  const answer = (candidate?.content?.parts || [])
    .filter((p) => !p.thought)
    .map((p) => p.text || "")
    .join("")
    .trim();

  if (!answer) {
    const blockReason = data?.promptFeedback?.blockReason || null;
    const finishReason = candidate?.finishReason || null; // SAFETY, MAX_TOKENS, RECITATION...
    console.error("[solve] empty answer", { model, commit: COMMIT, blockReason, finishReason });
    return send(res, 502, { error: "Gemini returned no answer", code: "GEMINI_EMPTY", blockReason, finishReason, model });
  }

  return send(res, 200, { answer, model });
}
