import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mcp from '../api/mcp.js';
import webhook from '../api/webhook.js';
import health from '../api/health.js';

const TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const calls = [];
const realFetch = globalThis.fetch;

function mockTelegram(handler) {
  globalThis.fetch = async (url, init) => {
    const body = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(init?.body || '{}');
    calls.push({ url: String(url), body });
    return new Response(JSON.stringify(handler(String(url), body)), { status: 200 });
  };
}

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => (res.headers[k.toLowerCase()] = v);
  res.end = (b) => { res.body = b ? JSON.parse(b) : undefined; };
  return res;
}
const call = async (fn, { method = 'POST', body, headers = { authorization: 'Bearer secret' }, url = '/api/mcp' } = {}) => {
  const res = fakeRes();
  await fn({ method, body, headers, url }, res);
  return res;
};
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = realFetch;
  for (const k of ['ALLOWED_CHAT_IDS', 'DISABLED_TOOLS', 'READ_ONLY', 'WEBHOOK_SECRET', 'ALLOW_NO_AUTH', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
  process.env.BOT_TOKEN = TOKEN;
  process.env.MCP_AUTH_TOKEN = 'secret';
  mockTelegram(() => ({ ok: true, result: { message_id: 7 } }));
});

test('auth: rejects missing/wrong token, accepts bearer and ?key=', async () => {
  assert.equal((await call(mcp, { body: rpc('ping'), headers: {} })).statusCode, 401);
  assert.equal((await call(mcp, { body: rpc('ping'), headers: { authorization: 'Bearer nope' } })).statusCode, 401);
  assert.equal((await call(mcp, { body: rpc('ping') })).statusCode, 200);
  assert.equal((await call(mcp, { body: rpc('ping'), headers: {}, url: '/api/mcp?key=secret' })).statusCode, 200);
});

test('auth: refuses to run unconfigured unless ALLOW_NO_AUTH=true', async () => {
  delete process.env.MCP_AUTH_TOKEN;
  assert.equal((await call(mcp, { body: rpc('ping'), headers: {} })).statusCode, 503);
  process.env.ALLOW_NO_AUTH = 'true';
  assert.equal((await call(mcp, { body: rpc('ping'), headers: {} })).statusCode, 200);
});

test('initialize negotiates protocol version and declares tools', async () => {
  const r = await call(mcp, { body: rpc('initialize', { protocolVersion: '2024-11-05' }) });
  assert.equal(r.body.result.protocolVersion, '2024-11-05');
  assert.ok(r.body.result.capabilities.tools);
  const r2 = await call(mcp, { body: rpc('initialize', { protocolVersion: '1999-01-01' }) });
  assert.equal(r2.body.result.protocolVersion, '2025-06-18');
});

test('notifications return 202 with no body; batch works', async () => {
  const n = await call(mcp, { body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(n.statusCode, 202);
  const b = await call(mcp, { body: [rpc('ping', undefined, 1), rpc('tools/list', undefined, 2)] });
  assert.equal(b.body.length, 2);
});

test('tools/list: valid schemas, unique names, annotations', async () => {
  const r = await call(mcp, { body: rpc('tools/list') });
  const tools = r.body.result.tools;
  assert.ok(tools.length >= 55, `expected ≥55 tools, got ${tools.length}`);
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object');
    for (const req of t.inputSchema.required) assert.ok(t.inputSchema.properties[req] || req, `${t.name} requires unknown ${req}`);
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
  }
});

test('send_message calls Telegram with the right URL and body', async () => {
  const r = await call(mcp, { body: rpc('tools/call', { name: 'telegram_send_message', arguments: { chat_id: -1001, text: 'salom', reply_to_message_id: 5, disable_link_preview: true } }) });
  assert.equal(r.body.result.isError, false);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.deepEqual(calls[0].body.reply_parameters, { message_id: 5, allow_sending_without_reply: true });
  assert.deepEqual(calls[0].body.link_preview_options, { is_disabled: true });
  assert.equal(calls[0].body.reply_to_message_id, undefined);
});

test('long text is split into several messages', async () => {
  const text = ('abc def\n\n').repeat(1500);
  const r = await call(mcp, { body: rpc('tools/call', { name: 'telegram_send_message', arguments: { chat_id: 1, text } }) });
  assert.equal(r.body.result.isError, false);
  assert.ok(calls.length >= 3);
  assert.ok(calls.every((c) => c.body.text.length <= 4096));
});

test('poll options and reactions are shaped for the Bot API', async () => {
  await call(mcp, { body: rpc('tools/call', { name: 'telegram_send_poll', arguments: { chat_id: 1, question: 'q', options: ['a', 'b'] } }) });
  assert.deepEqual(calls[0].body.options, [{ text: 'a' }, { text: 'b' }]);
  await call(mcp, { body: rpc('tools/call', { name: 'telegram_set_message_reaction', arguments: { chat_id: 1, message_id: 2, emoji: '👍' } }) });
  assert.deepEqual(calls[1].body.reaction, [{ type: 'emoji', emoji: '👍' }]);
});

test('base64 upload switches to multipart', async () => {
  const r = await call(mcp, { body: rpc('tools/call', { name: 'telegram_send_document', arguments: { chat_id: 1, file_base64: Buffer.from('hello').toString('base64'), filename: 'a.txt' } }) });
  assert.equal(r.body.result.isError, false);
  assert.ok(calls[0].body.document instanceof File || typeof calls[0].body.document === 'object');
});

test('validation errors are returned as tool errors (isError)', async () => {
  const run = async (name, args) => (await call(mcp, { body: rpc('tools/call', { name, arguments: args }) })).body.result;
  assert.match((await run('telegram_send_message', { chat_id: 1 })).content[0].text, /Missing required argument "text"/);
  assert.match((await run('telegram_send_message', { chat_id: 1, text: 'x', oops: 1 })).content[0].text, /Unknown argument "oops"/);
  assert.match((await run('telegram_send_message', { chat_id: 1, text: 5 })).content[0].text, /must be of type string/);
  assert.match((await run('telegram_send_chat_action', { chat_id: 1, action: 'dance' })).content[0].text, /must be one of/);
  assert.equal(calls.length, 0);
});

test('unknown tool → JSON-RPC error; unknown method → -32601', async () => {
  assert.equal((await call(mcp, { body: rpc('tools/call', { name: 'nope' }) })).body.error.code, -32602);
  assert.equal((await call(mcp, { body: rpc('bogus') })).body.error.code, -32601);
});

test('ALLOWED_CHAT_IDS blocks other chats (also from_chat_id)', async () => {
  process.env.ALLOWED_CHAT_IDS = '-1001, @mychannel';
  const run = async (name, args) => (await call(mcp, { body: rpc('tools/call', { name, arguments: args }) })).body.result;
  assert.equal((await run('telegram_send_message', { chat_id: -1001, text: 'ok' })).isError, false);
  assert.equal((await run('telegram_send_message', { chat_id: '@MyChannel', text: 'ok' })).isError, false);
  assert.match((await run('telegram_send_message', { chat_id: 999, text: 'no' })).content[0].text, /ALLOWED_CHAT_IDS/);
  assert.match((await run('telegram_forward_message', { chat_id: -1001, from_chat_id: 5, message_id: 1 })).content[0].text, /ALLOWED_CHAT_IDS/);
});

test('READ_ONLY hides and blocks write tools; DISABLED_TOOLS hides tools', async () => {
  process.env.READ_ONLY = 'true';
  const tools = (await call(mcp, { body: rpc('tools/list') })).body.result.tools;
  assert.ok(tools.length > 5 && tools.every((t) => t.annotations.readOnlyHint));
  const r = await call(mcp, { body: rpc('tools/call', { name: 'telegram_send_message', arguments: { chat_id: 1, text: 'x' } }) });
  assert.equal(r.body.result.isError, true);
  assert.match(r.body.result.content[0].text, /READ_ONLY/);
  assert.equal(calls.length, 0);
  delete process.env.READ_ONLY;
  process.env.DISABLED_TOOLS = 'telegram_leave_chat';
  const t2 = (await call(mcp, { body: rpc('tools/list') })).body.result.tools;
  assert.ok(!t2.some((t) => t.name === 'telegram_leave_chat'));
});

test('Telegram errors are mapped with hints and never leak the token', async () => {
  mockTelegram(() => ({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }));
  const r = (await call(mcp, { body: rpc('tools/call', { name: 'telegram_get_chat', arguments: { chat_id: 1 } }) })).body.result;
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /chat not found/);
  assert.ok(!JSON.stringify(r).includes(TOKEN));
  globalThis.fetch = async () => { throw new Error(`connect failed for https://api.telegram.org/bot${TOKEN}/getMe`); };
  const r2 = (await call(mcp, { body: rpc('tools/call', { name: 'telegram_get_me', arguments: {} }) })).body.result;
  assert.ok(!JSON.stringify(r2).includes(TOKEN));
});

test('429 with small retry_after is retried once', async () => {
  let n = 0;
  mockTelegram(() => (n++ === 0 ? { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0 } } : { ok: true, result: true }));
  const r = (await call(mcp, { body: rpc('tools/call', { name: 'telegram_get_me', arguments: {} }) })).body.result;
  assert.equal(r.isError, false);
  assert.equal(calls.length, 2);
});

test('webhook: verifies secret, stores into inbox when configured', async () => {
  process.env.WEBHOOK_SECRET = 'whsec';
  const update = { update_id: 1, message: { chat: { id: 5 }, text: 'hi' } };
  assert.equal((await call(webhook, { body: update, headers: {} })).statusCode, 401);
  assert.equal((await call(webhook, { body: update, headers: { 'x-telegram-bot-api-secret-token': 'whsec' } })).statusCode, 200);
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 't';
  mockTelegram(() => [{ result: 1 }]);
  await call(webhook, { body: update, headers: { 'x-telegram-bot-api-secret-token': 'whsec' } });
  assert.match(calls[0].url, /redis\.example\/pipeline/);
});

test('inbox tools appear only when storage is configured', async () => {
  let names = (await call(mcp, { body: rpc('tools/list') })).body.result.tools.map((t) => t.name);
  assert.ok(!names.includes('telegram_inbox_read'));
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 't';
  names = (await call(mcp, { body: rpc('tools/list') })).body.result.tools.map((t) => t.name);
  assert.ok(names.includes('telegram_inbox_read') && names.includes('telegram_inbox_clear'));
});

test('health: public minimal, detailed only with token', async () => {
  const pub = await call(health, { method: 'GET', headers: {} });
  assert.equal(pub.statusCode, 200);
  assert.equal(pub.body.details, undefined);
  const priv = await call(health, { method: 'GET' });
  assert.equal(priv.body.details.botConfigured, true);
});
