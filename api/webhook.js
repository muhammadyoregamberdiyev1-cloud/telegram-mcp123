import { getConfig } from '../lib/config.js';
import { safeEqual } from '../lib/auth.js';
import { send, readJson } from '../lib/http.js';
import { inboxConfigured, pushUpdate } from '../lib/inbox.js';

/** Telegram → server. Register with the admin panel or telegram_set_webhook. */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  }
  const cfg = getConfig();
  if (cfg.webhookSecret) {
    const got = req.headers['x-telegram-bot-api-secret-token'] || '';
    if (!got || !safeEqual(got, cfg.webhookSecret)) return send(res, 401, { ok: false, error: 'Invalid secret token' });
  }

  let update;
  try {
    update = await readJson(req);
  } catch {
    return send(res, 400, { ok: false, error: 'Invalid JSON' });
  }
  if (!update || typeof update !== 'object') return send(res, 400, { ok: false, error: 'Invalid update' });

  // Always answer 200 once the update is authentic so Telegram doesn't retry-storm.
  const jobs = [];
  if (inboxConfigured()) jobs.push(pushUpdate(update).catch((e) => console.error('[inbox]', e.message)));
  if (cfg.forwardUrl) {
    jobs.push(
      fetch(cfg.forwardUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.webhookSecret && { 'X-Telegram-Bot-Api-Secret-Token': cfg.webhookSecret }) },
        body: JSON.stringify(update),
        signal: AbortSignal.timeout(8_000),
      }).catch((e) => console.error('[forward]', e.message))
    );
  }
  await Promise.all(jobs);
  return send(res, 200, { ok: true });
}
