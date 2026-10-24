import { authorize } from '../lib/auth.js';
import { callTelegram } from '../lib/telegram.js';
import { toolSummaries } from '../lib/tools.js';
import { getConfig } from '../lib/config.js';
import { send, setCors, readJson } from '../lib/http.js';
import { safeMessage } from '../lib/tools.js';

/** Admin panel backend. Every action requires the MCP_AUTH_TOKEN. */
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return send(res, 204);
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });

  const auth = authorize(req);
  if (!auth.ok) return send(res, auth.status, { error: auth.message });

  let body;
  try {
    body = (await readJson(req)) || {};
  } catch {
    return send(res, 400, { error: 'Invalid JSON' });
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try {
    switch (body.action) {
      case 'status': {
        const [me, webhook] = await Promise.allSettled([callTelegram('getMe'), callTelegram('getWebhookInfo')]);
        return send(res, 200, {
          bot: me.status === 'fulfilled' ? me.value : { error: safeMessage(me.reason) },
          webhook: webhook.status === 'fulfilled' ? webhook.value : { error: safeMessage(webhook.reason) },
        });
      }
      case 'tools':
        return send(res, 200, { tools: toolSummaries() });
      case 'send_test': {
        if (!body.chat_id) return send(res, 400, { error: 'chat_id is required' });
        const r = await callTelegram('sendMessage', { chat_id: body.chat_id, text: body.text || '✅ Telegram MCP test message' });
        return send(res, 200, { ok: true, message_id: r.message_id });
      }
      case 'set_webhook': {
        const cfg = getConfig();
        const url = body.url || `https://${host}/api/webhook`;
        if (!/^https:\/\//.test(url)) return send(res, 400, { error: 'Webhook URL must be HTTPS' });
        await callTelegram('setWebhook', {
          url,
          secret_token: cfg.webhookSecret || undefined,
          drop_pending_updates: Boolean(body.drop_pending_updates),
          allowed_updates: ['message', 'edited_message', 'channel_post', 'callback_query', 'my_chat_member', 'chat_member', 'chat_join_request'],
        });
        return send(res, 200, { ok: true, url, secretProtected: Boolean(cfg.webhookSecret) });
      }
      case 'delete_webhook':
        await callTelegram('deleteWebhook', { drop_pending_updates: Boolean(body.drop_pending_updates) });
        return send(res, 200, { ok: true });
      default:
        return send(res, 400, { error: 'Unknown action' });
    }
  } catch (e) {
    return send(res, 502, { error: safeMessage(e) });
  }
}
