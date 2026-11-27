// Shared helper for the Gemini Decisions API (gemini-decision-1).
// It uses its own key, GEMINI_DECISIONS_API_KEY, so decision traffic never touches the tutor's quota or credits.
// Files starting with "_" in api/ are not deployed as endpoints by Vercel.
const DECISIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/decisions';

export const ALLOWED_ORIGINS = new Set([
  'https://katznleo-ops.github.io',
  'https://bio-content-ai.vercel.app',
  'https://bio-content-ai-revised.vercel.app',
  ...(process.env.EXTRA_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean)
]);
export const decisionsKey = () => (process.env.GEMINI_DECISIONS_API_KEY || '').trim();
export const decisionsModel = () => (process.env.GEMINI_DECISIONS_MODEL || 'gemini-decision-1').trim().replace(/^models\//, '');

// One request: shared input + up to 1,000 typed questions. Retries briefly when the service is busy.
export async function decide(input, questions, { timeoutMs = 25000 } = {}) {
  const key = decisionsKey();
  if (!key) { const e = new Error('The decisions service is not configured.'); e.status = 503; e.disabled = true; throw e; }
  const body = JSON.stringify({ model: decisionsModel(), input, questions });
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(DECISIONS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body, signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.answers) return data;
      if ((response.status === 429 || response.status === 503) && attempt < 2) { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); continue; }
      const e = new Error(data?.error?.message || `Decisions API error (${response.status}).`); e.status = response.status; e.code = data?.error?.code || ''; throw e;
    } finally { clearTimeout(timer); }
  }
}

// ---------- Request validation (the endpoint is public, so check shapes and sizes) ----------
const MEDIA = { image: new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif']), document: new Set(['application/pdf']) };
export const MAX_TEXT_CHARS = 900000;       // roughly 225K tokens, inside the 262K context window
export const MAX_INLINE_BASE64 = 3400000;   // stays under Vercel's 4.5 MB request body limit
export function validateInput(input) {
  const blocks = typeof input === 'string' ? [{ type: 'text', text: input }] : Array.isArray(input) ? input : null;
  if (!blocks || !blocks.length || blocks.length > 40) return null;
  let text = 0, inline = 0; const clean = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') return null;
    if (b.type === 'text' && typeof b.text === 'string') { text += b.text.length; clean.push({ type: 'text', text: b.text }); continue; }
    if ((b.type === 'image' || b.type === 'document') && typeof b.data === 'string' && MEDIA[b.type].has(b.mime_type) && /^[A-Za-z0-9+/=]+$/.test(b.data)) {
      inline += b.data.length; clean.push({ type: b.type, data: b.data, mime_type: b.mime_type, ...(b.type === 'image' ? { resolution: ['low', 'medium', 'high'].includes(b.resolution) ? b.resolution : 'medium' } : {}) }); continue;
    }
    return null;
  }
  if (!text && !inline) return null;
  if (text > MAX_TEXT_CHARS || inline > MAX_INLINE_BASE64) return null;
  return clean;
}
export function validateQuestions(questions) {
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) return null;
  const entries = Object.entries(questions);
  if (!entries.length || entries.length > 1000) return null;
  const clean = {};
  for (const [key, q] of entries) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key) || !q || typeof q.instructions !== 'string' || !q.instructions.trim() || q.instructions.length > 4000) return null;
    if (q.type === 'noul') {
      const c = q.criteria;
      if (c !== undefined && (typeof c !== 'object' || typeof c.true_description !== 'string' || typeof c.false_description !== 'string')) return null;
      clean[key] = { type: 'noul', instructions: q.instructions, ...(c ? { criteria: { true_description: c.true_description.slice(0, 1000), false_description: c.false_description.slice(0, 1000) } } : {}) };
    } else if (q.type === 'choice') {
      const opts = q.criteria && typeof q.criteria === 'object' && !Array.isArray(q.criteria) ? Object.entries(q.criteria) : [];
      if (opts.length < 2 || opts.length > 255 || opts.some(([k, v]) => typeof v !== 'string' || !k || k.length > 128 || k !== k.trim())) return null;
      clean[key] = { type: 'choice', instructions: q.instructions, criteria: Object.fromEntries(opts.map(([k, v]) => [k, v.slice(0, 1000)])) };
    } else if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 255 || q.criteria.some((l) => typeof l !== 'string' || !l.trim())) return null;
      clean[key] = { type: 'score', instructions: q.instructions, criteria: q.criteria.map((l) => l.slice(0, 1000)) };
    } else return null;
  }
  return clean;
}
