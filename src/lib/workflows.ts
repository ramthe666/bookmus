/**
 * Workflows: trigger → action automations.
 *
 * Immediate triggers (booking.created / cancelled / rescheduled) fire from
 * the booking lifecycle. Time triggers (booking.before_start / after_end)
 * are evaluated by the cron tick. Actions reuse the durable outbox, so
 * they get retries for free. workflow_runs makes every firing idempotent.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueOutbox } from "@/lib/outbox-enqueue";

export const WORKFLOW_TRIGGERS = [
  { value: "booking.created", label: "Booking created" },
  { value: "booking.cancelled", label: "Booking cancelled" },
  { value: "booking.rescheduled", label: "Booking rescheduled" },
  { value: "booking.before_start", label: "Before booking starts" },
  { value: "booking.after_end", label: "After booking ends" },
] as const;

export const WORKFLOW_ACTIONS = [
  { value: "send_email", label: "Send email" },
  { value: "call_webhook", label: "Call webhook" },
] as const;

export const WORKFLOW_TEMPLATES = [
  { value: "confirmation", label: "Confirmation" },
  { value: "cancellation", label: "Cancellation" },
  { value: "reschedule", label: "Reschedule" },
  { value: "reminder", label: "Reminder" },
] as const;

const TEMPLATE_MAP: Record<string, string> = {
  confirmation: "booking_confirmation",
  cancellation: "booking_cancellation",
  reschedule: "booking_rescheduled",
  reminder: "booking_reminder",
};

interface WorkflowRow {
  id: string;
  owner_profile_id: string;
  trigger: string;
  offset_hours: number;
  action: string;
  action_config: { template_event?: string; webhook_id?: string };
}

interface BookingRef {
  id: string;
  owner_profile_id: string;
  booker_name: string;
  booker_email: string;
  starts_at: string;
  ends_at: string;
  event_title?: string;
}

async function runWorkflowAction(
  supabase: SupabaseClient,
  workflow: WorkflowRow,
  booking: BookingRef
): Promise<void> {
  if (workflow.action === "send_email") {
    const template =
      TEMPLATE_MAP[workflow.action_config.template_event ?? "confirmation"] ??
      "booking_confirmation";
    await enqueueOutbox(
      supabase,
      "email.send",
      { template, booking_id: booking.id },
      `workflow:${workflow.id}:${booking.id}`
    );
  } else if (workflow.action === "call_webhook") {
    const webhookId = workflow.action_config.webhook_id;
    if (!webhookId) return;
    await enqueueOutbox(
      supabase,
      "webhook.deliver",
      {
        endpoint_id: webhookId,
        event: `workflow.${workflow.trigger}`,
        payload: {
          event: `workflow.${workflow.trigger}`,
          workflow_id: workflow.id,
          booking_id: booking.id,
          booker_name: booking.booker_name,
          booker_email: booking.booker_email,
          starts_at: booking.starts_at,
          ends_at: booking.ends_at,
          delivered_at: new Date().toISOString(),
        },
      },
      `workflow:${workflow.id}:${booking.id}`
    );
  } else {
    return;
  }
  // Idempotency record — the unique constraint makes double-fires impossible.
  await supabase
    .from("workflow_runs")
    .upsert(
      { workflow_id: workflow.id, booking_id: booking.id },
      { onConflict: "workflow_id,booking_id" }
    );
}

/** Fire immediate triggers from the booking lifecycle. */
export async function fireWorkflowTrigger(
  supabase: SupabaseClient,
  trigger: "booking.created" | "booking.cancelled" | "booking.rescheduled",
  booking: BookingRef
): Promise<void> {
  try {
    const { data: workflows } = await supabase
      .from("workflows")
      .select("id, owner_profile_id, trigger, offset_hours, action, action_config")
      .eq("owner_profile_id", booking.owner_profile_id)
      .eq("trigger", trigger)
      .eq("is_active", true);
    for (const w of (workflows ?? []) as WorkflowRow[]) {
      try {
        await runWorkflowAction(supabase, w, booking);
      } catch (e) {
        console.error("workflow action failed:", e);
      }
    }
  } catch (e) {
    console.error("workflow trigger failed:", e);
  }
}

/**
 * Evaluate time-based triggers. Called from the cron tick.
 * Windows are 24h wide so a daily cron never misses; workflow_runs
 * dedups when the cron runs more often.
 */
export async function evaluateTimeWorkflows(
  supabase: SupabaseClient
): Promise<void> {
  try {
    const { data: workflows } = await supabase
      .from("workflows")
      .select("id, owner_profile_id, trigger, offset_hours, action, action_config")
      .in("trigger", ["booking.before_start", "booking.after_end"])
      .eq("is_active", true);
    if (!workflows?.length) return;

    const now = new Date();
    for (const w of workflows as WorkflowRow[]) {
      let fromIso: string;
      let toIso: string;
      let field: "starts_at" | "ends_at";
      if (w.trigger === "booking.before_start") {
        field = "starts_at";
        fromIso = new Date(now.getTime() + (w.offset_hours - 24) * 3600000).toISOString();
        toIso = new Date(now.getTime() + w.offset_hours * 3600000).toISOString();
      } else {
        field = "ends_at";
        fromIso = new Date(now.getTime() - (w.offset_hours + 24) * 3600000).toISOString();
        toIso = new Date(now.getTime() - w.offset_hours * 3600000).toISOString();
      }

      // Bookings in the window without a recorded run for this workflow.
      const { data: bookings } = await supabase
        .from("bookings")
        .select(
          "id, owner_profile_id, booker_name, booker_email, starts_at, ends_at, event_types!inner(owner_profile_id)"
        )
        .eq("event_types.owner_profile_id", w.owner_profile_id)
        .eq("status", "confirmed")
        .gte(field, fromIso)
        .lt(field, toIso)
        .limit(200);
      for (const b of (bookings ?? []) as unknown as (BookingRef & {
        event_types: unknown;
      })[]) {
        const { data: existing } = await supabase
          .from("workflow_runs")
          .select("id")
          .eq("workflow_id", w.id)
          .eq("booking_id", b.id)
          .maybeSingle();
        if (existing) continue;
        try {
          await runWorkflowAction(supabase, w, b);
        } catch (e) {
          console.error("workflow time action failed:", e);
        }
      }
    }
  } catch (e) {
    console.error("workflow time evaluation failed:", e);
  }
}
