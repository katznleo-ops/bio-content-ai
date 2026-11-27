// Vercel serverless endpoint for EduCator's decision checks (Gemini Decisions API).
// GET  → { enabled, model }        so the app knows whether to use decision-based features
// POST → { input, questions }     shared input (text / images / PDFs) + up to 1,000 typed questions
import { ALLOWED_ORIGINS, decide, decisionsKey, decisionsModel, validateInput, validateQuestions } from './_decisions.js';

const COMMIT = (process.env.VERCEL_GIT_COMMIT_SHA || 'unknown').slice(0, 12);
function send(res, status, body) { res.setHeader('X-EduCator-Commit', COMMIT); return res.status(status).json(body); }

export default async function handler(req, res) {
  const origin = req.headers.origin; if (origin && ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return send(res, 200, { enabled: !!decisionsKey(), model: decisionsKey() ? decisionsModel() : null });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, OPTIONS'); return send(res, 405, { error: 'Method not allowed' }); }
  if (!decisionsKey()) return send(res, 503, { error: 'The decisions service is not configured yet.', disabled: true });
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const input = validateInput(body?.input), questions = validateQuestions(body?.questions);
  if (!input) return send(res, 400, { error: 'Send text, image, or PDF input (up to about 900K characters of text and 2.5 MB of files).' });
  if (!questions) return send(res, 400, { error: 'Send 1 to 1,000 valid yes/no, choice, or score questions.' });
  try {
    const data = await decide(input, questions);
    return send(res, 200, { answers: data.answers, usage: data.usage || null });
  } catch (error) {
    console.error('[educator] decisions failed', error.status || '', error.code || '', String(error.message || error));
    if (error.status === 400) return send(res, 400, { error: error.code ? 'That content could not be checked.' : 'The decision request was not accepted.', code: error.code || '' });
    return send(res, 502, { error: 'The decision check could not run right now.' });
  }
}
