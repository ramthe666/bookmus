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
  queueConfirmSequence,
} from "@/lib/booking-lifecycle";
import { triggerWebhooks } from "@/lib/webhooks";
import { pickRoundRobinHost, validateSlotAvailable } from "@/app/u/actions";

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

  // Workspace assignment — must be a member of the org.
  const organizationId = String(formData.get("organization_id") ?? "") || null;
  if (organizationId) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("organization_id", organizationId)
      .eq("profile_id", user.id)
      .maybeSingle();
    if (!membership) throw new Error("You are not a member of that workspace.");
  }

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

  const schedulingMode = ["round_robin", "collective"].includes(
    String(formData.get("scheduling_mode") ?? "")
  )
    ? String(formData.get("scheduling_mode"))
    : "single";
  const hostIds: string[] = JSON.parse(
    String(formData.get("host_ids") ?? "[]")
  );

  const { data: created, error } = await supabase
    .from("event_types")
    .insert({
      owner_profile_id: user.id,
      organization_id: organizationId,
      scheduling_mode: schedulingMode,
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
      max_attendees: Math.min(100, Math.max(1, num(formData.get("max_attendees"), 1))),
      cancel_cutoff_hours: Math.max(0, num(formData.get("cancel_cutoff_hours"), 24)),
      price_paise: Math.round(priceRupees * 100),
      currency: "INR",
      location_type: String(formData.get("location_type") ?? "video"),
      meeting_provider: String(formData.get("meeting_provider") ?? "google_meet"),
      color: String(formData.get("color") ?? "#4f46e5"),
      is_active: formData.get("is_active") === "on",
      is_private: formData.get("is_private") === "on",
      schedule_id: schedule.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("That URL slug is already taken.");
    throw new Error(error.message);
  }

  await syncEventHosts(supabase, created.id as string, organizationId, schedulingMode, hostIds);

  const questions: {
    label: string;
    field_type: string;
    is_required: boolean;
    options: string[];
    position: number;
  }[] = JSON.parse(String(formData.get("questions") ?? "[]"));
  await syncEventQuestions(supabase, created.id as string, questions);

  revalidatePath("/dashboard/event-types");
  redirect("/dashboard/event-types");
}

/** Replace the question set for an event type. */
async function syncEventQuestions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventTypeId: string,
  questions: {
    label: string;
    field_type: string;
    is_required: boolean;
    options: string[];
    position: number;
  }[]
) {
  // If the migration hasn't been applied yet, the table won't exist — skip
  // silently so event creation still succeeds.
  const { error: delError } = await supabase
    .from("event_type_questions")
    .delete()
    .eq("event_type_id", eventTypeId);
  if (delError) return;
  const validTypes = ["text", "textarea", "select", "radio", "phone"];
  const rows = questions
    .filter((q) => q.label.trim() && validTypes.includes(q.field_type))
    .map((q, i) => ({
      event_type_id: eventTypeId,
      label: q.label.trim().slice(0, 300),
      field_type: q.field_type,
      is_required: !!q.is_required,
      options: (q.options ?? []).slice(0, 20).map((o) => String(o).slice(0, 200)),
      position: i,
    }));
  if (rows.length) {
    const { error } = await supabase.from("event_type_questions").insert(rows);
    if (error) throw new Error(error.message);
  }
}

/** Replace the host roster for an event type (validated against org membership). */
async function syncEventHosts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventTypeId: string,
  organizationId: string | null,
  schedulingMode: string,
  hostIds: string[]
) {
  await supabase.from("event_type_hosts").delete().eq("event_type_id", eventTypeId);
  if (schedulingMode === "single" || !organizationId || !hostIds.length) return;
  const { data: members } = await supabase
    .from("organization_members")
    .select("profile_id")
    .eq("organization_id", organizationId)
    .in("profile_id", hostIds);
  const valid = new Set((members ?? []).map((m) => m.profile_id as string));
  const rows = hostIds
    .filter((id) => valid.has(id))
    .map((id, i) => ({ event_type_id: eventTypeId, profile_id: id, position: i }));
  if (rows.length) {
    await supabase.from("event_type_hosts").insert(rows);
  }
}

export async function updateEventType(id: string, formData: FormData) {
  const { supabase, user } = await requireUser();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title is required");
  const priceRupees = num(formData.get("price_rupees"), 0);

  // Workspace assignment — must be a member of the org.
  const organizationId = String(formData.get("organization_id") ?? "") || null;
  if (organizationId) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("organization_id", organizationId)
      .eq("profile_id", user.id)
      .maybeSingle();
    if (!membership) throw new Error("You are not a member of that workspace.");
  }

  const schedulingMode = ["round_robin", "collective"].includes(
    String(formData.get("scheduling_mode") ?? "")
  )
    ? String(formData.get("scheduling_mode"))
    : "single";
  const hostIds: string[] = JSON.parse(
    String(formData.get("host_ids") ?? "[]")
  );

  const { error } = await supabase
    .from("event_types")
    .update({
      title,
      organization_id: organizationId,
      scheduling_mode: schedulingMode,
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
      max_attendees: Math.min(100, Math.max(1, num(formData.get("max_attendees"), 1))),
      cancel_cutoff_hours: Math.max(0, num(formData.get("cancel_cutoff_hours"), 24)),
      price_paise: Math.round(priceRupees * 100),
      location_type: String(formData.get("location_type") ?? "video"),
      meeting_provider: String(formData.get("meeting_provider") ?? "google_meet"),
      color: String(formData.get("color") ?? "#4f46e5"),
      is_active: formData.get("is_active") === "on",
      is_private: formData.get("is_private") === "on",
    })
    .eq("id", id);
  // Ownership enforced by RLS (can_manage_event_type) — team members can
  // edit workspace event types.

  if (error) {
    if (error.code === "23505") throw new Error("That URL slug is already taken.");
    throw new Error(error.message);
  }

  await syncEventHosts(supabase, id, organizationId, schedulingMode, hostIds);

  const questions: {
    label: string;
    field_type: string;
    is_required: boolean;
    options: string[];
    position: number;
  }[] = JSON.parse(String(formData.get("questions") ?? "[]"));
  await syncEventQuestions(supabase, id, questions);

  revalidatePath("/dashboard/event-types");
  redirect("/dashboard/event-types");
}

export async function deleteEventType(id: string) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("event_types")
    .delete()
    .eq("id", id);
  // Ownership enforced by RLS (can_manage_event_type).
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
  await triggerWebhooks(supabase, user.id, "booking.cancelled", {
    booking_id: id,
    via: "dashboard",
  });
  const { fireWorkflowTrigger } = await import("@/lib/workflows");
  await fireWorkflowTrigger(supabase, "booking.cancelled", {
    id,
    owner_profile_id: user.id,
    booker_name: (booking?.booker_name as string | undefined) ?? "",
    booker_email: (booking?.booker_email as string | undefined) ?? "",
    starts_at: (booking?.starts_at as string | undefined) ?? "",
    ends_at: (booking?.starts_at as string | undefined) ?? "",
  });
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
  await triggerWebhooks(supabase, user.id, "booking.rescheduled", {
    booking_id: id,
    old_starts_at: oldStartsAt,
    new_starts_at: newStart.toISOString(),
    via: "dashboard",
  });
  const { fireWorkflowTrigger: fireRescheduled } = await import("@/lib/workflows");
  await fireRescheduled(supabase, "booking.rescheduled", {
    id,
    owner_profile_id: user.id,
    booker_name: "",
    booker_email: (booking.booker_email as string | undefined) ?? "",
    starts_at: newStart.toISOString(),
    ends_at: newEnd.toISOString(),
  });

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

/* ── Manual staff booking (spec §7.4) ─────────────────────────────────── */

/**
 * A host (or team member) creates a booking directly for a guest.
 * - Inserts as `confirmed` immediately — staff bookings never hold payment.
 * - Availability/busy-block rules may be overridden with a written reason,
 *   which is recorded in the audit trail. An actual double-book (overlapping
 *   a live confirmed/pending booking of the same event type) can NEVER be
 *   overridden — the `bookings_no_overlap` exclusion constraint rejects it.
 * - Same durable confirm sequence as guest bookings: calendar sync first,
 *   then the confirmation email.
 */
export async function createManualBooking(input: {
  eventTypeId: string;
  startsAtIso: string;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  overrideReason?: string;
}): Promise<{ bookingId: string }> {
  const { supabase, user } = await requireUser();

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!input.eventTypeId) throw new Error("Choose an event type.");
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Provide the guest's name and a valid email.");
  }
  const startsAt = new Date(input.startsAtIso);
  if (isNaN(startsAt.getTime())) throw new Error("Pick a valid time.");
  if (startsAt.getTime() <= Date.now()) {
    throw new Error("The booking must be in the future.");
  }

  // Authorization: caller must manage this event type — owner, or member of
  // its organization. Mirrors public.can_manage_event_type; RLS policies are
  // untouched (insert still passes RLS, and the booking select/update
  // policies keep applying afterwards).
  const { data: et } = await supabase
    .from("event_types")
    .select(
      "id, title, duration_minutes, owner_profile_id, organization_id"
    )
    .eq("id", input.eventTypeId)
    .maybeSingle();
  if (!et) throw new Error("Event type not found.");
  const isOwner = (et.owner_profile_id as string) === user.id;
  let isOrgMember = false;
  if (!isOwner && et.organization_id) {
    const { data: m } = await supabase
      .from("organization_members")
      .select("profile_id")
      .eq("organization_id", et.organization_id as string)
      .eq("profile_id", user.id)
      .maybeSingle();
    isOrgMember = !!m;
  }
  if (!isOwner && !isOrgMember) {
    throw new Error("You don't have access to this event type.");
  }

  // Live availability check. Failing it requires an explicit override reason;
  // before honouring the override, re-check for a real overlapping booking.
  let durationMin = Number(et.duration_minutes);
  let overridden = false;
  let liveTz: string | null = null;
  let meetingProvider: string | null = null;
  try {
    const ctx = await validateSlotAvailable(
      input.eventTypeId,
      startsAt.toISOString()
    );
    durationMin = ctx.duration_minutes;
    liveTz = ctx.hostTimezone;
    meetingProvider = ctx.meeting_provider;
  } catch {
    const reason = (input.overrideReason ?? "").trim();
    if (!reason) {
      throw new Error(
        "That time isn't bookable — add an override reason to book it anyway."
      );
    }
    const endsAt = new Date(startsAt.getTime() + durationMin * 60000);
    const { data: clash } = await supabase
      .from("bookings")
      .select("id")
      .eq("event_type_id", input.eventTypeId)
      .in("status", ["confirmed", "pending"])
      .lt("starts_at", endsAt.toISOString())
      .gt("ends_at", startsAt.toISOString())
      .limit(1);
    if (clash && clash.length > 0) {
      throw new Error(
        "That time is already booked — overrides can't double-book."
      );
    }
    overridden = true;
  }
  const endsAt = new Date(startsAt.getTime() + durationMin * 60000);

  // Host assignment mirrors the guest flow (spec §5): fair pick for
  // round-robin on live slots; an overridden slot belongs to the staffer.
  let assignedProfileId: string | null = null;
  if (!overridden) {
    const ctx = await validateSlotAvailable(
      input.eventTypeId,
      startsAt.toISOString()
    );
    if (ctx.schedulingMode === "round_robin") {
      assignedProfileId =
        (await pickRoundRobinHost(ctx, startsAt.toISOString())) ?? user.id;
    } else if (ctx.schedulingMode === "single") {
      assignedProfileId = ctx.ownerProfileId;
    }
    // collective → null (all hosts)
  } else {
    assignedProfileId = user.id;
  }

  const { data, error } = await supabase
    .from("bookings")
    .insert({
      event_type_id: input.eventTypeId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      timezone: liveTz,
      status: "confirmed",
      assigned_profile_id: assignedProfileId,
      booker_name: name,
      booker_email: email,
      booker_phone: input.phone?.trim() || null,
      booker_notes: input.notes?.trim() || null,
      meeting_provider: meetingProvider,
      idempotency_key: crypto.randomUUID(),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23P01") {
      throw new Error("That time was just taken — please pick another slot.");
    }
    throw new Error("Could not create the booking. Please try again.");
  }

  await logAudit(supabase, {
    action: "booking.created_manual",
    targetType: "booking",
    targetId: data.id as string,
    ownerProfileId: user.id,
    actorProfileId: user.id,
    actorType: "user",
    metadata: {
      via: "dashboard",
      manual: true,
      availability_overridden: overridden,
      override_reason: overridden ? (input.overrideReason ?? "").trim() : null,
      event_type_id: input.eventTypeId,
      starts_at: startsAt.toISOString(),
      booker_email: email,
    },
  });

  // Durable confirm sequence: calendar sync first (Meet link), then email.
  await queueConfirmSequence(supabase, data.id as string);
  await triggerWebhooks(supabase, user.id, "booking.created", {
    booking_id: data.id,
    event_type_id: input.eventTypeId,
    starts_at: startsAt.toISOString(),
    booker_email: email,
    status: "confirmed",
    manual: true,
  });
  const { fireWorkflowTrigger: fireManual } = await import("@/lib/workflows");
  await fireManual(supabase, "booking.created", {
    id: data.id as string,
    owner_profile_id: user.id,
    booker_name: input.name.trim(),
    booker_email: email,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
  });

  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/calendar");
  return { bookingId: data.id as string };
}
