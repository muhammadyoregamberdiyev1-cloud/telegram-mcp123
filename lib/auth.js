import { createHash, timingSafeEqual } from 'node:crypto';
import { getConfig } from './config.js';

export function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

function extractToken(req) {
  const h = req.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  if (h['x-api-key']) return String(h['x-api-key']).trim();
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    return url.searchParams.get('key') || '';
  } catch {
    return '';
  }
}

/**
 * Returns { ok: true } or { ok: false, status, message }.
 * Secure by default: if MCP_AUTH_TOKEN is missing the endpoint refuses to serve
 * unless ALLOW_NO_AUTH=true is set explicitly.
 */
export function authorize(req) {
  const cfg = getConfig();
  if (!cfg.authToken) {
    if (cfg.allowNoAuth) return { ok: true };
    return {
      ok: false,
      status: 503,
      message: 'Server is not configured: set MCP_AUTH_TOKEN in Vercel environment variables.',
    };
  }
  const token = extractToken(req);
  if (token && safeEqual(token, cfg.authToken)) return { ok: true };
  return { ok: false, status: 401, message: 'Unauthorized: invalid or missing token.' };
}
