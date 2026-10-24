import { getConfig, redact } from './config.js';

export class TelegramError extends Error {
  constructor(message, { code, parameters } = {}) {
    super(message);
    this.name = 'TelegramError';
    this.code = code;
    this.parameters = parameters;
  }
}

function hint(code, description = '') {
  const d = description.toLowerCase();
  if (code === 401) return 'BOT_TOKEN is invalid or revoked. Check it in Vercel env vars.';
  if (d.includes('chat not found'))
    return 'Check chat_id (groups/channels look like -100123…) or use @channelusername. The bot must be a member/admin of the chat, and users must have pressed Start.';
  if (code === 403) return 'The bot was blocked by the user, kicked from the chat, or lacks permission.';
  if (code === 409) return 'A webhook is active, so getUpdates is unavailable. Use the inbox tools, or call telegram_delete_webhook first.';
  if (d.includes("can't parse entities"))
    return 'Formatting error. Escape special characters for MarkdownV2/HTML, or omit parse_mode.';
  if (d.includes('not enough rights')) return 'Make the bot an admin with the required permission.';
  return '';
}

/**
 * Call a Telegram Bot API method.
 * files: { fieldName: { blob, filename } } switches the request to multipart/form-data.
 */
export async function callTelegram(method, params = {}, files) {
  const { botToken } = getConfig();
  if (!botToken) throw new TelegramError('BOT_TOKEN is not configured on the server.');

  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null));

  const buildInit = () => {
    if (files && Object.keys(files).length) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(clean)) {
        fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      for (const [k, f] of Object.entries(files)) fd.append(k, f.blob, f.filename);
      return { method: 'POST', body: fd };
    }
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clean),
    };
  };

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { ...buildInit(), signal: AbortSignal.timeout(25_000) });
    } catch (err) {
      const msg = err?.name === 'TimeoutError' ? 'Telegram API request timed out' : `Network error: ${err?.message}`;
      throw new TelegramError(redact(msg));
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw new TelegramError(`Telegram returned a non-JSON response (HTTP ${res.status})`, { code: res.status });
    }

    if (data.ok) return data.result;

    const retryAfter = data.parameters?.retry_after;
    if (data.error_code === 429 && retryAfter !== undefined && retryAfter <= 5 && attempt < 2) {
      await new Promise((r) => setTimeout(r, retryAfter * 1000 + 100));
      continue;
    }

    const h = hint(data.error_code, data.description);
    const msg = `Telegram error ${data.error_code}: ${data.description}${h ? ` — ${h}` : ''}${
      retryAfter ? ` (retry after ${retryAfter}s)` : ''
    }`;
    throw new TelegramError(redact(msg), { code: data.error_code, parameters: data.parameters });
  }
}
