import { getConfig } from './config.js';

const KEY = 'telegram-mcp:inbox';
const MAX_ITEMS = 500;
const TTL_SECONDS = 7 * 24 * 3600;

export function inboxConfigured() {
  const c = getConfig();
  return Boolean(c.upstashUrl && c.upstashToken);
}

async function pipeline(commands) {
  const { upstashUrl, upstashToken } = getConfig();
  const res = await fetch(`${upstashUrl}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${upstashToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Inbox storage error (HTTP ${res.status})`);
  return res.json();
}

export async function pushUpdate(update) {
  let s = JSON.stringify(update);
  if (s.length > 50_000) s = JSON.stringify({ update_id: update.update_id, truncated: true });
  await pipeline([
    ['LPUSH', KEY, s],
    ['LTRIM', KEY, 0, MAX_ITEMS - 1],
    ['EXPIRE', KEY, TTL_SECONDS],
  ]);
}

export async function readInbox({ limit = 20, chat_id, clear = false } = {}) {
  if (clear && chat_id !== undefined) throw new Error('clear cannot be combined with chat_id');
  const fetchCount = chat_id !== undefined ? MAX_ITEMS : limit;
  const out = await pipeline([['LRANGE', KEY, 0, fetchCount - 1]]);
  let items = (out[0]?.result || []).map((s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }).filter(Boolean);

  if (chat_id !== undefined) {
    const want = String(chat_id).toLowerCase();
    items = items.filter((u) => {
      const m = u.message || u.edited_message || u.channel_post || u.edited_channel_post || u.callback_query?.message;
      return m?.chat && (String(m.chat.id) === want || `@${m.chat.username || ''}`.toLowerCase() === want);
    });
  }
  items = items.slice(0, limit);
  if (clear) await pipeline([['DEL', KEY]]);
  return items;
}

export async function clearInbox() {
  await pipeline([['DEL', KEY]]);
  return true;
}
