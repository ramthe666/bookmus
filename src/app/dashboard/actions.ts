"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureDefaultSchedule } from "@/lib/scheduling";
import { logAudit } from "@/lib/audit";
import {
  cleanupSyncedBooking,
  queueCancellationEmail,
  queueRescheduledEmail,
  queueCalendarSyncUpdate,
} from "@/lib/booking-lifecycle";
import { validateSlotAvailable } from "@/app/u/actions";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function num(v: FormDataEntryValue | null, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ── Event types ──────────────────────────────────────────────────── */

export async function createEventType(formData: FormData) {
  const { supabase, user } = await requireUser();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title is required");
  const slug = slugify(String(formData.get("slug") ?? "") || title);
  if (!slug) throw new Error("Slug is required");

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .single();
  const schedule = await ensureDefaultSchedule(
    supabase,
    user.id,
    profile?.timezone ?? "Asia/Kolkata"
  );

  const priceRupees = num(formData.get("price_rupees"), 0);

  const { error } = await supabase.from("event_types").insert({
    owner_profile_id: user.id,
    title,
    slug,
    description: String(formData.get("description") ?? "") || null,
    duration_minutes: Math.max(5, num(formData.get("duration_minutes"), 30)),
    buffer_before_minutes: Math.max(0, num(formData.get("buffer_before_minutes"))),
    buffer_after_minutes: Math.max(0, num(formData.get("buffer_after_minutes"))),
    min_notice_hours: Math.max(0, num(formData.get("min_notice_hours"))),
    max_ahead_days: Math.max(1, num(formData.get("max_ahead_days"), 60)),
    max_bookings_per_day: formData.get("max_bookings_per_day")
      ? Math.max(1, num(formData.get("max_bookings_per_day")))
      : null,
    price_paise: Math.round(priceRupees * 100),
    currency: "INR",
    location_type: String(formData.get("location_type") ?? "video"),
    meeting_provider: String(formData.get("meeting_provider") ?? "google_meet"),
    color: String(formData.get("color") ?? "#4f46e5"),
    is_active: formData.get("is_active") === "on",
    schedule_id: schedule.id,
  });

  if (error) {
    if (error.code === "23505") throw new Error("That URL slug is already taken.");
    throw new Error(error.message);
  }
  revalidatePath("/dashboard/event-types");
  redirect("/dashboard/event-types");
}

export async function updateEventType(id: string, formData: FormData) {
  const { supabase, user } = await requireUser();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title is required");
  const priceRupees = num(formData.get("price_rupees"), 0);

  const { error } = await supabase
    .from("event_types")
    .update({
      title,
      slug: slugify(String(formData.get("slug") ?? "") || title),
      description: String(formData.get("description") ?? "") || null,
      duration_minutes: Math.max(5, num(formData.get("duration_minutes"), 30)),
      buffer_before_minutes: Math.max(0, num(formData.get("buffer_before_minutes"))),
      buffer_after_minutes: Math.max(0, num(formData.get("buffer_after_minutes"))),
      min_notice_hours: Math.max(0, num(formData.get("min_notice_hours"))),
      max_ahead_days: Math.max(1, num(formData.get("max_ahead_days"), 60)),
      max_bookings_per_day: formData.get("max_bookings_per_day")
        ? Math.max(1, num(formData.get("max_bookings_per_day")))
        : null,
      price_paise: Math.round(priceRupees * 100),
      location_type: String(formData.get("location_type") ?? "video"),
      meeting_provider: String(formData.get("meeting_provider") ?? "google_meet"),
      color: String(formData.get("color") ?? "#4f46e5"),
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id)
    .eq("owner_profile_id", user.id);

  if (error) {
    if (error.code === "23505") throw new Error("That URL slug is already taken.");
    throw new Error(error.message);
  }
  revalidatePath("/dashboard/event-types");
  redirect("/dashboard/event-types");
}

export async function deleteEventType(id: string) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("event_types")
    .delete()
    .eq("id", id)
    .eq("owner_profile_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/event-types");
}

export async function toggleEventType(id: string, isActive: boolean) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("event_types")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("owner_profile_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/event-types");
}

/* ── Availability ─────────────────────────────────────────────────── */

export async function saveAvailability(formData: FormData) {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .single();

  const schedule = await ensureDefaultSchedule(
    supabase,
    user.id,
    profile?.timezone ?? "Asia/Kolkata"
  );

  const weeklyHours: Record<string, { start: string; end: string }[]> = {};
  for (let d = 1; d <= 7; d++) {
    if (formData.get(`day_${d}_enabled`) === "on") {
      const start = String(formData.get(`day_${d}_start`) ?? "09:00");
      const end = String(formData.get(`day_${d}_end`) ?? "17:00");
      if (start < end) weeklyHours[String(d)] = [{ start, end }];
    }
  }

  const { error } = await supabase
    .from("availability_schedules")
    .update({ weekly_hours: weeklyHours })
    .eq("id", schedule.id)
    .eq("owner_profile_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/availability");
}

/* ── Bookings ─────────────────────────────────────────────────────── */

export async function cancelBooking(id: string) {
  const { supabase, user } = await requireUser();

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, booker_name, booker_email, booker_timezone, event_types!inner(title)"
    )
    .eq("id", id)
    .maybeSingle();

  // RLS "event owners can update bookings" enforces ownership.
  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await logAudit(supabase, {
    action: "booking.cancelled",
    targetType: "booking",
    targetId: id,
    ownerProfileId: user.id,
    actorProfileId: user.id,
    actorType: "user",
    metadata: {
      via: "dashboard",
      booker_email: (booking?.booker_email as string | undefined) ?? null,
    },
  });
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard");

  // Durable side effects via the outbox: calendar cleanup + guest
  // notification. The worker sends with retries; nothing is lost on crash.
  await cleanupSyncedBooking(supabase, id);
  await queueCancellationEmail(supabase, id);
}

/**
 * Host reschedule (spec §7.3). Same availability engine as booking;
 * the booking's own slot is excluded from the conflict check. The linked
 * provider event is moved in place. RLS "event owners can update bookings"
 * enforces ownership.
 */
export async function rescheduleBooking(id: string, newStartsAtIso: string) {
  const { supabase, user } = await requireUser();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, status, starts_at, ends_at, booker_email, event_type_id")
    .eq("id", id)
    .maybeSingle();
  if (!booking) throw new Error("Booking not found.");
  if (booking.status !== "confirmed") {
    throw new Error("Only confirmed bookings can be rescheduled.");
  }

  const oldStartsAt = booking.starts_at as string;
  const newStart = new Date(newStartsAtIso);
  if (newStart.getTime() <= Date.now()) {
    throw new Error("The new time must be in the future.");
  }
  if (newStart.toISOString() === new Date(oldStartsAt).toISOString()) {
    return;
  }

  const ctx = await validateSlotAvailable(
    booking.event_type_id as string,
    newStartsAtIso,
    {
      starts_at: oldStartsAt,
      ends_at: booking.ends_at as string,
    }
  );
  const newEnd = new Date(newStart.getTime() + ctx.duration_minutes * 60000);

  const { error } = await supabase
    .from("bookings")
    .update({
      starts_at: newStart.toISOString(),
      ends_at: newEnd.toISOString(),
    })
    .eq("id", id)
    .eq("status", "confirmed");
  if (error) {
    if (error.code === "23P01") {
      throw new Error("That time was just taken — please pick another slot.");
    }
    throw new Error("Could not reschedule. Please try again.");
  }

  await logAudit(supabase, {
    action: "booking.rescheduled",
    targetType: "booking",
    targetId: id,
    ownerProfileId: user.id,
    actorProfileId: user.id,
    actorType: "user",
    metadata: {
      via: "dashboard",
      old_starts_at: oldStartsAt,
      new_starts_at: newStart.toISOString(),
      booker_email: (booking.booker_email as string | undefined) ?? null,
    },
  });

  // Durable side effects via the outbox.
  await queueCalendarSyncUpdate(supabase, id);
  await queueRescheduledEmail(supabase, id, oldStartsAt);

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard");
}

/* ── Profile / settings ───────────────────────────────────────────── */

export async function updateProfile(formData: FormData) {
  const { supabase, user } = await requireUser();

  const username = String(formData.get("username") ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]/g, "");
  const displayName = String(formData.get("display_name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "Asia/Kolkata");

  if (username && !/^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$/.test(username)) {
    throw new Error("Username must be 3–40 chars: letters, numbers, . _ -");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      username: username || null,
      display_name: displayName || null,
      timezone,
    })
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") throw new Error("That username is taken.");
    throw new Error(error.message);
  }

  // Keep a default schedule around so new event types attach cleanly.
  await ensureDefaultSchedule(supabase, user.id, timezone).catch(() => null);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
}
