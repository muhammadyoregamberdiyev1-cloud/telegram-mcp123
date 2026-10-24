export const NAME = 'telegram-mcp';
export const VERSION = '3.0.0';

const list = (v) =>
  (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Env is read on every call so it stays testable and picks up Vercel changes. */
export function getConfig() {
  const e = process.env;
  return {
    botToken: e.BOT_TOKEN || '',
    authToken: e.MCP_AUTH_TOKEN || '',
    allowNoAuth: e.ALLOW_NO_AUTH === 'true',
    webhookSecret: e.WEBHOOK_SECRET || '',
    allowedChatIds: list(e.ALLOWED_CHAT_IDS).map((s) => s.toLowerCase()),
    disabledTools: list(e.DISABLED_TOOLS),
    readOnly: e.READ_ONLY === 'true',
    forwardUrl: e.WEBHOOK_FORWARD_URL || '',
    upstashUrl: (e.UPSTASH_REDIS_REST_URL || e.KV_REST_API_URL || '').replace(/\/$/, ''),
    upstashToken: e.UPSTASH_REDIS_REST_TOKEN || e.KV_REST_API_TOKEN || '',
  };
}

/** Replace the bot token in any string so it never leaks to clients or logs. */
export function redact(text) {
  const { botToken } = getConfig();
  let out = String(text ?? '');
  if (botToken) out = out.split(botToken).join('***');
  return out.replace(/bot\d{6,}:[A-Za-z0-9_-]{20,}/g, 'bot***');
}
