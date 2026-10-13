"use server";

import { createClient } from "@/lib/supabase/server";
import {
  generateSlots,
  toDateStrInTz,
  type WeeklyHours,
  type ScheduleOverride,
} from "@/lib/scheduling";
import {
  createRazorpayOrder,
  isPaymentsConfigured,
  verifyPaymentSignature,
} from "@/lib/integrations/payments";
import { createServiceClient } from "@/lib/supabase/server";
import {
  finalizePaidBooking,
  queueConfirmSequence,
} from "@/lib/booking-lifecycle";
import { triggerWebhooks } from "@/lib/webhooks";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

interface HostSlotSource {
  profileId: string;
  displayName: string | null;
  hostTimezone: string;
  weeklyHours: WeeklyHours;
  overrides: ScheduleOverride[];
}

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
  ownerProfileId: string;
  schedulingMode: "single" | "round_robin" | "collective";
  /** Availability sources. Single mode: exactly one (the owner). */
  hosts: HostSlotSource[];
}

export async function getSlotContext(
  eventTypeId: string
): Promise<SlotContext | null> {
  const supabase = await createClient();

  const { data: et } = await supabase
    .from("event_types")
    .select(
      "id, duration_minutes, buffer_before_minutes, buffer_after_minutes, min_notice_hours, max_ahead_days, max_bookings_per_day, price_paise, currency, meeting_provider, schedule_id, owner_profile_id, scheduling_mode"
    )
    .eq("id", eventTypeId)
    .eq("is_active", true)
    .maybeSingle();
  // Note: no is_private filter — secret events are bookable via direct
  // link or embed (the URL is the secret).
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

  const schedulingMode = (
    (et.scheduling_mode as string) === "round_robin" ||
    (et.scheduling_mode as string) === "collective"
      ? et.scheduling_mode
      : "single"
  ) as "single" | "round_robin" | "collective";

  // Availability sources. Single mode: just the owner. Team modes: every
  // assigned host, each with their own schedule (falling back to the
  // event's schedule when a host hasn't set one up).
  const hosts: HostSlotSource[] = [
    {
      profileId: et.owner_profile_id as string,
      displayName: null,
      hostTimezone,
      weeklyHours,
      overrides,
    },
  ];

  if (schedulingMode !== "single") {
    const { data: hostRows } = await supabase
      .from("event_type_hosts")
      .select("profile_id, position, profiles(display_name)")
      .eq("event_type_id", eventTypeId)
      .order("position");
    if (hostRows?.length) {
      const teamHosts: HostSlotSource[] = [];
      for (const h of hostRows) {
        const pid = h.profile_id as string;
        const prof = h.profiles as unknown as {
          display_name: string | null;
        } | null;
        // Each host's own default schedule.
        const { data: hs } = await supabase
          .from("availability_schedules")
          .select("id, timezone, weekly_hours")
          .eq("owner_profile_id", pid)
          .order("created_at")
          .limit(1)
          .maybeSingle();
        let hTz = hostTimezone;
        let hHours = weeklyHours;
        let hOverrides = overrides;
        if (hs) {
          hTz = (hs.timezone as string) ?? hTz;
          hHours = ((hs.weekly_hours ?? {}) as WeeklyHours) ?? hHours;
          const { data: hov } = await supabase
            .from("schedule_overrides")
            .select("date, is_unavailable, windows")
            .eq("schedule_id", hs.id);
          if (hov?.length) {
            hOverrides = hov.map((o) => ({
              date: o.date as string,
              is_unavailable: o.is_unavailable as boolean,
              windows: (o.windows ?? []) as ScheduleOverride["windows"],
            }));
          }
        }
        teamHosts.push({
          profileId: pid,
          displayName: prof?.display_name ?? null,
          hostTimezone: hTz,
          weeklyHours: hHours,
          overrides: hOverrides,
        });
      }
      // If hosts are configured, they replace the single-owner source.
      // (The owner is included only if explicitly assigned.)
      hosts.length = 0;
      hosts.push(...teamHosts);
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
    ownerProfileId: et.owner_profile_id as string,
    schedulingMode,
    hosts,
  };
}

async function bookedRanges(
  eventTypeId: string,
  fromIso: string,
  toIso: string,
  ownerProfileId?: string,
  excludeRange?: { starts_at: string; ends_at: string }
): Promise<{ starts_at: string; ends_at: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_booked_ranges", {
    p_event_type_id: eventTypeId,
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw new Error("Could not load availability.");
  let ranges = (data ?? []) as { starts_at: string; ends_at: string }[];
  if (excludeRange) {
    ranges = ranges.filter(
      (r) =>
        !(
          r.starts_at === excludeRange.starts_at &&
          r.ends_at === excludeRange.ends_at
        )
    );
  }

  // Merge external busy blocks from connected calendars (spec §8.2).
  // Provider outage degrades to BookFlow-only availability — never a
  // broken page.
  if (ownerProfileId) {
    try {
      const { getHostBusyBlocks } = await import(
        "@/lib/integrations/calendar"
      );
      const busy = await getHostBusyBlocks(
        supabase,
        ownerProfileId,
        fromIso,
        toIso
      );
      ranges.push(...busy);
    } catch (e) {
      console.error("External busy-time merge failed:", e);
    }
  }
  return ranges;
}

/** Privacy-preserving busy ranges for one host (all their bookings). */
async function hostBusyRanges(
  profileId: string,
  fromIso: string,
  toIso: string
): Promise<{ starts_at: string; ends_at: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_host_busy_ranges", {
    p_profile_id: profileId,
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw new Error("Could not load availability.");
  return (data ?? []) as { starts_at: string; ends_at: string }[];
}

/** Bookable slots for ONE host on a date (their schedule + their busy). */
async function getHostSlotsForDate(
  ctx: SlotContext,
  host: HostSlotSource,
  dateStr: string,
  excludeRange?: { starts_at: string; ends_at: string }
): Promise<Date[]> {
  const supabase = await createClient();
  const { getHostBusyBlocks } = await import("@/lib/integrations/calendar");

  const fromIso = `${dateStr}T00:00:00Z`;
  const toIso = `${dateStr}T23:59:59Z`;
  let ranges = await hostBusyRanges(host.profileId, fromIso, toIso);
  if (excludeRange) {
    ranges = ranges.filter(
      (r) =>
        !(
          r.starts_at === excludeRange.starts_at &&
          r.ends_at === excludeRange.ends_at
        )
    );
  }
  // External busy blocks for this host (fail-safe: outage → no blocks).
  try {
    const busy = await getHostBusyBlocks(supabase, host.profileId, fromIso, toIso);
    ranges.push(...busy);
  } catch (e) {
    console.error("External busy-time merge failed:", e);
  }

  return generateSlots({
    dateStr,
    hostTimezone: host.hostTimezone,
    weeklyHours: host.weeklyHours,
    overrides: host.overrides,
    durationMin: ctx.duration_minutes,
    bufferBeforeMin: ctx.buffer_before_minutes,
    bufferAfterMin: ctx.buffer_after_minutes,
    existingBookings: ranges,
    minNoticeHours: ctx.min_notice_hours,
    maxBookingsPerDay: ctx.max_bookings_per_day,
  });
}

/**
 * Merged bookable slots for a date across all availability sources.
 * - single: the owner's slots (unchanged behavior).
 * - round_robin: union — bookable if ANY host is free.
 * - collective: intersection — bookable only if ALL hosts are free.
 */
async function getMergedSlotsForDate(
  ctx: SlotContext,
  dateStr: string,
  excludeRange?: { starts_at: string; ends_at: string }
): Promise<Date[]> {
  const perHost: Date[][] = [];
  for (const h of ctx.hosts) {
    perHost.push(await getHostSlotsForDate(ctx, h, dateStr, excludeRange));
  }

  if (ctx.schedulingMode === "collective" && perHost.length > 0) {
    const sets = perHost.map(
      (slots) => new Set(slots.map((d) => d.toISOString()))
    );
    return perHost[0].filter((d) =>
      sets.every((set) => set.has(d.toISOString()))
    );
  }
  // single + round_robin: union, deduped, chronological.
  const seen = new Map<string, Date>();
  for (const slots of perHost) {
    for (const d of slots) seen.set(d.toISOString(), d);
  }
  return [...seen.values()].sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Round-robin assignment: among hosts free at the wanted instant, pick the
 * one with the fewest confirmed bookings in the last 30 days (fair
 * distribution). Ties break by host position.
 */
export async function pickRoundRobinHost(
  ctx: SlotContext,
  startsAtIso: string
): Promise<string | null> {
  const wanted = new Date(startsAtIso).toISOString();
  const dateStr = toDateStrInTz(new Date(startsAtIso), ctx.hostTimezone);
  const freeHosts: HostSlotSource[] = [];
  for (const h of ctx.hosts) {
    const slots = await getHostSlotsForDate(ctx, h, dateStr);
    if (slots.some((s) => s.toISOString() === wanted)) freeHosts.push(h);
  }
  if (freeHosts.length === 0) return null;

  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  let best: HostSlotSource | null = null;
  let bestCount = Number.MAX_SAFE_INTEGER;
  for (const h of freeHosts) {
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("event_type_id", ctx.id)
      .eq("assigned_profile_id", h.profileId)
      .eq("status", "confirmed")
      .gte("created_at", since);
    const c = count ?? 0;
    if (c < bestCount) {
      bestCount = c;
      best = h;
    }
  }
  return best?.profileId ?? freeHosts[0].profileId;
}

/** Public questions for an event type (RLS: active events). */
export async function getEventQuestions(
  eventTypeId: string
): Promise<
  {
    id: string;
    label: string;
    field_type: string;
    is_required: boolean;
    options: string[];
  }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("event_type_questions")
    .select("id, label, field_type, is_required, options")
    .eq("event_type_id", eventTypeId)
    .order("position");
  return ((data ?? []) as unknown as {
    id: string;
    label: string;
    field_type: string;
    is_required: boolean;
    options: string[];
  }[]).map((q) => ({ ...q, options: (q.options ?? []) as string[] }));
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

  const result: Record<string, number> = {};
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${mm}-${String(d).padStart(2, "0")}`;
    const slots = await getMergedSlotsForDate(ctx, dateStr);
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

  const slots = await getMergedSlotsForDate(ctx, dateStr);
  return slots.map((s) => s.toISOString());
}

/**
 * Re-validates a requested start instant against live availability
 * (spec §5.3). Throws when the slot is not bookable. Shared by booking
 * creation and rescheduling so both use the same availability engine.
 */
export async function validateSlotAvailable(
  eventTypeId: string,
  startsAtIso: string,
  excludeRange?: { starts_at: string; ends_at: string }
): Promise<SlotContext> {
  const ctx = await getSlotContext(eventTypeId);
  if (!ctx) throw new Error("This event is no longer available.");
  const dateStr = toDateStrInTz(new Date(startsAtIso), ctx.hostTimezone);
  const slots = await getMergedSlotsForDate(ctx, dateStr, excludeRange);
  const wanted = new Date(startsAtIso).toISOString();
  if (!slots.some((s) => s.toISOString() === wanted)) {
    throw new Error("That time is not available — please pick another slot.");
  }
  return ctx;
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
  questionAnswers?: Record<string, string>;
}

export interface BookingResult {
  startsAtIso: string;
  endsAtIso: string;
  /** "pending" = 30-min payment hold; "confirmed" = no payment required. */
  status: "pending" | "confirmed";
  /** Unguessable guest self-service token for /b/cancel/[token]. */
  cancelToken: string;
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
  await enforceRateLimit("booking:create", 10, 60_000);
  const supabase = await createClient();
  // Re-validate the requested slot against live data (anti double-book).
  const ctx = await validateSlotAvailable(input.eventTypeId, input.startsAtIso);
  const wanted = new Date(input.startsAtIso).toISOString();

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Please provide your name and a valid email.");
  }

  const startsAt = new Date(wanted);
  const endsAt = new Date(startsAt.getTime() + ctx.duration_minutes * 60000);

  // Validate custom question answers (required + option allowlist).
  const questions = await getEventQuestions(input.eventTypeId);
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const raw = (input.questionAnswers?.[q.id] ?? "").trim();
    if (q.is_required && !raw) {
      throw new Error(`Please answer: ${q.label}`);
    }
    if (raw) {
      if (
        (q.field_type === "select" || q.field_type === "radio") &&
        q.options.length > 0 &&
        !q.options.includes(raw)
      ) {
        throw new Error(`Invalid answer for: ${q.label}`);
      }
      answers[q.id] = raw.slice(0, 2000);
    }
  }

  // Host assignment for team events (spec §5).
  let assignedProfileId: string | null = null;
  if (ctx.schedulingMode === "round_robin") {
    assignedProfileId = await pickRoundRobinHost(ctx, wanted);
    if (!assignedProfileId) {
      throw new Error("That time is not available — please pick another slot.");
    }
  } else if (ctx.schedulingMode === "single") {
    assignedProfileId = ctx.ownerProfileId;
  }
  // collective → null (all hosts).

  // Paid events start as a pending hold; they confirm only after verified
  // payment (spec §7.1). Free events — or paid events while Razorpay is not
  // configured (host follows up manually) — confirm immediately.
  const needsPayment = ctx.price_paise > 0 && isPaymentsConfigured();

  const { data, error } = await supabase
    .from("bookings")
    .insert({
      event_type_id: ctx.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      timezone: ctx.hostTimezone,
      status: needsPayment ? "pending" : "confirmed",
      assigned_profile_id: assignedProfileId,
      question_answers: answers,
      booker_name: name,
      booker_email: email,
      booker_phone: input.phone?.trim() || null,
      booker_notes: input.notes?.trim() || null,
      booker_timezone: input.bookerTimezone,
      meeting_provider: ctx.meeting_provider,
      idempotency_key: input.idempotencyKey,
    })
    .select("id, cancel_token")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(
        "This booking was already received — check your email for the confirmation."
      );
    }
    if (error.code === "23P01") {
      // Exclusion constraint: a concurrent booking won the race.
      throw new Error("That time was just taken — please pick another slot.");
    }
    throw new Error("Could not create the booking. Please try again.");
  }

  const result: BookingResult = {
    startsAtIso: startsAt.toISOString(),
    endsAtIso: endsAt.toISOString(),
    status: needsPayment ? "pending" : "confirmed",
    cancelToken: data.cancel_token as string,
  };

  await logAudit(supabase, {
    action: "booking.created",
    targetType: "booking",
    targetId: data.id as string,
    ownerProfileId: ctx.ownerProfileId,
    actorType: "guest",
    actorLabel: email,
    metadata: {
      event_type_id: ctx.id,
      starts_at: startsAt.toISOString(),
      status: result.status,
    },
  });

  if (needsPayment) {
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

  // Durable confirm sequence (calendar sync → confirmation email) for free
  // events. Paid events get it when payment is verified (finalizePaidBooking).
  if (!needsPayment) {
    await queueConfirmSequence(supabase, data.id);
  }

  await triggerWebhooks(supabase, ctx.ownerProfileId, "booking.created", {
    booking_id: data.id,
    event_type_id: input.eventTypeId,
    starts_at: input.startsAtIso,
    booker_email: input.email,
    status: needsPayment ? "pending" : "confirmed",
  });

  // Workflows: user-defined automations (trigger → action).
  const { fireWorkflowTrigger } = await import("@/lib/workflows");
  await fireWorkflowTrigger(supabase, "booking.created", {
    id: data.id,
    owner_profile_id: ctx.ownerProfileId,
    booker_name: name,
    booker_email: email,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
  });

  return result;
}

/**
 * Called by the browser after Razorpay Checkout succeeds.
 * The cryptographic signature proves the payment happened; only then do we
 * mark the payment captured AND flip the booking pending → confirmed
 * (service role, never trust the client). Idempotent.
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

  const { data: payment } = await supabase
    .from("payments")
    .select("id, booking_id, status")
    .eq("provider_order_id", input.orderId)
    .maybeSingle();
  if (!payment) throw new Error("Payment record not found. Contact the host.");
  if (payment.status === "captured") {
    // Idempotent retry — make sure the booking followed.
    await finalizePaidBooking(supabase, payment.booking_id as string);
    return { ok: true };
  }

  const { error } = await supabase
    .from("payments")
    .update({ status: "captured", provider_payment_id: input.paymentId })
    .eq("id", payment.id)
    .eq("status", "pending");
  if (error) throw new Error("Could not record the payment.");

  const transitioned = await finalizePaidBooking(
    supabase,
    payment.booking_id as string
  );
  if (!transitioned) {
    const { data: b } = await supabase
      .from("bookings")
      .select("status")
      .eq("id", payment.booking_id)
      .maybeSingle();
    if (b?.status === "expired") {
      throw new Error(
        "Your 30-minute payment hold expired before the payment completed. Please book again — you were not charged for the hold."
      );
    }
  }
  return { ok: true };
}
