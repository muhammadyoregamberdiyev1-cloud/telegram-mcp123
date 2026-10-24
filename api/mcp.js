import { authorize } from '../lib/auth.js';
import { handlePayload } from '../lib/mcp.js';
import { send, setCors, readJson } from '../lib/http.js';

/**
 * MCP over Streamable HTTP (stateless, JSON responses).
 * URL: https://<project>.vercel.app/api/mcp  (alias: /mcp)
 */
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return send(res, 204);

  const auth = authorize(req);
  if (!auth.ok) {
    if (auth.status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="telegram-mcp"');
    return send(res, auth.status, { jsonrpc: '2.0', id: null, error: { code: -32001, message: auth.message } });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use POST (stateless Streamable HTTP; no SSE stream).' } });
  }

  let payload;
  try {
    payload = await readJson(req);
  } catch {
    return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  if (payload === undefined) return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Empty body' } });

  const { status, body } = await handlePayload(payload);
  return send(res, status, body);
}
