"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { sendCancellationForBooking } from "@/lib/booking-lifecycle";

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
    .select("id, status, starts_at")
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

  const { error } = await supabase
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason:
        reason?.trim().slice(0, 500) || "Cancelled by guest via link",
    })
    .eq("id", booking.id)
    .in("status", ["confirmed", "pending"]);
  if (error) throw new Error("Could not cancel the booking. Please try again.");

  // Notify the guest — best effort, never fails the cancellation.
  await sendCancellationForBooking(supabase, booking.id as string);

  return { ok: true };
}
