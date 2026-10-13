import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { expireStaleHolds } from "@/lib/booking-lifecycle";
import { processOutbox, enqueueOutbox } from "@/lib/outbox";

/**
 * Unified background worker tick (Vercel Cron / cron-job.org → /api/cron/reminders).
 * Guarded by CRON_SECRET. Idempotent — safe to run frequently and concurrently.
 *
 * 1. Expires stale payment holds so their slots release.
 * 2. Enqueues due 24h reminders (deduplicated via notification_log).
 * 3. Processes the outbox: emails + calendar sync with retries.
 * 4. Reconciliation: re-enqueues side effects missed by a crash between the
 *    state change and the original enqueue (spec §8.2, §11.2).
 */
export const dynamic = "force-dynamic";

async function enqueueDueReminders(
  supabase: Awaited<ReturnType<typeof createServiceClient>>
): Promise<number> {
  const now = new Date();
  const from = new Date(now.getTime() + 23 * 3600_000).toISOString();
  const to = new Date(now.getTime() + 25 * 3600_000).toISOString();

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, starts_at")
    .eq("status", "confirmed")
    .gte("starts_at", from)
    .lt("starts_at", to)
    .limit(500);
  if (error || !bookings?.length) return 0;

  const { data: already } = await supabase
    .from("notification_log")
    .select("booking_id")
    .eq("template", "booking_reminder")
    .gte("created_at", new Date(now.getTime() - 26 * 3600_000).toISOString());
  const reminded = new Set((already ?? []).map((r) => r.booking_id));

  let enqueued = 0;
  for (const b of bookings) {
    if (reminded.has(b.id)) continue;
    const day = new Date(b.starts_at as string).toISOString().slice(0, 10);
    await enqueueOutbox(
      supabase,
      "email.send",
      { template: "booking_reminder", booking_id: b.id },
      `booking_reminder:${b.id}:${day}`
    );
    enqueued++;
  }
  return enqueued;
}

/**
 * Finds confirmed bookings whose confirmation email or calendar sync never
 * ran (crash between state change and enqueue) and re-enqueues them.
 */
async function reconcileMissedWork(
  supabase: Awaited<ReturnType<typeof createServiceClient>>
): Promise<{ emails: number; syncs: number }> {
  const out = { emails: 0, syncs: 0 };
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();

  // Confirmed bookings (created > 5 min ago) with no confirmation logged
  // and no pending outbox email for them.
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, event_types!inner(owner_profile_id)")
    .eq("status", "confirmed")
    .lt("created_at", cutoff)
    .limit(200);
  if (!bookings?.length) return out;

  const ids = bookings.map((b) => b.id as string);
  const { data: logged } = await supabase
    .from("notification_log")
    .select("booking_id")
    .eq("template", "booking_confirmation")
    .in("booking_id", ids);
  const emailed = new Set((logged ?? []).map((r) => r.booking_id));

  const { data: pending } = await supabase
    .from("outbox_events")
    .select("payload")
    .eq("event_type", "email.send")
    .in("status", ["pending", "processing"]);
  const queued = new Set(
    (pending ?? []).map((r) => (r.payload as { booking_id?: string }).booking_id)
  );

  // Hosts with connected calendars (for the sync check below).
  const { data: conns } = await supabase
    .from("connected_calendars")
    .select("owner_profile_id");
  const connectedOwners = new Set(
    (conns ?? []).map((c) => c.owner_profile_id as string)
  );

  for (const b of bookings) {
    const id = b.id as string;
    if (!emailed.has(id) && !queued.has(id)) {
      await enqueueOutbox(
        supabase,
        "email.send",
        { template: "booking_confirmation", booking_id: id },
        `booking_confirmation:${id}`
      );
      out.emails++;
    }
    const et = b.event_types as unknown as { owner_profile_id: string };
    if (connectedOwners.has(et.owner_profile_id)) {
      const { data: row } = await supabase
        .from("bookings")
        .select("calendar_sync_status")
        .eq("id", id)
        .maybeSingle();
      if (row?.calendar_sync_status === "not_attempted") {
        await enqueueOutbox(
          supabase,
          "calendar.sync_create",
          {
            booking_id: id,
            followup: { template: "booking_confirmation", booking_id: id },
          },
          `calendar_sync_create:${id}`
        );
        out.syncs++;
      }
    }
  }
  return out;
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();

  const expired = await expireStaleHolds(supabase);
  const remindersEnqueued = await enqueueDueReminders(supabase);
  const { evaluateTimeWorkflows } = await import("@/lib/workflows");
  await evaluateTimeWorkflows(supabase);
  const outbox = await processOutbox(supabase, 25);
  const reconciled = await reconcileMissedWork(supabase);

  return NextResponse.json({
    expired,
    remindersEnqueued,
    outbox,
    reconciled,
  });
}
