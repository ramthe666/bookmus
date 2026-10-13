/**
 * Scheduling engine — availability windows, overrides and slot generation.
 *
 * All slot math happens in the HOST's timezone; instants are stored as UTC.
 * weekly_hours JSONB format: { "1": [{start:"09:00",end:"17:00"}], ... }
 * where keys are "1"=Monday … "7"=Sunday. A missing day means unavailable.
 */

export interface DayWindow {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export type WeeklyHours = Record<string, DayWindow[]>;

export interface ScheduleOverride {
  date: string; // YYYY-MM-DD in host timezone
  is_unavailable: boolean;
  windows: DayWindow[];
}

export interface ExistingBooking {
  starts_at: string;
  ends_at: string;
}

export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  "1": [{ start: "09:00", end: "17:00" }],
  "2": [{ start: "09:00", end: "17:00" }],
  "3": [{ start: "09:00", end: "17:00" }],
  "4": [{ start: "09:00", end: "17:00" }],
  "5": [{ start: "09:00", end: "17:00" }],
};

/* ── Timezone helpers ─────────────────────────────────────────────── */

/** Offset in minutes such that localTime = utc + offset, for a zone+instant. */
export function getTimezoneOffsetMinutes(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - date.getTime()) / 60000;
}

/** "2026-10-14" + "09:30" in `timeZone` → UTC Date. */
export function zonedTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string
): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const offset = getTimezoneOffsetMinutes(timeZone, guess);
  return new Date(guess.getTime() - offset * 60000);
}

/** UTC Date → "YYYY-MM-DD" in `timeZone`. */
export function toDateStrInTz(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(date); // en-CA yields YYYY-MM-DD
}

/** Day of week for a "YYYY-MM-DD" string: 1=Monday … 7=Sunday. */
export function dayOfWeek(dateStr: string): number {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const utcDay = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0=Sun
  return ((utcDay + 6) % 7) + 1; // 1=Mon … 7=Sun
}

export function addDaysStr(dateStr: string, n: number): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/* ── Slot generation ──────────────────────────────────────────────── */

export interface SlotOptions {
  dateStr: string; // YYYY-MM-DD in host timezone
  hostTimezone: string;
  weeklyHours: WeeklyHours;
  overrides: ScheduleOverride[];
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  existingBookings: ExistingBooking[];
  minNoticeHours: number;
  maxBookingsPerDay?: number | null;
  nowUtc?: Date;
}

/** Generate bookable slot start instants (UTC Dates) for one host-timezone day. */
export function generateSlots(opts: SlotOptions): Date[] {
  const {
    dateStr,
    hostTimezone,
    weeklyHours,
    overrides,
    durationMin,
    bufferBeforeMin,
    bufferAfterMin,
    existingBookings,
    minNoticeHours,
    maxBookingsPerDay,
    nowUtc = new Date(),
  } = opts;

  // Resolve windows: override wins over weekly template.
  const override = overrides.find((o) => o.date === dateStr);
  let windows: DayWindow[];
  if (override) {
    if (override.is_unavailable) return [];
    windows = override.windows;
  } else {
    windows = weeklyHours[String(dayOfWeek(dateStr))] ?? [];
  }
  if (windows.length === 0) return [];

  // Daily cap.
  const todaysBookings = existingBookings.filter(
    (b) => toDateStrInTz(new Date(b.starts_at), hostTimezone) === dateStr
  );
  if (maxBookingsPerDay != null && todaysBookings.length >= maxBookingsPerDay) {
    return [];
  }

  const minStart = nowUtc.getTime() + minNoticeHours * 3600_000;
  const slots: Date[] = [];

  for (const w of windows) {
    const windowEnd = zonedTimeToUtc(dateStr, w.end, hostTimezone).getTime();
    let cursor = zonedTimeToUtc(dateStr, w.start, hostTimezone).getTime();
    const step = durationMin * 60000;

    while (cursor + durationMin * 60000 <= windowEnd) {
      const slotEnd = cursor + durationMin * 60000;
      // Expand by buffers, then test against real bookings.
      const blockedStart = cursor - bufferBeforeMin * 60000;
      const blockedEnd = slotEnd + bufferAfterMin * 60000;
      const overlaps = existingBookings.some((b) => {
        const bs = new Date(b.starts_at).getTime();
        const be = new Date(b.ends_at).getTime();
        return blockedStart < be && blockedEnd > bs;
      });
      if (!overlaps && cursor >= minStart) {
        slots.push(new Date(cursor));
      }
      cursor += step;
    }
  }

  return slots.sort((a, b) => a.getTime() - b.getTime());
}

/* ── Supabase helpers ─────────────────────────────────────────────── */

/** Fetch the user's default schedule, creating a Mon–Fri 9–5 one if missing. */
export async function ensureDefaultSchedule(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  profileId: string,
  timezone: string
) {
  const { data: existing } = await supabase
    .from("availability_schedules")
    .select("id, name, timezone, weekly_hours")
    .eq("owner_profile_id", profileId)
    .limit(1)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await supabase
    .from("availability_schedules")
    .insert({
      owner_profile_id: profileId,
      name: "Working hours",
      timezone,
      weekly_hours: DEFAULT_WEEKLY_HOURS,
    })
    .select("id, name, timezone, weekly_hours")
    .single();

  if (error) throw error;
  return data;
}
