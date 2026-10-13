"use server";

import { createClient } from "@/lib/supabase/server";
import {
  generateSlots,
  toDateStrInTz,
  type WeeklyHours,
  type ScheduleOverride,
} from "@/lib/scheduling";
import {
  sendEmail,
  bookingConfirmationEmail,
  isEmailConfigured,
} from "@/lib/integrations/email";
import {
  createRazorpayOrder,
  isPaymentsConfigured,
  verifyPaymentSignature,
} from "@/lib/integrations/payments";
import { createServiceClient } from "@/lib/supabase/server";

interface SlotContext {
  id: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  min_notice_hours: number;
  max_ahead_days: number;
  max_bookings_per_day: number | null;
  price_paise: number;
  currency: string;
  meeting_provider: string;
  hostTimezone: string;
  weeklyHours: WeeklyHours;
  overrides: ScheduleOverride[];
}

async function getSlotContext(eventTypeId: string): Promise<SlotContext | null> {
  const supabase = await createClient();

  const { data: et } = await supabase
    .from("event_types")
    .select(
      "id, duration_minutes, buffer_before_minutes, buffer_after_minutes, min_notice_hours, max_ahead_days, max_bookings_per_day, price_paise, currency, meeting_provider, schedule_id"
    )
    .eq("id", eventTypeId)
    .eq("is_active", true)
    .eq("is_private", false)
    .maybeSingle();
  if (!et) return null;

  let hostTimezone = "Asia/Kolkata";
  let weeklyHours: WeeklyHours = {};
  let overrides: ScheduleOverride[] = [];

  if (et.schedule_id) {
    const { data: s } = await supabase
      .from("availability_schedules")
      .select("timezone, weekly_hours")
      .eq("id", et.schedule_id)
      .maybeSingle();
    if (s) {
      hostTimezone = s.timezone ?? hostTimezone;
      weeklyHours = (s.weekly_hours ?? {}) as WeeklyHours;
      const { data: ov } = await supabase
        .from("schedule_overrides")
        .select("date, is_unavailable, windows")
        .eq("schedule_id", et.schedule_id);
      overrides = (ov ?? []).map((o) => ({
        date: o.date as string,
        is_unavailable: o.is_unavailable as boolean,
        windows: (o.windows ?? []) as ScheduleOverride["windows"],
      }));
    }
  }

  return {
    id: et.id,
    duration_minutes: et.duration_minutes,
    buffer_before_minutes: et.buffer_before_minutes,
    buffer_after_minutes: et.buffer_after_minutes,
    min_notice_hours: Number(et.min_notice_hours),
    max_ahead_days: et.max_ahead_days,
    max_bookings_per_day: et.max_bookings_per_day,
    price_paise: et.price_paise,
    currency: et.currency ?? "INR",
    meeting_provider: et.meeting_provider,
    hostTimezone,
    weeklyHours,
    overrides,
  };
}

async function bookedRanges(
  eventTypeId: string,
  fromIso: string,
  toIso: string
): Promise<{ starts_at: string; ends_at: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_booked_ranges", {
    p_event_type_id: eventTypeId,
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw new Error("Could not load availability.");
  return (data ?? []) as { starts_at: string; ends_at: string }[];
}

/** Dates in a month (1-12) that have at least one bookable slot. */
export async function getMonthAvailability(
  eventTypeId: string,
  year: number,
  month: number
): Promise<Record<string, number>> {
  const ctx = await getSlotContext(eventTypeId);
  if (!ctx) return {};

  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const fromIso = `${year}-${mm}-01T00:00:00Z`;
  const toIso = `${year}-${mm}-${String(lastDay).padStart(2, "0")}T23:59:59Z`;
  const ranges = await bookedRanges(eventTypeId, fromIso, toIso);

  const result: Record<string, number> = {};
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${mm}-${String(d).padStart(2, "0")}`;
    const slots = generateSlots({
      dateStr,
      hostTimezone: ctx.hostTimezone,
      weeklyHours: ctx.weeklyHours,
      overrides: ctx.overrides,
      durationMin: ctx.duration_minutes,
      bufferBeforeMin: ctx.buffer_before_minutes,
      bufferAfterMin: ctx.buffer_after_minutes,
      existingBookings: ranges,
      minNoticeHours: ctx.min_notice_hours,
      maxBookingsPerDay: ctx.max_bookings_per_day,
    });
    if (slots.length > 0) result[dateStr] = slots.length;
  }
  return result;
}

/** Bookable slot start instants (ISO) for one host-timezone date. */
export async function getSlotsForDate(
  eventTypeId: string,
  dateStr: string
): Promise<string[]> {
  const ctx = await getSlotContext(eventTypeId);
  if (!ctx) return [];

  const ranges = await bookedRanges(
    eventTypeId,
    `${dateStr}T00:00:00Z`,
    `${dateStr}T23:59:59Z`
  );
  const slots = generateSlots({
    dateStr,
    hostTimezone: ctx.hostTimezone,
    weeklyHours: ctx.weeklyHours,
    overrides: ctx.overrides,
    durationMin: ctx.duration_minutes,
    bufferBeforeMin: ctx.buffer_before_minutes,
    bufferAfterMin: ctx.buffer_after_minutes,
    existingBookings: ranges,
    minNoticeHours: ctx.min_notice_hours,
    maxBookingsPerDay: ctx.max_bookings_per_day,
  });
  return slots.map((s) => s.toISOString());
}

export interface CreateBookingInput {
  eventTypeId: string;
  startsAtIso: string;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  bookerTimezone: string;
  idempotencyKey: string;
}

export interface BookingResult {
  startsAtIso: string;
  endsAtIso: string;
  payment?: {
    orderId: string;
    keyId: string;
    amount: number;
    currency: string;
  };
}

export async function createBooking(
  input: CreateBookingInput
): Promise<BookingResult> {
  const supabase = await createClient();
  const ctx = await getSlotContext(input.eventTypeId);
  if (!ctx) throw new Error("This event is no longer available.");

  // Re-validate the requested slot against live data (anti double-book).
  const dateStr = toDateStrInTz(new Date(input.startsAtIso), ctx.hostTimezone);
  const ranges = await bookedRanges(
    input.eventTypeId,
    `${dateStr}T00:00:00Z`,
    `${dateStr}T23:59:59Z`
  );
  const slots = generateSlots({
    dateStr,
    hostTimezone: ctx.hostTimezone,
    weeklyHours: ctx.weeklyHours,
    overrides: ctx.overrides,
    durationMin: ctx.duration_minutes,
    bufferBeforeMin: ctx.buffer_before_minutes,
    bufferAfterMin: ctx.buffer_after_minutes,
    existingBookings: ranges,
    minNoticeHours: ctx.min_notice_hours,
    maxBookingsPerDay: ctx.max_bookings_per_day,
  });
  const wanted = new Date(input.startsAtIso).toISOString();
  if (!slots.some((s) => s.toISOString() === wanted)) {
    throw new Error("That time was just taken — please pick another slot.");
  }

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Please provide your name and a valid email.");
  }

  const startsAt = new Date(wanted);
  const endsAt = new Date(startsAt.getTime() + ctx.duration_minutes * 60000);

  const { data, error } = await supabase
    .from("bookings")
    .insert({
      event_type_id: ctx.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      timezone: ctx.hostTimezone,
      booker_name: name,
      booker_email: email,
      booker_phone: input.phone?.trim() || null,
      booker_notes: input.notes?.trim() || null,
      booker_timezone: input.bookerTimezone,
      meeting_provider: ctx.meeting_provider,
      idempotency_key: input.idempotencyKey,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(
        "This booking was already received — check your email for the confirmation."
      );
    }
    throw new Error("Could not create the booking. Please try again.");
  }

  const result: BookingResult = {
    startsAtIso: startsAt.toISOString(),
    endsAtIso: endsAt.toISOString(),
  };

  if (ctx.price_paise > 0) {
    let providerOrderId: string | null = null;
    if (isPaymentsConfigured()) {
      try {
        const order = await createRazorpayOrder({
          amountPaise: ctx.price_paise,
          currency: ctx.currency,
          receipt: `bk_${data.id.slice(0, 8)}_${Date.now().toString(36)}`,
          notes: { booking_id: data.id },
        });
        providerOrderId = order.id;
        result.payment = {
          orderId: order.id,
          keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
          amount: order.amount,
          currency: order.currency,
        };
      } catch (e) {
        // Order creation failed — keep the booking, host follows up manually.
        console.error("Razorpay order failed:", e);
      }
    }
    // Placeholder row; checkout or webhook moves it to captured.
    await supabase.from("payments").insert({
      booking_id: data.id,
      provider: "razorpay",
      amount_paise: ctx.price_paise,
      currency: ctx.currency,
      status: "pending",
      provider_order_id: providerOrderId,
      idempotency_key: input.idempotencyKey,
    });
  }

  // Confirmation email — never fails the booking.
  try {
    if (isEmailConfigured()) {
      const { data: meta } = await supabase
        .from("event_types")
        .select("title, owner_profile_id")
        .eq("id", ctx.id)
        .maybeSingle();
      const title = meta?.title ?? "Booking";
      let hostName = "your host";
      if (meta?.owner_profile_id) {
        const { data: host } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", meta.owner_profile_id)
          .maybeSingle();
        if (host?.display_name) hostName = host.display_name;
      }
      const whenText = new Intl.DateTimeFormat("en-IN", {
        timeZone: input.bookerTimezone,
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(startsAt);
      const mail = bookingConfirmationEmail({
        hostName,
        eventTitle: title,
        whenText,
        bookerName: name,
      });
      const sent = await sendEmail({
        to: email,
        subject: mail.subject,
        html: mail.html,
      });
      await supabase.rpc("log_notification", {
        p_booking_id: data.id,
        p_channel: "email",
        p_template: "booking_confirmation",
        p_recipient: email,
        p_provider: "resend",
        p_provider_id: sent.providerId ?? null,
        p_status: sent.ok ? "sent" : "failed",
        p_error: sent.error ?? null,
      });
    }
  } catch (e) {
    console.error("Confirmation email failed:", e);
  }

  return result;
}

/**
 * Called by the browser after Razorpay Checkout succeeds.
 * The cryptographic signature proves the payment happened; only then
 * do we mark the payment captured (service role, never trust the client).
 */
export async function confirmRazorpayPayment(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): Promise<{ ok: boolean }> {
  if (
    !verifyPaymentSignature({
      orderId: input.orderId,
      paymentId: input.paymentId,
      signature: input.signature,
    })
  ) {
    throw new Error("Payment verification failed. Contact the host.");
  }
  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("payments")
    .update({ status: "captured", provider_payment_id: input.paymentId })
    .eq("provider_order_id", input.orderId)
    .eq("status", "pending");
  if (error) throw new Error("Could not record the payment.");
  return { ok: true };
}
