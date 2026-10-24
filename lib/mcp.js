import { NAME, VERSION } from './config.js';
import { listTools, executeTool, ToolError, safeMessage } from './tools.js';

export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS =
  'Telegram Bot API tools. Use chat_id as a number (-100… for channels/supergroups) or @channelusername. ' +
  'The bot must be a member/admin of the target chat. Prefer telegram_send_message for text; ' +
  'telegram_get_updates or telegram_inbox_read to read incoming messages. Destructive tools (ban, delete, leave, webhook changes) should be used only on explicit user request.';

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Handle one JSON-RPC message. Returns a response object, or null for notifications. */
export async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return fail(msg?.id, -32600, 'Invalid Request');
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined;

  if (method.startsWith('notifications/')) return null;

  try {
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion;
        const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
        return ok(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: NAME, title: 'Telegram MCP', version: VERSION },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, { tools: listTools() });
      case 'tools/call': {
        const name = params?.name;
        if (typeof name !== 'string') return fail(id, -32602, 'Missing tool name');
        try {
          const out = await executeTool(name, params?.arguments ?? {});
          if (!out.found) return fail(id, -32602, `Unknown tool: ${name}`);
          return ok(id, { content: [{ type: 'text', text: JSON.stringify(out.result, null, 2) }], isError: false });
        } catch (e) {
          if (!(e instanceof ToolError)) console.error('[tool-error]', name, safeMessage(e));
          return ok(id, { content: [{ type: 'text', text: safeMessage(e) }], isError: true });
        }
      }
      case 'resources/list':
        return ok(id, { resources: [] });
      case 'resources/templates/list':
        return ok(id, { resourceTemplates: [] });
      case 'prompts/list':
        return ok(id, { prompts: [] });
      default:
        return isNotification ? null : fail(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return fail(id, -32603, safeMessage(e));
  }
}

/** Handle a single message or a JSON-RPC batch. Returns { status, body }. */
export async function handlePayload(payload) {
  if (Array.isArray(payload)) {
    if (!payload.length) return { status: 400, body: fail(null, -32600, 'Invalid Request') };
    const results = (await Promise.all(payload.map(handleMessage))).filter(Boolean);
    return results.length ? { status: 200, body: results } : { status: 202 };
  }
  const r = await handleMessage(payload);
  return r ? { status: 200, body: r } : { status: 202 };
}
