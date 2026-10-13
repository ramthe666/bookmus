import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendConfirmationForBooking,
  sendCancellationForBooking,
  sendRescheduledForBooking,
  sendReminderForBooking,
} from "@/lib/booking-lifecycle";
import {
  syncBookingToCalendars,
  updateSyncedBooking,
  deleteSyncedBooking,
} from "@/lib/calendar-sync";
import {
  enqueueOutbox,
  type OutboxEventType,
} from "@/lib/outbox-enqueue";

/**
 * Durable outbox worker (spec §9.4, §11.2).
 *
 * Lifecycle code enqueues side effects instead of performing them inline;
 * this worker claims due events (race-safe via claim_outbox_events),
 * runs idempotent handlers, and retries transient failures with
 * exponential backoff. Permanent failures stay visible as 'failed'.
 */

interface EmailPayload {
  template:
    | "booking_confirmation"
    | "booking_cancellation"
    | "booking_rescheduled"
    | "booking_reminder";
  booking_id: string;
  old_starts_at?: string;
}

interface CalendarPayload {
  booking_id: string;
  /** Enqueued after the calendar op succeeds OR permanently fails. */
  followup?: EmailPayload;
}

interface OutboxRow {
  id: string;
  event_type: string;
  payload: EmailPayload & CalendarPayload;
  attempts: number;
  max_attempts: number;
}

export { enqueueOutbox };
export type { OutboxEventType };

async function handleEmailSend(
  supabase: SupabaseClient,
  p: EmailPayload
): Promise<void> {
  switch (p.template) {
    case "booking_confirmation":
      await sendConfirmationForBooking(supabase, p.booking_id);
      break;
    case "booking_cancellation":
      await sendCancellationForBooking(supabase, p.booking_id);
      break;
    case "booking_rescheduled":
      await sendRescheduledForBooking(
        supabase,
        p.booking_id,
        p.old_starts_at ?? ""
      );
      break;
    case "booking_reminder":
      await sendReminderForBooking(supabase, p.booking_id);
      break;
    default:
      throw new Error(`Unknown email template: ${(p as EmailPayload).template}`);
  }
}

async function handleCalendarSync(
  supabase: SupabaseClient,
  row: OutboxRow
): Promise<void> {
  const p = row.payload;
  const isLastAttempt = row.attempts + 1 >= row.max_attempts;
  try {
    if (row.event_type === "calendar.sync_create") {
      await syncBookingToCalendars(supabase, p.booking_id);
    } else if (row.event_type === "calendar.sync_update") {
      await updateSyncedBooking(supabase, p.booking_id);
    } else {
      await deleteSyncedBooking(supabase, p.booking_id);
    }
  } catch (e) {
    // The guest must still get their email even if the calendar provider
    // is permanently down — enqueue the followup before giving up.
    if (isLastAttempt && p.followup) {
      await enqueueOutbox(supabase, "email.send", { ...p.followup }, undefined);
    }
    throw e;
  }
  if (p.followup && row.event_type === "calendar.sync_create") {
    await enqueueOutbox(supabase, "email.send", { ...p.followup }, undefined);
  }
}

async function handleEvent(
  supabase: SupabaseClient,
  row: OutboxRow
): Promise<void> {
  if (row.event_type === "email.send") {
    await handleEmailSend(supabase, row.payload);
  } else if (row.event_type.startsWith("calendar.")) {
    await handleCalendarSync(supabase, row);
  } else {
    throw new Error(`Unknown outbox event type: ${row.event_type}`);
  }
}

export interface OutboxResult {
  claimed: number;
  succeeded: number;
  failed: number;
  pendingRetry: number;
}

/** Claim due events and process them. Safe to run concurrently. */
export async function processOutbox(
  supabase: SupabaseClient,
  limit = 25
): Promise<OutboxResult> {
  const result: OutboxResult = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    pendingRetry: 0,
  };
  const { data, error } = await supabase.rpc("claim_outbox_events", {
    p_limit: limit,
  });
  if (error) {
    console.error("outbox claim failed:", error);
    return result;
  }
  const rows = (data ?? []) as OutboxRow[];
  result.claimed = rows.length;

  for (const row of rows) {
    try {
      await handleEvent(supabase, row);
      await supabase
        .from("outbox_events")
        .update({
          status: "done",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      result.succeeded++;
    } catch (e) {
      const attempts = row.attempts + 1;
      const exhausted = attempts >= row.max_attempts;
      const backoffMs = Math.pow(2, Math.min(attempts, 6)) * 60_000;
      await supabase
        .from("outbox_events")
        .update({
          status: exhausted ? "failed" : "pending",
          attempts,
          last_error:
            e instanceof Error ? e.message.slice(0, 1000) : String(e).slice(0, 1000),
          next_attempt_at: new Date(Date.now() + backoffMs).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (exhausted) result.failed++;
      else result.pendingRetry++;
    }
  }
  return result;
}
