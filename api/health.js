import { getConfig, NAME, VERSION } from '../lib/config.js';
import { authorize } from '../lib/auth.js';
import { send, setCors } from '../lib/http.js';
import { inboxConfigured } from '../lib/inbox.js';
import { listTools } from '../lib/tools.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return send(res, 204);
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  const body = { ok: true, name: NAME, version: VERSION, time: new Date().toISOString() };
  if (authorize(req).ok) {
    const c = getConfig();
    body.details = {
      botConfigured: Boolean(c.botToken),
      authConfigured: Boolean(c.authToken),
      webhookSecretConfigured: Boolean(c.webhookSecret),
      inboxConfigured: inboxConfigured(),
      readOnly: c.readOnly,
      allowedChats: c.allowedChatIds.length,
      toolsEnabled: listTools().length,
      environment: process.env.VERCEL_ENV || 'local',
    };
  }
  return send(res, 200, body);
}
