import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Append-only audit log (spec §10.5). Server-only: callers pass a
 * service-role client, which bypasses RLS (the only writer). Rows are
 * immutable to every application role — there are no update/delete policies.
 */

export type AuditActorType = "user" | "guest" | "system";

export interface AuditEventInput {
  action: string;
  targetType: string;
  targetId: string;
  /** Owner whose data this concerns — drives read access. */
  ownerProfileId: string | null;
  organizationId?: string | null;
  actorProfileId?: string | null;
  actorType?: AuditActorType;
  /** Human label for the actor, e.g. guest email (owner-visible data). */
  actorLabel?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Records an audit event. Never throws — auditing must never break the
 * action it records.
 */
export async function logAudit(
  supabase: SupabaseClient,
  event: AuditEventInput
): Promise<void> {
  try {
    await supabase.from("audit_events").insert({
      action: event.action,
      target_type: event.targetType,
      target_id: event.targetId,
      owner_profile_id: event.ownerProfileId,
      organization_id: event.organizationId ?? null,
      actor_profile_id: event.actorProfileId ?? null,
      actor_type: event.actorType ?? "user",
      actor_label: event.actorLabel ?? null,
      metadata: event.metadata ?? {},
    });
  } catch (e) {
    console.error("audit log failed:", e);
  }
}

/** Friendly labels for the dashboard activity feed. */
export function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    "booking.created_manual": "Manual booking created",
    "booking.created": "Booking created",
    "booking.confirmed": "Booking confirmed",
    "booking.cancelled": "Booking cancelled",
    "booking.rescheduled": "Booking rescheduled",
    "booking.hold_expired": "Payment hold expired",
    "payment.captured": "Payment captured",
    "integration.connected": "Integration connected",
    "integration.disconnected": "Integration disconnected",
  };
  return labels[action] ?? action;
}
