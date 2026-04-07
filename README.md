# Tandoori Restaurant — WhatsApp AI Agent

Production-ready WhatsApp ordering assistant for **Tandoori Restaurant Wah (New City Phase 2)** built with Next.js 14+, Supabase, and OpenRouter AI.

## Features

- 🤖 **AI Agent (Zaiqa)** — Handles full end-to-end ordering in WhatsApp (Urdu/English)
- 📦 **Order Management** — Parses `__order__` JSON, stores to DB, manages status
- 💬 **Live Dashboard** — Real-time conversations + orders via Supabase Realtime
- 🔄 **Human Takeover** — Toggle any conversation from AI agent to human mode
- 📳 **Status Notifications** — Customers get WhatsApp messages when order status changes
- 🛡️ **Deduplication** — Webhook is idempotent via `whatsapp_msg_id`

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

Open **Supabase Dashboard → SQL Editor** and run the entire contents of:

```
supabase-schema.sql
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
  → Fetch last 20 messages as context
  → Call OpenRouter (GPT-4o-mini) with system prompt
  → Parse __order__ JSON from AI reply
  → Send clean reply to customer
  → Write order to orders + order_items tables
  → Store AI reply in messages table
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
