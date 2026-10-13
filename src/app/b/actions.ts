"use server";

import { createServiceClient } from "@/lib/supabase/server";
import {
  sendCancellationForBooking,
  sendRescheduledForBooking,
  cleanupSyncedBooking,
} from "@/lib/booking-lifecycle";
import { updateSyncedBooking } from "@/lib/calendar-sync";
import { validateSlotAvailable } from "@/app/u/actions";
import { logAudit } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Guest self-cancellation via the unguessable cancel_token link
 * (spec §7.2). The token is the credential — no login required.
 * Only confirmed/pending future bookings can be cancelled this way.
 */
export async function cancelBookingByToken(
  token: string,
  reason?: string
): Promise<{ ok: true } | { alreadyCancelled: true }> {
  const clean = token.trim();
  if (!clean) throw new Error("This link is invalid.");
  await enforceRateLimit("booking:guest-cancel", 20, 60_000);

  const supabase = await createServiceClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, status, starts_at, booker_email, event_types!inner(owner_profile_id)"
    )
    .eq("cancel_token", clean)
    .maybeSingle();

  if (!booking) {
    throw new Error("This link is invalid or has expired.");
  }
  if (booking.status === "cancelled") {
    return { alreadyCancelled: true };
  }
  if (booking.status !== "confirmed" && booking.status !== "pending") {
    throw new Error(
      "This booking can no longer be cancelled online. Please contact the host."
    );
  }
  if (new Date(booking.starts_at as string).getTime() <= Date.now()) {
    throw new Error("This appointment has already started or passed.");
  }

  const cancelReason =
    reason?.trim().slice(0, 500) || "Cancelled by guest via link";
  const { error } = await supabase
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: cancelReason,
    })
    .eq("id", booking.id)
    .in("status", ["confirmed", "pending"]);
  if (error) throw new Error("Could not cancel the booking. Please try again.");

  const et = booking.event_types as unknown as { owner_profile_id: string };
  await logAudit(supabase, {
    action: "booking.cancelled",
    targetType: "booking",
    targetId: booking.id as string,
    ownerProfileId: et.owner_profile_id,
    actorType: "guest",
    actorLabel: (booking.booker_email as string) ?? null,
    metadata: { reason: cancelReason, via: "guest_link" },
  });

  // Remove the linked provider event — best effort, failure is surfaced
  // on the booking and never rolls back the cancellation.
  await cleanupSyncedBooking(supabase, booking.id as string);

  // Notify the guest — best effort, never fails the cancellation.
  await sendCancellationForBooking(supabase, booking.id as string);

  return { ok: true };
}

/**
 * Guest self-reschedule via the manage token (spec §7.3). The new slot is
 * validated against the same availability engine (including external busy
 * time); the booking's own current slot is excluded from the conflict
 * check. The linked provider event is moved in place — never duplicated.
 */
export async function rescheduleBookingByToken(
  token: string,
  newStartsAtIso: string
): Promise<{ ok: true; newStartsAtIso: string }> {
  const clean = token.trim();
  if (!clean) throw new Error("This link is invalid.");
  await enforceRateLimit("booking:guest-reschedule", 20, 60_000);

  const supabase = await createServiceClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, status, starts_at, ends_at, booker_email, event_type_id, event_types!inner(owner_profile_id)"
    )
    .eq("cancel_token", clean)
    .maybeSingle();

  if (!booking) throw new Error("This link is invalid or has expired.");
  if (booking.status !== "confirmed") {
    throw new Error(
      "Only confirmed bookings can be rescheduled through this link. Please contact the host."
    );
  }
  if (new Date(booking.starts_at as string).getTime() <= Date.now()) {
    throw new Error("This appointment has already started or passed.");
  }

  const oldStartsAt = booking.starts_at as string;
  const oldEndsAt = booking.ends_at as string;
  if (new Date(newStartsAtIso).toISOString() === new Date(oldStartsAt).toISOString()) {
    return { ok: true, newStartsAtIso: oldStartsAt };
  }

  // Same availability engine as booking; own slot excluded from conflicts.
  const ctx = await validateSlotAvailable(
    booking.event_type_id as string,
    newStartsAtIso,
    { starts_at: oldStartsAt, ends_at: oldEndsAt }
  );
  const newStart = new Date(newStartsAtIso);
  const newEnd = new Date(newStart.getTime() + ctx.duration_minutes * 60000);

  const { error } = await supabase
    .from("bookings")
    .update({
      starts_at: newStart.toISOString(),
      ends_at: newEnd.toISOString(),
    })
    .eq("id", booking.id)
    .eq("status", "confirmed");
  if (error) {
    if (error.code === "23P01") {
      throw new Error("That time was just taken — please pick another slot.");
    }
    throw new Error("Could not reschedule. Please try again.");
  }

  const et = booking.event_types as unknown as { owner_profile_id: string };
  await logAudit(supabase, {
    action: "booking.rescheduled",
    targetType: "booking",
    targetId: booking.id as string,
    ownerProfileId: et.owner_profile_id,
    actorType: "guest",
    actorLabel: (booking.booker_email as string) ?? null,
    metadata: {
      via: "guest_link",
      old_starts_at: oldStartsAt,
      new_starts_at: newStart.toISOString(),
    },
  });

  // Move the linked provider event in place — best effort, surfaced.
  await updateSyncedBooking(supabase, booking.id as string);

  // Notify with old → new times.
  await sendRescheduledForBooking(supabase, booking.id as string, oldStartsAt);

  return { ok: true, newStartsAtIso: newStart.toISOString() };
}
