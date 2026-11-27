// Vercel serverless endpoint for "Sign in with Google".
// GET  → { googleClientId }   so the app can show the Google button (null when not configured)
// POST → { credential }       verifies a Google ID token and returns the learner's basic profile
// Set GOOGLE_CLIENT_ID in Vercel to the OAuth Web client ID from Google Cloud Console.
import { ALLOWED_ORIGINS } from './_decisions.js';

const clientId = () => (process.env.GOOGLE_CLIENT_ID || '').trim();

export default async function handler(req, res) {
  const origin = req.headers.origin; if (origin && ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ googleClientId: clientId() || null });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, OPTIONS'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!clientId()) return res.status(503).json({ error: 'Google sign-in is not set up yet.' });
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const credential = typeof body?.credential === 'string' ? body.credential.trim() : '';
  if (!credential || credential.length > 4096) return res.status(400).json({ error: 'Missing sign-in token.' });
  try {
    // Google checks the token's signature and expiry; we check it was issued for EduCator.
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    const t = await r.json().catch(() => ({}));
    const issuerOk = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com';
    if (!r.ok || t.aud !== clientId() || !issuerOk || !t.sub || Number(t.exp) * 1000 < Date.now()) return res.status(401).json({ error: 'That Google sign-in could not be verified. Please try again.' });
    return res.status(200).json({
      profile: { sub: t.sub, name: t.name || '', firstName: t.given_name || '', email: t.email_verified === 'true' || t.email_verified === true ? t.email || '' : '', picture: t.picture || '' }
    });
  } catch (error) {
    console.error('[educator] google verify failed', String(error.message || error));
    return res.status(502).json({ error: 'Could not reach Google to finish signing in. Please try again.' });
  }
}
