import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendEmail,
  bookingConfirmationEmail,
  bookingCancellationEmail,
  bookingRescheduledEmail,
  isEmailConfigured,
} from "@/lib/integrations/email";
import { logAudit } from "@/lib/audit";
import { syncBookingToCalendars, deleteSyncedBooking } from "@/lib/calendar-sync";

/**
 * Shared booking-lifecycle transitions (spec §7).
 * Server-only: callers pass a service-role client. Every transition is
 * idempotent — repeating it is a no-op, never a duplicate side effect.
 */

export const PAYMENT_HOLD_MINUTES = 30;

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}

export function cancelUrlFor(cancelToken: string): string {
  return `${appUrl()}/b/cancel/${cancelToken}`;
}

interface MailContext {
  id: string;
  starts_at: string;
  booker_name: string;
  booker_email: string;
  booker_timezone: string | null;
  meeting_url: string | null;
  cancel_token: string;
  event_title: string;
  host_name: string;
  owner_profile_id: string;
}

async function loadMailContext(
  supabase: SupabaseClient,
  bookingId: string
): Promise<MailContext | null> {
  const { data: b } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, booker_name, booker_email, booker_timezone, meeting_url, cancel_token, event_types!inner(title, owner_profile_id)"
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!b) return null;
  const et = b.event_types as unknown as {
    title: string;
    owner_profile_id: string;
  };
  let hostName = "your host";
  const { data: host } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", et.owner_profile_id)
    .maybeSingle();
  if (host?.display_name) hostName = host.display_name;
  return {
    id: b.id as string,
    starts_at: b.starts_at as string,
    booker_name: b.booker_name as string,
    booker_email: b.booker_email as string,
    booker_timezone: (b.booker_timezone as string | null) ?? null,
    meeting_url: (b.meeting_url as string | null) ?? null,
    cancel_token: b.cancel_token as string,
    event_title: et.title,
    host_name: hostName,
    owner_profile_id: et.owner_profile_id,
  };
}

function formatWhen(startsAtIso: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: timeZone ?? "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(startsAtIso));
}

async function logNotification(
  supabase: SupabaseClient,
  args: {
    bookingId: string;
    template: string;
    recipient: string;
    providerId: string | null;
    ok: boolean;
    error: string | null;
  }
) {
  try {
    await supabase.rpc("log_notification", {
      p_booking_id: args.bookingId,
      p_channel: "email",
      p_template: args.template,
      p_recipient: args.recipient,
      p_provider: "resend",
      p_provider_id: args.providerId,
      p_status: args.ok ? "sent" : "failed",
      p_error: args.error,
    });
  } catch {
    /* logging must never break the lifecycle */
  }
}

/** Confirmation email for a booking (includes the guest cancel link). */
export async function sendConfirmationForBooking(
  supabase: SupabaseClient,
  bookingId: string
): Promise<void> {
  try {
    if (!isEmailConfigured()) return;
    const ctx = await loadMailContext(supabase, bookingId);
    if (!ctx) return;
    const mail = bookingConfirmationEmail({
      hostName: ctx.host_name,
      eventTitle: ctx.event_title,
      whenText: formatWhen(ctx.starts_at, ctx.booker_timezone),
      bookerName: ctx.booker_name,
      meetingUrl: ctx.meeting_url,
      cancelUrl: cancelUrlFor(ctx.cancel_token),
    });
    const sent = await sendEmail({
      to: ctx.booker_email,
      subject: mail.subject,
      html: mail.html,
    });
    await logNotification(supabase, {
      bookingId: ctx.id,
      template: "booking_confirmation",
      recipient: ctx.booker_email,
      providerId: sent.providerId ?? null,
      ok: sent.ok,
      error: sent.error ?? null,
    });
  } catch (e) {
    console.error("Confirmation email failed:", e);
  }
}

/** Cancellation email for a booking. */
export async function sendCancellationForBooking(
  supabase: SupabaseClient,
  bookingId: string
): Promise<void> {
  try {
    if (!isEmailConfigured()) return;
    const ctx = await loadMailContext(supabase, bookingId);
    if (!ctx) return;
    const mail = bookingCancellationEmail({
      hostName: ctx.host_name,
      eventTitle: ctx.event_title,
      whenText: formatWhen(ctx.starts_at, ctx.booker_timezone),
      bookerName: ctx.booker_name,
    });
    const sent = await sendEmail({
      to: ctx.booker_email,
      subject: mail.subject,
      html: mail.html,
    });
    await logNotification(supabase, {
      bookingId: ctx.id,
      template: "booking_cancellation",
      recipient: ctx.booker_email,
      providerId: sent.providerId ?? null,
      ok: sent.ok,
      error: sent.error ?? null,
    });
  } catch (e) {
    console.error("Cancellation email failed:", e);
  }
}

/**
 * Flip a pending paid booking to confirmed and send its confirmation email.
 * Returns true when this call performed the transition; false when the
 * booking was already confirmed/expired/cancelled (safe to retry).
 */
export async function finalizePaidBooking(
  supabase: SupabaseClient,
  bookingId: string,
  opts?: { paymentId?: string | null }
): Promise<boolean> {
  const { data } = await supabase
    .from("bookings")
    .update({ status: "confirmed" })
    .eq("id", bookingId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!data) return false;

  const ctx = await loadMailContext(supabase, bookingId);
  await logAudit(supabase, {
    action: "booking.confirmed",
    targetType: "booking",
    targetId: bookingId,
    ownerProfileId: ctx?.owner_profile_id ?? null,
    actorType: "system",
    actorLabel: "payment verification",
    metadata: {
      via: "verified_payment",
      payment_id: opts?.paymentId ?? null,
      booker_email: ctx?.booker_email ?? null,
    },
  });

  // Linked provider calendar event (best effort, status visible on booking).
  await syncBookingToCalendars(supabase, bookingId);

  await sendConfirmationForBooking(supabase, bookingId);
  return true;
}

/** Cancel-side calendar cleanup shared by guest + host flows. */
export async function cleanupSyncedBooking(
  supabase: SupabaseClient,
  bookingId: string
): Promise<void> {
  await deleteSyncedBooking(supabase, bookingId);
}

/** Reschedule notification (old → new time, both with timezone). */
export async function sendRescheduledForBooking(
  supabase: SupabaseClient,
  bookingId: string,
  oldStartsAtIso: string
): Promise<void> {
  try {
    if (!isEmailConfigured()) return;
    const ctx = await loadMailContext(supabase, bookingId);
    if (!ctx) return;
    const mail = bookingRescheduledEmail({
      hostName: ctx.host_name,
      eventTitle: ctx.event_title,
      whenText: formatWhen(ctx.starts_at, ctx.booker_timezone),
      oldWhenText: formatWhen(oldStartsAtIso, ctx.booker_timezone),
      newWhenText: formatWhen(ctx.starts_at, ctx.booker_timezone),
      bookerName: ctx.booker_name,
      meetingUrl: ctx.meeting_url,
      cancelUrl: cancelUrlFor(ctx.cancel_token),
    });
    const sent = await sendEmail({
      to: ctx.booker_email,
      subject: mail.subject,
      html: mail.html,
    });
    await logNotification(supabase, {
      bookingId: ctx.id,
      template: "booking_rescheduled",
      recipient: ctx.booker_email,
      providerId: sent.providerId ?? null,
      ok: sent.ok,
      error: sent.error ?? null,
    });
  } catch (e) {
    console.error("Reschedule email failed:", e);
  }
}

/** Sweep stale payment holds to 'expired' so their slots release. */
export async function expireStaleHolds(
  supabase: SupabaseClient
): Promise<number> {
  const cutoff = new Date(
    Date.now() - PAYMENT_HOLD_MINUTES * 60_000
  ).toISOString();
  const { data: stale, error } = await supabase
    .from("bookings")
    .select("id, booker_email, event_types!inner(owner_profile_id)")
    .eq("status", "pending")
    .lt("created_at", cutoff)
    .limit(500);
  if (error) {
    console.error("Hold expiry sweep failed:", error);
    return 0;
  }
  if (!stale?.length) return 0;

  const ids = stale.map((s) => s.id as string);
  const { error: updateError } = await supabase
    .from("bookings")
    .update({ status: "expired" })
    .in("id", ids)
    .eq("status", "pending");
  if (updateError) {
    console.error("Hold expiry update failed:", updateError);
    return 0;
  }

  for (const s of stale) {
    const et = s.event_types as unknown as { owner_profile_id: string };
    await logAudit(supabase, {
      action: "booking.hold_expired",
      targetType: "booking",
      targetId: s.id as string,
      ownerProfileId: et.owner_profile_id,
      actorType: "system",
      metadata: { booker_email: s.booker_email as string },
    });
  }
  return stale.length;
}
