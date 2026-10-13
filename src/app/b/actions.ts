"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { sendCancellationForBooking } from "@/lib/booking-lifecycle";
import { logAudit } from "@/lib/audit";

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

  // Notify the guest — best effort, never fails the cancellation.
  await sendCancellationForBooking(supabase, booking.id as string);

  return { ok: true };
}
