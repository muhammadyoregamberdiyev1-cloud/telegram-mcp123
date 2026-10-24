import { getConfig, redact } from './config.js';
import { callTelegram } from './telegram.js';
import { inboxConfigured, readInbox, clearInbox } from './inbox.js';

/* ───────────────────────── schema helpers ───────────────────────── */
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });
const obj = (description) => ({ type: 'object', description });
const arr = (description, items = {}) => ({ type: 'array', description, items });

const CHAT = { type: ['integer', 'string'], description: 'Chat ID (e.g. 123456 or -1001234567890) or @channelusername' };
const PARSE = str('Text formatting mode', { enum: ['HTML', 'MarkdownV2', 'Markdown'] });
const MARKUP = obj('Inline keyboard / reply keyboard / remove keyboard object (Telegram reply_markup)');

const SEND = {
  chat_id: CHAT,
  message_thread_id: int('Forum topic ID (supergroups with topics)'),
  disable_notification: bool('Send silently'),
  protect_content: bool('Prevent forwarding and saving'),
  reply_to_message_id: int('Reply to this message ID'),
  reply_markup: MARKUP,
};
const CAPTION = { caption: str('Caption (up to 1024 chars)'), parse_mode: PARSE };
const FILE = {
  file_base64: str('Alternative to the file reference: raw file content as base64 (keep under ~3 MB)'),
  filename: str('Filename to use with file_base64, e.g. report.pdf'),
};
const FILE_REF = 'file_id of an existing file, or a public HTTP(S) URL';

/* ───────────────────────── tool registry ─────────────────────────
 * flags: ro = read only, destructive = hard to undo
 * media = name of the file field (enables file_base64 uploads)
 */
const DEFS = [];
function def(name, method, description, props, required = [], o = {}) {
  DEFS.push({ name: `telegram_${name}`, method, description, props, required, ...o });
}
const mediaDef = (name, method, field, description, extra = {}, req = []) =>
  def(name, method, description, { ...SEND, [field]: str(FILE_REF), ...FILE, ...extra }, ['chat_id', ...req], { media: field });

/* — account — */
def('get_me', 'getMe', 'Get basic information about the bot (id, username, capabilities).', {}, [], { ro: true, chatArgs: [] });

/* — sending — */
def('send_message', 'sendMessage', 'Send a text message to a user, group, supergroup or channel. Texts over 4096 chars are split automatically when no parse_mode is set.',
  { ...SEND, text: str('Message text'), parse_mode: PARSE, disable_link_preview: bool('Disable link previews'), entities: arr('Message entities', obj('MessageEntity')) },
  ['chat_id', 'text']);
mediaDef('send_photo', 'sendPhoto', 'photo', 'Send a photo.', { ...CAPTION, has_spoiler: bool('Cover with spoiler animation') });
mediaDef('send_video', 'sendVideo', 'video', 'Send a video.', { ...CAPTION, duration: int('Duration in seconds'), width: int('Width'), height: int('Height'), supports_streaming: bool('Streamable'), has_spoiler: bool('Spoiler') });
mediaDef('send_document', 'sendDocument', 'document', 'Send a file/document of any type.', { ...CAPTION, disable_content_type_detection: bool('Disable auto content-type detection') });
mediaDef('send_audio', 'sendAudio', 'audio', 'Send an audio file (shown in the music player).', { ...CAPTION, duration: int('Duration in seconds'), performer: str('Performer'), title: str('Track title') });
mediaDef('send_voice', 'sendVoice', 'voice', 'Send a voice message (OGG/OPUS, MP3 or M4A).', { ...CAPTION, duration: int('Duration in seconds') });
mediaDef('send_animation', 'sendAnimation', 'animation', 'Send a GIF or silent MP4 animation.', { ...CAPTION, duration: int('Duration'), width: int('Width'), height: int('Height') });
mediaDef('send_video_note', 'sendVideoNote', 'video_note', 'Send a round video message.', { duration: int('Duration'), length: int('Diameter') });
def('send_sticker', 'sendSticker', 'Send a sticker (file_id, URL to .webp/.tgs/.webm).', { ...SEND, sticker: str(FILE_REF), emoji: str('Emoji for uploaded stickers') }, ['chat_id', 'sticker']);
def('send_media_group', 'sendMediaGroup', 'Send an album of 2–10 photos/videos/documents/audios.',
  { chat_id: CHAT, message_thread_id: SEND.message_thread_id, disable_notification: SEND.disable_notification, protect_content: SEND.protect_content, reply_to_message_id: SEND.reply_to_message_id,
    media: arr('Array of {type: photo|video|document|audio, media: file_id or URL, caption?, parse_mode?}', { type: 'object', required: ['type', 'media'] }) },
  ['chat_id', 'media']);
def('send_location', 'sendLocation', 'Send a map location.', { ...SEND, latitude: num('Latitude'), longitude: num('Longitude'), live_period: int('Live location duration in seconds (60–86400)'), horizontal_accuracy: num('Accuracy in meters') }, ['chat_id', 'latitude', 'longitude']);
def('send_venue', 'sendVenue', 'Send information about a venue.', { ...SEND, latitude: num('Latitude'), longitude: num('Longitude'), title: str('Venue name'), address: str('Venue address') }, ['chat_id', 'latitude', 'longitude', 'title', 'address']);
def('send_contact', 'sendContact', 'Send a phone contact.', { ...SEND, phone_number: str('Phone number'), first_name: str('First name'), last_name: str('Last name') }, ['chat_id', 'phone_number', 'first_name']);
def('send_poll', 'sendPoll', 'Create a poll or quiz.',
  { ...SEND, question: str('Poll question (1–300 chars)'), options: arr('2–10 answer options (strings)', { type: 'string' }), is_anonymous: bool('Anonymous poll (default true)'), type: str('Poll type', { enum: ['regular', 'quiz'] }),
    allows_multiple_answers: bool('Allow multiple answers'), correct_option_id: int('0-based correct option (quiz)'), explanation: str('Quiz explanation'), open_period: int('Seconds the poll stays open (5–600)') },
  ['chat_id', 'question', 'options']);
def('send_dice', 'sendDice', 'Send an animated emoji with a random value.', { ...SEND, emoji: str('Emoji', { enum: ['🎲', '🎯', '🏀', '⚽', '🎳', '🎰'] }) }, ['chat_id']);
def('send_chat_action', 'sendChatAction', 'Show a status such as "typing…" in the chat (lasts ~5 s).',
  { chat_id: CHAT, message_thread_id: SEND.message_thread_id, action: str('Action', { enum: ['typing', 'upload_photo', 'record_video', 'upload_video', 'record_voice', 'upload_voice', 'upload_document', 'choose_sticker', 'find_location', 'record_video_note', 'upload_video_note'] }) },
  ['chat_id', 'action']);

/* — forwarding — */
const FWD = { chat_id: CHAT, from_chat_id: CHAT, disable_notification: SEND.disable_notification, protect_content: SEND.protect_content, message_thread_id: SEND.message_thread_id };
def('forward_message', 'forwardMessage', 'Forward a message (keeps the "forwarded from" header).', { ...FWD, message_id: int('Message ID in from_chat_id') }, ['chat_id', 'from_chat_id', 'message_id'], { chatArgs: ['chat_id', 'from_chat_id'] });
def('forward_messages', 'forwardMessages', 'Forward up to 100 messages at once.', { ...FWD, message_ids: arr('Message IDs', { type: 'integer' }) }, ['chat_id', 'from_chat_id', 'message_ids'], { chatArgs: ['chat_id', 'from_chat_id'] });
def('copy_message', 'copyMessage', 'Copy a message without the forward header.', { ...FWD, message_id: int('Message ID'), caption: str('New caption'), parse_mode: PARSE, reply_markup: MARKUP }, ['chat_id', 'from_chat_id', 'message_id'], { chatArgs: ['chat_id', 'from_chat_id'] });
def('copy_messages', 'copyMessages', 'Copy up to 100 messages without the forward header.', { ...FWD, message_ids: arr('Message IDs', { type: 'integer' }), remove_caption: bool('Remove captions') }, ['chat_id', 'from_chat_id', 'message_ids'], { chatArgs: ['chat_id', 'from_chat_id'] });

/* — editing / deleting — */
def('edit_message_text', 'editMessageText', 'Edit the text of a message sent by the bot.', { chat_id: CHAT, message_id: int('Message ID'), text: str('New text'), parse_mode: PARSE, disable_link_preview: bool('Disable link previews'), reply_markup: MARKUP }, ['chat_id', 'message_id', 'text']);
def('edit_message_caption', 'editMessageCaption', 'Edit the caption of a media message.', { chat_id: CHAT, message_id: int('Message ID'), caption: str('New caption'), parse_mode: PARSE, reply_markup: MARKUP }, ['chat_id', 'message_id']);
def('edit_message_reply_markup', 'editMessageReplyMarkup', 'Change or remove the inline keyboard of a message.', { chat_id: CHAT, message_id: int('Message ID'), reply_markup: MARKUP }, ['chat_id', 'message_id']);
def('stop_poll', 'stopPoll', 'Stop a poll and get the final results.', { chat_id: CHAT, message_id: int('Poll message ID') }, ['chat_id', 'message_id']);
def('delete_message', 'deleteMessage', 'Delete a message.', { chat_id: CHAT, message_id: int('Message ID') }, ['chat_id', 'message_id'], { destructive: true });
def('delete_messages', 'deleteMessages', 'Delete up to 100 messages at once.', { chat_id: CHAT, message_ids: arr('Message IDs', { type: 'integer' }) }, ['chat_id', 'message_ids'], { destructive: true });
def('set_message_reaction', 'setMessageReaction', 'Set an emoji reaction on a message (empty emoji clears).', { chat_id: CHAT, message_id: int('Message ID'), emoji: str('One reaction emoji, e.g. 👍 ❤ 🔥 🎉'), is_big: bool('Big animation') }, ['chat_id', 'message_id']);
def('answer_callback_query', 'answerCallbackQuery', 'Answer a callback query from an inline keyboard button.', { callback_query_id: str('Callback query ID'), text: str('Notification text'), show_alert: bool('Show as alert'), url: str('URL to open'), cache_time: int('Cache seconds') }, ['callback_query_id'], { chatArgs: [] });

/* — pins — */
def('pin_chat_message', 'pinChatMessage', 'Pin a message in a chat.', { chat_id: CHAT, message_id: int('Message ID'), disable_notification: bool('Pin silently') }, ['chat_id', 'message_id']);
def('unpin_chat_message', 'unpinChatMessage', 'Unpin a message (the latest one if message_id is omitted).', { chat_id: CHAT, message_id: int('Message ID') }, ['chat_id']);
def('unpin_all_chat_messages', 'unpinAllChatMessages', 'Unpin all messages in a chat.', { chat_id: CHAT }, ['chat_id'], { destructive: true });

/* — reading / info — */
def('get_updates', 'getUpdates', 'Fetch pending updates (incoming messages) via long polling. Does not work while a webhook is set; use telegram_inbox_read then.', { offset: int('First update_id to return; use last_update_id+1 to acknowledge'), limit: int('1–100', { minimum: 1, maximum: 100 }), timeout: int('Long-poll seconds (0–10)', { minimum: 0, maximum: 10 }), allowed_updates: arr('Update types', { type: 'string' }) }, [], { ro: true, chatArgs: [] });
def('get_chat', 'getChat', 'Get up-to-date information about a chat.', { chat_id: CHAT }, ['chat_id'], { ro: true });
def('get_chat_administrators', 'getChatAdministrators', 'List administrators of a group or channel.', { chat_id: CHAT }, ['chat_id'], { ro: true });
def('get_chat_member_count', 'getChatMemberCount', 'Get the number of members in a chat.', { chat_id: CHAT }, ['chat_id'], { ro: true });
def('get_chat_member', 'getChatMember', 'Get information about one chat member.', { chat_id: CHAT, user_id: int('User ID') }, ['chat_id', 'user_id'], { ro: true });
def('get_file', 'getFile', 'Get file metadata (file_path, size) for a file_id.', { file_id: str('file_id') }, ['file_id'], { ro: true, chatArgs: [] });
def('get_user_profile_photos', 'getUserProfilePhotos', 'Get a user\'s profile pictures.', { user_id: int('User ID'), offset: int('Offset'), limit: int('1–100') }, ['user_id'], { ro: true, chatArgs: [] });

/* — bot commands — */
def('set_my_commands', 'setMyCommands', 'Set the bot command menu.', { commands: arr('Array of {command, description}', { type: 'object', required: ['command', 'description'] }), scope: obj('BotCommandScope'), language_code: str('Two-letter ISO 639-1 code') }, ['commands'], { chatArgs: [] });
def('get_my_commands', 'getMyCommands', 'Get the current bot command list.', { scope: obj('BotCommandScope'), language_code: str('Language code') }, [], { ro: true, chatArgs: [] });
def('delete_my_commands', 'deleteMyCommands', 'Delete the bot command list.', { scope: obj('BotCommandScope'), language_code: str('Language code') }, [], { destructive: true, chatArgs: [] });

/* — webhook — */
def('set_webhook', 'setWebhook', 'Point Telegram updates to an HTTPS URL. Changing this redirects all incoming messages.', { url: str('HTTPS URL'), secret_token: str('Secret sent in X-Telegram-Bot-Api-Secret-Token'), max_connections: int('1–100'), allowed_updates: arr('Update types', { type: 'string' }), drop_pending_updates: bool('Drop pending updates') }, ['url'], { destructive: true, chatArgs: [] });
def('delete_webhook', 'deleteWebhook', 'Remove the webhook (enables getUpdates).', { drop_pending_updates: bool('Drop pending updates') }, [], { destructive: true, chatArgs: [] });
def('get_webhook_info', 'getWebhookInfo', 'Get current webhook status and last error.', {}, [], { ro: true, chatArgs: [] });

/* — moderation / chat management — */
def('ban_chat_member', 'banChatMember', 'Ban a user from a group/supergroup/channel.', { chat_id: CHAT, user_id: int('User ID'), until_date: int('Unix time when the ban ends (0 = forever)'), revoke_messages: bool('Delete all messages from this user') }, ['chat_id', 'user_id'], { destructive: true });
def('unban_chat_member', 'unbanChatMember', 'Unban a previously banned user.', { chat_id: CHAT, user_id: int('User ID'), only_if_banned: bool('Do nothing if the user is not banned') }, ['chat_id', 'user_id']);
def('restrict_chat_member', 'restrictChatMember', 'Restrict what a user can do in a supergroup.', { chat_id: CHAT, user_id: int('User ID'), permissions: obj('ChatPermissions object, e.g. {"can_send_messages": false}'), until_date: int('Unix time when restrictions end') }, ['chat_id', 'user_id', 'permissions'], { destructive: true });
def('promote_chat_member', 'promoteChatMember', 'Promote or demote an administrator.', { chat_id: CHAT, user_id: int('User ID'), is_anonymous: bool('Anonymous admin'), can_manage_chat: bool('Manage chat'), can_change_info: bool('Change info'), can_post_messages: bool('Post (channels)'), can_edit_messages: bool('Edit messages (channels)'), can_delete_messages: bool('Delete messages'), can_invite_users: bool('Invite users'), can_restrict_members: bool('Restrict members'), can_pin_messages: bool('Pin messages'), can_manage_topics: bool('Manage topics'), can_promote_members: bool('Add admins'), can_manage_video_chats: bool('Manage video chats') }, ['chat_id', 'user_id'], { destructive: true });
def('set_chat_permissions', 'setChatPermissions', 'Set default permissions for all members.', { chat_id: CHAT, permissions: obj('ChatPermissions object') }, ['chat_id', 'permissions'], { destructive: true });
def('set_chat_title', 'setChatTitle', 'Change the chat title.', { chat_id: CHAT, title: str('New title (1–128 chars)') }, ['chat_id', 'title']);
def('set_chat_description', 'setChatDescription', 'Change the chat description.', { chat_id: CHAT, description: str('New description (0–255 chars)') }, ['chat_id']);
def('leave_chat', 'leaveChat', 'Make the bot leave a group, supergroup or channel.', { chat_id: CHAT }, ['chat_id'], { destructive: true });
def('export_chat_invite_link', 'exportChatInviteLink', 'Generate a new primary invite link (revokes the previous one).', { chat_id: CHAT }, ['chat_id'], { destructive: true });
def('create_chat_invite_link', 'createChatInviteLink', 'Create an additional invite link.', { chat_id: CHAT, name: str('Link name'), expire_date: int('Unix expiry time'), member_limit: int('Max users (1–99999)'), creates_join_request: bool('Require admin approval') }, ['chat_id']);
def('approve_chat_join_request', 'approveChatJoinRequest', 'Approve a join request.', { chat_id: CHAT, user_id: int('User ID') }, ['chat_id', 'user_id']);
def('decline_chat_join_request', 'declineChatJoinRequest', 'Decline a join request.', { chat_id: CHAT, user_id: int('User ID') }, ['chat_id', 'user_id']);
def('create_forum_topic', 'createForumTopic', 'Create a topic in a forum supergroup.', { chat_id: CHAT, name: str('Topic name (1–128)'), icon_color: int('RGB color of the icon') }, ['chat_id', 'name']);
def('close_forum_topic', 'closeForumTopic', 'Close a forum topic.', { chat_id: CHAT, message_thread_id: int('Topic ID') }, ['chat_id', 'message_thread_id']);

/* ───────────────────────── schemas / public listing ───────────────────────── */
function schemaOf(d) {
  return { type: 'object', properties: d.props, required: d.required, additionalProperties: false };
}
function annotationsOf(d) {
  return {
    title: d.name.replace(/^telegram_/, '').replace(/_/g, ' '),
    readOnlyHint: Boolean(d.ro),
    destructiveHint: Boolean(d.destructive),
    idempotentHint: Boolean(d.ro),
    openWorldHint: true,
  };
}

const INBOX_DEFS = [
  {
    name: 'telegram_inbox_read',
    description: 'Read recently received Telegram updates (newest first) stored by the webhook. Requires webhook + Upstash Redis.',
    props: { limit: int('Max updates (1–100, default 20)', { minimum: 1, maximum: 100 }), chat_id: CHAT, clear: bool('Delete the whole inbox after reading') },
    required: [], ro: true, inbox: 'read', chatArgs: [],
  },
  {
    name: 'telegram_inbox_clear',
    description: 'Delete all stored incoming updates.',
    props: {}, required: [], destructive: true, inbox: 'clear', chatArgs: [],
  },
];

function activeDefs() {
  const cfg = getConfig();
  const disabled = new Set(cfg.disabledTools);
  const all = inboxConfigured() ? [...DEFS, ...INBOX_DEFS] : DEFS;
  return all.filter((d) => !disabled.has(d.name));
}

export function listTools() {
  const cfg = getConfig();
  return activeDefs()
    .filter((d) => !(cfg.readOnly && !d.ro))
    .map((d) => ({ name: d.name, title: annotationsOf(d).title, description: d.description, inputSchema: schemaOf(d), annotations: annotationsOf(d) }));
}

export function toolSummaries() {
  return listTools().map((t) => ({ name: t.name, description: t.description, readOnly: t.annotations.readOnlyHint, destructive: t.annotations.destructiveHint }));
}

/* ───────────────────────── validation ───────────────────────── */
export class ToolError extends Error {}

const typeOk = (t, v) =>
  t === 'string' ? typeof v === 'string'
  : t === 'integer' ? Number.isInteger(v)
  : t === 'number' ? typeof v === 'number' && Number.isFinite(v)
  : t === 'boolean' ? typeof v === 'boolean'
  : t === 'array' ? Array.isArray(v)
  : t === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v)
  : true;

export function validate(d, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new ToolError('Arguments must be an object.');
  const allowed = Object.keys(d.props);
  for (const k of Object.keys(args)) {
    if (!allowed.includes(k)) throw new ToolError(`Unknown argument "${k}". Allowed: ${allowed.join(', ') || '(none)'}.`);
  }
  const skipRequired = d.media && args.file_base64 ? d.media : null;
  for (const r of d.required) {
    if (r === skipRequired) continue;
    if (args[r] === undefined || args[r] === null) throw new ToolError(`Missing required argument "${r}".`);
  }
  if (d.media && args[d.media] === undefined && !args.file_base64) {
    throw new ToolError(`Provide "${d.media}" (file_id or URL) or "file_base64".`);
  }
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null) continue;
    const s = d.props[k];
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => typeOk(t, v))) throw new ToolError(`Argument "${k}" must be of type ${types.join(' or ')}.`);
    if (s.enum && !s.enum.includes(v)) throw new ToolError(`Argument "${k}" must be one of: ${s.enum.join(', ')}.`);
    if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) throw new ToolError(`Argument "${k}" must be ≥ ${s.minimum}.`);
    if (typeof v === 'number' && s.maximum !== undefined && v > s.maximum) throw new ToolError(`Argument "${k}" must be ≤ ${s.maximum}.`);
    if (Array.isArray(v) && s.items?.type && !v.every((x) => typeOk(s.items.type, x))) throw new ToolError(`Every item of "${k}" must be of type ${s.items.type}.`);
  }
}

/* ───────────────────────── safety guards ───────────────────────── */
function checkChatAllowed(d, args) {
  const { allowedChatIds } = getConfig();
  if (!allowedChatIds.length) return;
  for (const key of d.chatArgs ?? ['chat_id']) {
    if (args[key] === undefined) continue;
    if (!allowedChatIds.includes(String(args[key]).toLowerCase())) {
      throw new ToolError(`Chat ${args[key]} is not in the server's ALLOWED_CHAT_IDS list.`);
    }
  }
}

/* ───────────────────────── request shaping ───────────────────────── */
function shape(d, a) {
  const args = { ...a };
  if (args.reply_to_message_id !== undefined) {
    args.reply_parameters = { message_id: args.reply_to_message_id, allow_sending_without_reply: true };
    delete args.reply_to_message_id;
  }
  if (args.disable_link_preview !== undefined) {
    args.link_preview_options = { is_disabled: args.disable_link_preview };
    delete args.disable_link_preview;
  }
  if (d.method === 'sendPoll') args.options = args.options.map((text) => ({ text }));
  if (d.method === 'setMessageReaction') {
    args.reaction = args.emoji ? [{ type: 'emoji', emoji: args.emoji }] : [];
    delete args.emoji;
  }
  return args;
}

function splitText(text, max = 4096) {
  if (text.length <= max) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest) parts.push(rest);
  return parts;
}

/* ───────────────────────── execution ───────────────────────── */
export async function executeTool(name, rawArgs = {}) {
  const cfg = getConfig();
  const d = activeDefs().find((x) => x.name === name);
  if (!d) return { found: false };
  if (cfg.readOnly && !d.ro) throw new ToolError('Server is in READ_ONLY mode; this tool is disabled.');

  validate(d, rawArgs);
  if (cfg.readOnly && rawArgs.clear) throw new ToolError('Server is in READ_ONLY mode; clear is disabled.');
  checkChatAllowed(d, rawArgs);

  if (d.inbox === 'read') return { found: true, result: await readInbox({ limit: rawArgs.limit ?? 20, chat_id: rawArgs.chat_id, clear: rawArgs.clear }) };
  if (d.inbox === 'clear') return { found: true, result: { cleared: await clearInbox() } };

  let args = shape(d, rawArgs);
  let files;
  if (d.media && args.file_base64) {
    const buf = Buffer.from(args.file_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buf.length) throw new ToolError('file_base64 is empty or invalid.');
    if (buf.length > 3_300_000) throw new ToolError('file_base64 is too large for a serverless request (limit ≈ 3 MB). Use a public URL instead.');
    files = { [d.media]: { blob: new Blob([buf]), filename: args.filename || `${d.media}.bin` } };
    delete args[d.media];
  }
  delete args.file_base64;
  delete args.filename;

  if (d.method === 'sendMessage' && !args.parse_mode && !args.entities && args.text.length > 4096) {
    const out = [];
    for (const [i, part] of splitText(args.text).entries()) {
      out.push(await callTelegram('sendMessage', { ...args, text: part, reply_markup: i === 0 ? args.reply_markup : undefined }));
    }
    return { found: true, result: out };
  }

  return { found: true, result: await callTelegram(d.method, args, files) };
}

export const safeMessage = (e) => redact(e?.message || String(e));
export const TOOL_COUNT = DEFS.length;
