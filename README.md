# ✈️ Telegram MCP — Vercel uchun

AI klientlar (Claude, Cursor, Windsurf, VS Code va boshqalar) uchun **to'liq Telegram Bot API MCP serveri**.
Vercel serverless'ga moslangan, **nol dependency**, 59 ta tool, admin panel, webhook va ixtiyoriy kiruvchi xabarlar qutisi (inbox).

## Imkoniyatlar

- **59 ta tool**: matn, rasm, video, hujjat, audio, voice, animatsiya, sticker, albom, lokatsiya, venue, kontakt, poll/quiz, dice, chat action, forward/copy, tahrirlash/o'chirish, reaksiya, pin, chat/a'zo ma'lumotlari, ban/restrict/promote, invite link, forum topic, bot buyruqlari, webhook.
- **To'g'ri MCP protokoli**: Streamable HTTP (stateless), JSON-RPC 2.0, batch, protokol versiyasini kelishish, tool annotations (`readOnlyHint`, `destructiveHint`).
- **Xavfsizlik**: majburiy `MCP_AUTH_TOKEN` (timing-safe), webhook secret tekshiruvi, `ALLOWED_CHAT_IDS` ro'yxati, `READ_ONLY` rejimi, `DISABLED_TOOLS`, bot tokeni xatolar/loglarda yashiriladi.
- **Aqlli xatolar**: Telegram xatolari tushunarli maslahat bilan qaytariladi (masalan "chat not found"), 429 uchun avtomatik qayta urinish.
- **Qulayliklar**: 4096 belgidan uzun matn avtomatik bo'linadi, `file_base64` bilan fayl yuklash, `reply_to_message_id`, `disable_link_preview`.
- **Inbox** (ixtiyoriy, Upstash Redis): webhook orqali kelgan xabarlarni AI `telegram_inbox_read` bilan o'qiydi.
- **Admin panel** (`/`): holat, ulash ko'rsatmalari, toollar ro'yxati, webhook boshqaruvi, test xabar.

## Tez boshlash

### 1. Bot yaratish
[@BotFather](https://t.me/BotFather) → `/newbot` → tokenni oling.

### 2. Maxfiy kalitlar yaratish
```bash
openssl rand -hex 32   # MCP_AUTH_TOKEN uchun
openssl rand -hex 16   # WEBHOOK_SECRET uchun
```

### 3. Vercel'ga deploy
```bash
npm i -g vercel
vercel login
vercel link
vercel env add BOT_TOKEN production
vercel env add MCP_AUTH_TOKEN production
vercel env add WEBHOOK_SECRET production
vercel env add ALLOWED_CHAT_IDS production   # tavsiya etiladi
vercel --prod
```
Yoki GitHub'ga push qilib, Vercel dashboard'da import qiling va Environment Variables'ni kiriting.

> `.env` faylini hech qachon GitHub'ga yuklamang. `.gitignore` buni allaqachon bloklaydi.

### 4. Tekshirish
```bash
curl https://LOYIHA.vercel.app/api/health
curl -X POST https://LOYIHA.vercel.app/api/mcp \
  -H "Authorization: Bearer MCP_AUTH_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### 5. AI klientga ulash
**Claude Code**
```bash
claude mcp add --transport http telegram https://LOYIHA.vercel.app/api/mcp \
  --header "Authorization: Bearer MCP_AUTH_TOKEN"
```
**Cursor / Windsurf / VS Code (`mcp.json`)**
```json
{ "mcpServers": { "telegram": { "url": "https://LOYIHA.vercel.app/api/mcp", "headers": { "Authorization": "Bearer MCP_AUTH_TOKEN" } } } }
```
**Claude Desktop** (`mcp-remote` orqali)
```json
{ "mcpServers": { "telegram": { "command": "npx", "args": ["-y", "mcp-remote", "https://LOYIHA.vercel.app/api/mcp", "--header", "Authorization: Bearer MCP_AUTH_TOKEN"] } } }
```
**Claude.ai (Custom connector)** — sarlavha qo'yib bo'lmasa: `https://LOYIHA.vercel.app/api/mcp?key=MCP_AUTH_TOKEN` (URL sir hisoblanadi!).

## Kiruvchi xabarlar (webhook + inbox)

Serverless'da xotira saqlanmaydi, shuning uchun kiruvchi xabarlar uchun ikki yo'l bor:

1. **Polling** — `telegram_get_updates` (webhook o'rnatilmagan bo'lsa).
2. **Webhook + Inbox** — Vercel Marketplace'dan **Upstash Redis** qo'shing (env: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`), keyin admin paneldan **Webhook o'rnatish**. AI `telegram_inbox_read` bilan o'qiydi (so'nggi 500 ta, 7 kun saqlanadi).

Webhook'ni boshqa servisga ham yo'naltirish uchun `WEBHOOK_FORWARD_URL` ni kiriting.

## Muhit o'zgaruvchilari

| Nomi | Majburiy | Tavsif |
|---|---|---|
| `BOT_TOKEN` | ✅ | BotFather tokeni |
| `MCP_AUTH_TOKEN` | ✅ | Endpoint himoyasi. Yo'q bo'lsa server 503 qaytaradi |
| `WEBHOOK_SECRET` | tavsiya | Telegram webhook imzosi |
| `ALLOWED_CHAT_IDS` | tavsiya | Yuborish mumkin bo'lgan chatlar: `-100123,@kanal,456` |
| `READ_ONLY` | yo'q | `true` → faqat o'qish toollari |
| `DISABLED_TOOLS` | yo'q | O'chiriladigan toollar ro'yxati |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | yo'q | Inbox uchun |
| `WEBHOOK_FORWARD_URL` | yo'q | Update'larni qayta yo'naltirish |
| `ALLOW_NO_AUTH` | yo'q | Faqat lokal sinov. Productionda `false` |

## Tuzilma

```
api/mcp.js       MCP endpoint (POST /api/mcp, alias /mcp)
api/webhook.js   Telegram webhook qabul qiluvchi
api/health.js    Holat (ochiq: minimal, token bilan: batafsil)
api/admin.js     Admin panel backend (token talab qiladi)
lib/             config, auth, telegram klient, tool'lar, MCP protokol, inbox
public/          Admin panel (statik)
test/            node:test testlari  →  npm test
```

## Lokal ishga tushirish
```bash
cp .env.example .env     # qiymatlarni to'ldiring
npx vercel dev           # http://localhost:3000
npm test
```

## Xavfsizlik bo'yicha maslahatlar
- Botni faqat kerakli chatlarga qo'shing va `ALLOWED_CHAT_IDS` ni belgilang.
- Faqat o'qish kerak bo'lsa `READ_ONLY=true` qo'ying.
- `ban`, `delete`, `leave_chat`, `set_webhook` kabi toollar `destructiveHint` bilan belgilangan — klientingizda ularni qo'lda tasdiqlashni yoqing.
- Token sizib chiqsa: BotFather → `/revoke`, so'ng Vercel env'ni yangilab qayta deploy qiling.

## Cheklovlar
- Vercel so'rov hajmi ~4.5 MB: katta fayllarni `file_base64` bilan emas, ommaviy URL yoki `file_id` bilan yuboring.
- Server stateless: SSE oqimi yo'q (`GET /api/mcp` → 405), bu zamonaviy MCP klientlar uchun yetarli.
# telegram-mcp12
# telegram-mcp
