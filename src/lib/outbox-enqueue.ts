import type { SupabaseClient } from "@supabase/supabase-js";

export type OutboxEventType =
  | "email.send"
  | "calendar.sync_create"
  | "calendar.sync_update"
  | "calendar.sync_delete";

/**
 * Enqueue-only side of the outbox (no worker imports — safe to use from
 * booking-lifecycle.ts without creating an import cycle).
 */
export async function enqueueOutbox(
  supabase: SupabaseClient,
  eventType: OutboxEventType,
  payload: Record<string, unknown>,
  idempotencyKey?: string
): Promise<void> {
  try {
    const { error } = await supabase.from("outbox_events").insert({
      event_type: eventType,
      payload,
      idempotency_key: idempotencyKey ?? null,
    });
    // 23505 = already enqueued; safe to ignore.
    if (error && error.code !== "23505") throw error;
  } catch (e) {
    console.error("outbox enqueue failed:", e);
  }
}
