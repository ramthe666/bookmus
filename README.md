# BookMus — Scheduling SaaS

A Calendly / Zoho Bookings-grade scheduling platform. Next.js 16 + Supabase.

## Stack

| Layer      | Choice                                    |
| ---------- | ----------------------------------------- |
| Framework  | Next.js 16 (App Router, `src/proxy.ts`)   |
| Language   | TypeScript                                |
| Styling    | Tailwind CSS v4                           |
| Backend    | Supabase (Postgres + Auth + RLS)          |
| Email      | Resend (adapter-ready)                    |
| Payments   | Razorpay (adapter-ready)                  |
| Calendars  | Google / Zoho Calendar (OAuth-ready)      |
| Meetings   | Google Meet / Zoho Meeting (adapter-ready)|
| Hosting    | Vercel                                    |

> **Note:** This repo uses Next.js 16, where Middleware is now **Proxy**
> (`src/proxy.ts`). See `AGENTS.md` for the auto-generated framework notes.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project values
npm run dev
```

## Supabase

- SQL migrations live in `supabase/migrations/`. **Never edit an existing
  migration** — always add a new timestamped file.
- Apply migrations yourself (dashboard SQL editor or `supabase db push`).
- RLS is enabled on all tables; public booking pages work unauthenticated,
  everything else is owner/org-scoped.

### Schema overview (migration `20261013120000`)

`organizations` → `organization_members` → `profiles` (extends `auth.users`)
`event_types` → `availability_schedules` + `schedule_overrides`
`bookings` → `booking_attendees`, `payments`, `notification_log`
`connected_calendars` (OAuth tokens, app-encrypted before write)

Scale path for 1B bookings is documented in the migration header
(BRIN + btree hot indexes, idempotency keys, future range partitioning).

## Project structure

```
src/
  app/
    (marketing)/          # landing, pricing, etc.
    (auth)/               # login, signup, callback
    (dashboard)/          # event types, availability, bookings, integrations
    u/[username]/[slug]/  # public booking pages
  lib/
    supabase/             # browser / server / service-role clients
    booking/              # slot engine, buffers, limits
    integrations/         # resend, razorpay, calendar adapters
  proxy.ts                # session refresh (Next 16)
supabase/
  migrations/             # append-only SQL
```

## Security

- Never commit `.env.local` or any real keys (`.gitignore` covers `.env*`).
- OAuth tokens are encrypted by the app before being stored.
- Money movement reconciles on provider order/payment ids + idempotency keys.
