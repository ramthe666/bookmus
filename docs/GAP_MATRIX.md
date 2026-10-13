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
| Organizations / workspaces | ⚠️ | `organizations`, `organization_members` tables exist; app runs solo profile-owned model, no workspace switching UI |
| Roles & permission enforcement | ❌ | `role` column exists on memberships but is not enforced beyond owner checks |
| Services (event types) | ✅ | `src/app/dashboard/event-types` CRUD + `event_types` table |
| Staff model | ❌ | No staff table/UI; blocks round-robin, collective, staff calendars |
| Availability (weekly) | ✅ | `src/app/dashboard/availability`, `schedules` table |
| Availability overrides/breaks/leave | ⚠️ | `schedule_overrides` table exists; no UI, not read by slot engine |
| Public booking page | ✅ | `src/app/u/[username]/[slug]` |
| Booking lifecycle states | ⚠️ | Only `confirmed`/`cancelled` exercised; `pending`, `reschedule_pending`, `expired`, `completed`, `no-show` not in flow |
| Paid booking: pending hold → confirm on verified payment | ✅ | `20261013150000_booking_lifecycle.sql` adds `pending`/`expired` states; `createBooking` holds 30 min, `finalizePaidBooking` confirms on verified checkout/webhook; cron expires stale holds |
| Internal calendar (day/week/month/agenda) | ❌ | Dashboard has booking list only (`src/app/dashboard/bookings`) |
| Google/Zoho busy-time → availability | ❌ | OAuth connects; busy blocks never pulled, availability ignores them |
| Time zones (UTC instants + IANA, per-viewer render) | ✅ | Slot engine builds in host TZ, stores UTC; `Intl.DateTimeFormat` render |
| Email confirmations / reminders | ✅ | `src/lib/email.ts`, `/api/cron/reminders`, `notification_log` |
| Payment verification (server-side, webhook) | ✅ | `src/app/api/razorpay/order`, `src/app/api/webhooks/razorpay` |
| Audit trail | ✅ | `20261013160000_audit_trail.sql`: append-only `audit_events` (RLS: owners read own, service-role writes, no update/delete); `src/lib/audit.ts`; wired into booking create/cancel/confirm, hold expiry, integration connect/disconnect; `/dashboard/activity` feed (2026-10-13) |
| Tenant isolation (RLS) | ✅ | RLS on all tables, `auth.uid()`-scoped policies |
| Rate limiting (public booking, auth, OTP) | ❌ | No rate limits on any public route |
| OAuth token refresh before expiry | ❌ | Tokens encrypted at rest; no refresh worker |

## 2. SHOULD — commercial completeness

| Requirement | Status | Evidence / notes |
|---|---|---|
| Guest self-cancel via token link | ✅ | `/b/cancel/[token]` page + `cancelBookingByToken` action; manage link on confirmation screen, in confirmation email, and copy button on dashboard (2026-10-13) |
| Guest self-reschedule via token link | ❌ | `reschedule_token` column still unused |
| Reschedule flow (policy + availability recheck) | ❌ | No reschedule API or UI |
| Customer portal / manage booking | ❌ | — |
| Rebook flow | ❌ | — |
| Manual booking by staff (conflict override w/ audit) | ❌ | — |
| Email template editor (versioned) | ❌ | Templates hardcoded in `src/lib/email.ts` |
| Booking-page builder (theme/sections/publish) | ❌ | Public page is fixed layout |
| CRM (contacts, consent, sync) | ❌ | `booking_attendees` only; no customer directory |
| Reports (funnel, utilization, no-show, revenue) | ❌ | Overview shows basic counts only |
| Outgoing webhooks | ❌ | — |
| Reschedule/cancel policy engine | ❌ | — |
| Notification delivery center (queued/sent/failed) | ⚠️ | `notification_log` written; no UI, no retry controls |
| Meeting provider separation (Meet ≠ Calendar) | ⚠️ | Meet link auto-created via Calendar conferenceData; no standalone meeting provider model |

## 3. LATER — advanced

Workflow builder, SMS/WhatsApp, subscriptions/seat billing, multi-resource optimization,
advanced routing forms — all ❌ Missing, intentionally deferred per spec.

## 4. Spec-explicit correctness gaps (fix before scaling)

1. **Double-book race** (§5.3): slot revalidation is app-level (read → insert).
   Two concurrent requests can both pass. Fix: Postgres `EXCLUDE` constraint on
   booking `tstzrange` per owner (new migration) + keep app check for friendly errors.
2. **No durable outbox** (§9.4/§11.2): emails + calendar sync run fire-and-forget
   inside the booking request. A crash/provider outage loses them silently.
   Fix: `outbox_events` table + worker (cron) with idempotent claim/retry.
3. **Calendar sync failure invisible** (§8.2): fire-and-forget `.catch(() => {})`
   in `src/app/api/bookings/route.ts`. Fix: persist sync status per booking,
   surface in dashboard, retry via worker.
4. **Secrets hygiene** (§10.2): `console.error` in callbacks may log token-adjacent
   data; audit before production.

## 5. Smallest safe implementation sequence

Per spec §15.1 (small vertical slices, additive migrations only):

1. ✅ OAuth connect fix: anchor navigation, idempotent reconnect
2. ✅ Guest self-cancel via token (2026-10-13)
3. ✅ Paid lifecycle fix: `pending` → `confirmed` on verified payment/webhook (2026-10-13)
4. ✅ **Audit trail** (2026-10-13)
5. **Reschedule via token** (guest) + host reschedule with availability recheck
6. **No-double-book**: exclusion-constraint migration + concurrency test
7. **Outbox**: `outbox_events` + cron worker for email/calendar retries
8. **Busy-time integration**: pull Google/Zoho busy blocks into the slot engine
9. **Internal calendar view** + sync-health indicators
10. Roles/workspaces/staff, page builder, template editor, CRM, reports (spec phases 5–8)

Each slice ships with: UI states (loading/empty/error), server enforcement, and a
manual end-to-end check on the Vercel deployment before the next slice starts.
