# BookFlow Spec → BookMus Gap Matrix

**Spec:** `BookFlow_Product_Requirements_and_System_Design.docx` v1.0 (2026-10-13)
**Audited:** 2026-10-13 — repository `ramthe666/bookmus` @ main
**Method:** Appendix B of the spec — inspected routes, schema/migrations, auth, booking
lifecycle, availability engine, provider adapters, payment flows, email, deployment config.
No existing migrations were modified; all proposed schema work is additive.

**Legend:** ✅ Implemented · ⚠️ Partial · ❌ Missing · 🔴 Broken (works against spec intent)

> Naming note: the spec calls the product **BookFlow**; the repo/app is branded
> **BookMus**. Branding decision left to the owner — code references below use the
> current `bookmus` naming.

## 1. MUST — reliable core (spec §1.3)

| Requirement | Status | Evidence / notes |
|---|---|---|
| Auth (password + magic link) | ✅ | `src/app/login`, `src/app/signup`, `src/app/auth/callback`, `src/proxy.ts` |
| Organizations / workspaces | ✅ | `organizations` + `organization_members` with `/dashboard/team`: create team, invite by email (token link, 7-day expiry), roles, member management; `/invite/[token]` acceptance flow (2026-10-13) |
| Roles & permission enforcement | ⚠️ | owner/admin/member roles on memberships; enforced in team UI (owners/admins manage invites, owners manage roles) + existing RLS (`is_org_member`, `can_manage_event_type`); event types assignable to workspaces, team members see/edit org events & bookings (2026-10-13) |
| Services (event types) | ✅ | `src/app/dashboard/event-types` CRUD + `event_types` table |
| Staff model | ✅ | `event_type_hosts` roster + per-host availability; round-robin (union of free slots, fair assignment by fewest recent bookings) and collective (intersection — all hosts free) scheduling modes on event types; assigned host stored on booking and shown on dashboard (2026-10-13) |
| Availability (weekly) | ✅ | `src/app/dashboard/availability`, `schedules` table |
| Availability overrides/breaks/leave | ⚠️ | `schedule_overrides` table exists; no UI, not read by slot engine |
| Public booking page | ✅ | `src/app/u/[username]/[slug]` |
| Booking lifecycle states | ⚠️ | Only `confirmed`/`cancelled` exercised; `pending`, `reschedule_pending`, `expired`, `completed`, `no-show` not in flow |
| Paid booking: pending hold → confirm on verified payment | ✅ | `20261013150000_booking_lifecycle.sql` adds `pending`/`expired` states; `createBooking` holds 30 min, `finalizePaidBooking` confirms on verified checkout/webhook; cron expires stale holds |
| Internal calendar (day/week/month/agenda) | ✅ | `/dashboard/calendar` with Day/Week/Month/Agenda tabs: timeline columns for day & week, month grid (click-through to day), agenda list for next 60 days — all with BookFlow bookings + external busy blocks, sync-status dots (2026-10-13) |
| Google/Zoho busy-time → availability | ✅ | `getHostBusyBlocks` merges Google freebusy + Zoho events into the slot engine; provider outage degrades gracefully (2026-10-13) |
| Time zones (UTC instants + IANA, per-viewer render) | ✅ | Slot engine builds in host TZ, stores UTC; `Intl.DateTimeFormat` render |
| Email confirmations / reminders | ✅ | `src/lib/email.ts`, `/api/cron/reminders`, `notification_log` |
| Payment verification (server-side, webhook) | ✅ | `src/app/api/razorpay/order`, `src/app/api/webhooks/razorpay` |
| Audit trail | ✅ | `20261013160000_audit_trail.sql`: append-only `audit_events` (RLS: owners read own, service-role writes, no update/delete); `src/lib/audit.ts`; wired into booking create/cancel/confirm, hold expiry, integration connect/disconnect; `/dashboard/activity` feed (2026-10-13) |
| Tenant isolation (RLS) | ✅ | RLS on all tables, `auth.uid()`-scoped policies |
| Rate limiting (public booking, auth, OTP) | ⚠️ | In-memory sliding-window limiter on booking create + guest cancel/reschedule (`src/lib/rate-limit.ts`); per-instance on serverless, Redis swap documented (2026-10-13) |
| OAuth token refresh before expiry | ✅ | `getValidAccessToken` refreshes + persists Google/Zoho tokens on demand (2026-10-13) |

## 2. SHOULD — commercial completeness

| Requirement | Status | Evidence / notes |
|---|---|---|
| Guest self-cancel via token link | ✅ | `/b/cancel/[token]` page + `cancelBookingByToken` action; manage link on confirmation screen, in confirmation email, and copy button on dashboard (2026-10-13) |
| Guest self-reschedule via token link | ✅ | `rescheduleBookingByToken` + slot picker on the manage page; same availability engine, own slot excluded, provider event moved in place, reschedule email (2026-10-13) |
| Host reschedule | ✅ | `/dashboard/bookings/[id]/reschedule` with live slot picker (2026-10-13) |
| Reschedule flow (policy + availability recheck) | ❌ | No reschedule API or UI |
| Customer portal / manage booking | ❌ | — |
| Rebook flow | ❌ | — |
| Manual booking by staff (conflict override w/ audit) | ✅ | `/dashboard/bookings/new`: host books directly for a guest (confirmed immediately, same calendar-sync→email confirm sequence). Availability/busy-block override needs a written reason, recorded in `audit_events` (`booking.created_manual`); real double-books can never be overridden (`bookings_no_overlap` exclusion constraint) (2026-10-13) |
| Email template editor (versioned) | ✅ | `email_templates` table + studio (`/dashboard/settings/templates`): merge fields, live preview, version history, rollback; worker prefers custom template, falls back to built-in (2026-10-13) |
| Booking-page builder (theme/sections/publish) | ✅ | `booking_pages` + `booking_page_versions` (migration `20261013220000`); builder at `/dashboard/page-builder` with live preview, accent color, dark theme, event reorder/hide, publish + version history + rollback; public page renders published config only (draft never exposed) (2026-10-13) |
| CRM (contacts, consent, sync) | ⚠️ | Customer directory + detail + private notes live (`/dashboard/customers`, `customer_notes` table, 2026-10-13); provider sync not started |
| Reports (funnel, utilization, no-show, revenue) | ⚠️ | `/dashboard/reports`: volume chart, cancellation/no-show rates, captured revenue, payment success, documented metric definitions (2026-10-13); funnel + utilization not yet |
| Outgoing webhooks | ✅ | `webhook_endpoints` + `webhook_deliveries` (migration `20261013210000`); HMAC-SHA256 signed deliveries through the outbox with retries + failure log; triggers on booking created/confirmed/cancelled/rescheduled and payment captured/failed; settings UI with secret reveal, pause/resume, delivery log (2026-10-13) |
| Reschedule/cancel policy engine | ❌ | — |
| Notification delivery center (queued/sent/failed) | ⚠️ | `notification_log` written; no UI, no retry controls |
| Meeting provider separation (Meet ≠ Calendar) | ⚠️ | Meet link auto-created via Calendar conferenceData; no standalone meeting provider model |

## 3. LATER — advanced

Workflow builder, SMS/WhatsApp, subscriptions/seat billing, multi-resource optimization,
advanced routing forms — all ❌ Missing, intentionally deferred per spec.

## 4. Spec-explicit correctness gaps (fix before scaling)

1. ✅ **Double-book race** (§5.3): `bookings_no_overlap` exclusion constraint
   (migration `20261013170000`); app check kept for friendly errors; `23P01`
   mapped to "that time was just taken" (2026-10-13).
2. ✅ **No durable outbox** (§9.4/§11.2): `20261013180000_outbox.sql` adds
   `outbox_events` + race-safe `claim_outbox_events` RPC (SKIP LOCKED). All
   lifecycle emails and calendar syncs enqueue durably; the cron worker
   processes with exponential-backoff retries; permanent failures surface on
   the Activity page. A reconciliation sweep re-enqueues work missed by a
   crash. Reminders also flow through the outbox (2026-10-13).
3. ✅ **Calendar sync failure invisible** (§8.2): `calendar_sync_status` columns
   (migration `20261013170000`); `src/lib/calendar-sync.ts` creates/updates/
   deletes linked provider events with visible status; failures surface on the
   bookings list and calendar view (2026-10-13).
4. **Secrets hygiene** (§10.2): `console.error` in callbacks may log token-adjacent
   data; audit before production.

## 5. Smallest safe implementation sequence

Per spec §15.1 (small vertical slices, additive migrations only):

1. ✅ OAuth connect fix: anchor navigation, idempotent reconnect
2. ✅ Guest self-cancel via token (2026-10-13)
3. ✅ Paid lifecycle fix: `pending` → `confirmed` on verified payment/webhook (2026-10-13)
4. ✅ **Audit trail** (2026-10-13)
5. ✅ **Reschedule via token** (guest) + host reschedule (2026-10-13)
6. ✅ **No-double-book**: exclusion-constraint migration (2026-10-13)
7. ✅ **Outbox** (2026-10-13)
8. ✅ **Busy-time integration** (2026-10-13)
9. ✅ **Internal calendar week view** + sync-health indicators (2026-10-13)
10. ✅ Page builder, ✅ template editor, ✅ CRM basics, ✅ reports, ✅ teams/roles phase 1, ✅ round-robin/collective scheduling, ✅ manual staff booking, ✅ day/month/agenda calendar views, ✅ workflows (trigger→action automations), ✅ embeddable booking widget, ✅ secret events, ✅ custom booking questions (2026-10-13)

Each slice ships with: UI states (loading/empty/error), server enforcement, and a
manual end-to-end check on the Vercel deployment before the next slice starts.
