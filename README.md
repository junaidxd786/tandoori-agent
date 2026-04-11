# Tandoori Restaurant — WhatsApp AI Agent

Production-grade WhatsApp ordering assistant for **Tandoori Restaurant Wah (New City Phase 2)** built with Next.js, Supabase, and OpenRouter AI.

## Features

- 🤖 **Guided AI Assistant** — Uses AI for menu/help replies while backend code deterministically controls order state
- 🧾 **Draft Order State Machine** — Persists cart, order type, address, dine-in details, and confirmation gates in the database
- 💬 **Live Dashboard** — Real-time conversations + orders via Supabase Realtime
- 🔄 **Human Takeover** — Toggle any conversation from AI agent to human mode
- 📳 **Status Notifications** — Customers get WhatsApp messages when order status changes
- 🛡️ **Idempotent Ordering** — Orders are tied to the source WhatsApp confirmation message to prevent duplicate placement

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14+ App Router |
| Database | Supabase (PostgreSQL + Realtime) |
| AI | OpenRouter → GPT-4o-mini |
| Styling | Tailwind CSS |
| Deployment | Vercel |

## Setup

### 1. Clone & Install

```bash
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `OPENROUTER_API_KEY` | https://openrouter.ai/keys |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta → WhatsApp → API Setup |
| `WHATSAPP_ACCESS_TOKEN` | Meta → WhatsApp → API Setup |
| `WHATSAPP_VERIFY_TOKEN` | Any secret string you choose |

### 3. Database Schema

For a fresh database, run:

```sql
supabase-schema.sql
```

For an existing database, run:

```sql
migrations.sql
```

### 4. Run Locally

```bash
npm run dev
```

Dashboard: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)

### 5. Expose for WhatsApp Webhook (Local Dev)

```bash
npx ngrok http 3000
```

Use the ngrok HTTPS URL as your webhook in Meta:
```
https://your-ngrok-id.ngrok-free.app/api/webhook
```

### 6. Configure Meta Webhook

1. Go to **Meta for Developers → Your App → WhatsApp → Configuration**
2. Webhook URL: `https://your-domain.com/api/webhook`
3. Verify Token: same as `WHATSAPP_VERIFY_TOKEN` in your `.env.local`
4. Subscribe to: **messages**

## Architecture

```
WhatsApp Message
  → POST /api/webhook
  → Store message in DB
  → Persist message
  → Acquire per-conversation lock
  → Load persisted draft state + menu + settings
  → Deterministically advance workflow
  → Use AI only for safe fallback/help replies
  → Place order only after backend validation
  → Store assistant reply + order state
  → Dashboard updates in real-time via Supabase Realtime
```

## API Routes

| Method | Route | Description |
|---|---|---|
| GET | `/api/webhook` | Meta webhook verification |
| POST | `/api/webhook` | Receive incoming WhatsApp messages |
| GET | `/api/conversations` | List all conversations |
| GET | `/api/conversations/[id]/messages` | Messages for a conversation |
| PATCH | `/api/conversations/[id]` | Toggle agent/human mode |
| POST | `/api/conversations/[id]` | Send manual message (human mode) |
| GET | `/api/orders` | All orders with items |
| PATCH | `/api/orders/[id]/status` | Update status + notify customer |

## Deployment (Vercel)

```bash
vercel deploy
```

Set all environment variables in **Vercel → Project → Settings → Environment Variables**, then update your Meta webhook URL to the production URL.
## MCP Setup

This repo now includes a root [`.mcp.json`](/C:/Users/PMLS/OneDrive/Desktop/tandoori-agent/.mcp.json:1) with:

- `supabase` pointed at this project's Supabase MCP endpoint
- `next-devtools` for the Next.js 16 dev-server MCP bridge

For Supabase MCP to authenticate, make sure the process launching Codex has `SUPABASE_ACCESS_TOKEN` set to a Supabase personal access token for your account. The MCP config sends it as a bearer token header.

Run the app locally with:

```bash
npm run dev
```

Then reload the Codex workspace or restart the session so the project MCP config is picked up.

## Semantic Retrieval Env

Semantic menu retrieval is configured through:

- `MENU_EMBEDDING_API_KEY`
- `MENU_EMBEDDING_BASE_URL`
- `MENU_EMBEDDING_MODEL`
- `RESTAURANT_TIMEZONE`

These are now filled in `.env.local` for local development. Mirror them into Vercel or your production host if you want pgvector-backed matching in production.
