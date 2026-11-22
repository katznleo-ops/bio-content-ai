// Vercel serverless API for EduCator.
// POST { messages: [{ role: 'user'|'model', text: string }] } -> { answer, model }
// The API credential is read only on the server and is never sent to the browser.

const ALLOWED_ORIGINS = new Set([
  'https://katznleo-ops.github.io',
  'https://bio-content-ai.vercel.app',
  ...(process.env.EXTRA_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean)
]);
const COMMIT = (process.env.VERCEL_GIT_COMMIT_SHA || 'unknown').slice(0, 12);
const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 8000;

function send(res, status, body) {
  res.setHeader('X-EduCator-Commit', COMMIT);
  return res.status(status).json(body);
}
function readMessages(body) {
  // Keep the previous { prompt } request shape working while the UI migrates.
  if (typeof body?.prompt === 'string') return [{ role: 'user', parts: [{ text: body.prompt.trim() }] }];
  if (!Array.isArray(body?.messages) || body.messages.length === 0) return null;
  if (body.messages.length > MAX_MESSAGES) return null;
  const messages = [];
  for (const item of body.messages) {
    if (!item || !['user', 'model'].includes(item.role) || typeof item.text !== 'string') return null;
    const text = item.text.trim();
    if (!text || text.length > MAX_MESSAGE_LENGTH) return null;
    const role = item.role === 'model' ? 'model' : 'user';
    // Gemini expects alternating user/model turns, beginning with user.
    if (messages.length === 0 && role !== 'user') continue;
    if (messages.length && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].parts[0].text += `\n\n${text}`;
    } else {
      messages.push({ role, parts: [{ text }] });
    }
  }
  return messages.length && messages[0].role === 'user' ? messages : null;
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(res, 405, { error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const contents = readMessages(body);
  if (!contents) return send(res, 400, { error: 'Send a conversation containing up to 30 valid messages.' });
  if (contents.reduce((total, message) => total + message.parts[0].text.length, 0) > 24000) {
    return send(res, 413, { error: 'This conversation is too long. Start a new conversation or shorten your message.' });
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return send(res, 500, { error: 'The learning service is not configured yet.' });
  const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim().replace(/^models\//, '');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let upstream;
  let data;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'You are EduCator, a warm, thoughtful tutor who helps learners understand subjects across math, science, writing, languages, history, technology, and everyday topics. Be accurate, clear, encouraging, and age-appropriate. Explain concepts step by step when useful, ask a clarifying question if needed, and help learners reason rather than simply doing graded work for them. Adapt to the learner’s requested level and format. Clearly say when you are unsure; never invent facts or citations. Format code and structured answers clearly.' }]
        },
        contents,
        generationConfig: { temperature: 0.45, maxOutputTokens: 4096 }
      })
    });
    data = await upstream.json().catch(() => null);
  } catch (error) {
    console.error('[educator] upstream request failed', String(error));
    return send(res, 502, { error: 'Could not reach the learning service. Please try again.' });
  }
  if (!upstream.ok) {
    const reason = data?.error?.status || 'UNKNOWN';
    console.error('[educator] provider error', upstream.status, reason);
    return send(res, 502, { error: 'A response could not be generated right now.', reason });
  }
  const answer = (data?.candidates?.[0]?.content?.parts || [])
    .filter((part) => !part.thought)
    .map((part) => part.text || '')
    .join('')
    .trim();
  if (!answer) return send(res, 502, { error: 'No answer came back. Please try again.' });
  return send(res, 200, { answer, model });
}
