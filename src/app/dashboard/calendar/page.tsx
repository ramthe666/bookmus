import Link from "next/link";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getHostBusyBlocks } from "@/lib/integrations/calendar";

const HOUR_PX = 48;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function mondayOf(date: Date): Date {
  const d = new Date(date);
  const dow = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Minutes since midnight of `day` (in tz) for an instant. */
function minutesInDay(iso: string, day: Date, timeZone: string): number {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  void day;
  return h * 60 + m;
}

function sameYmd(iso: string, day: Date, timeZone: string): boolean {
  const d = new Date(iso);
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return ymd === toYmd(day);
}

const syncDot: Record<string, string> = {
  synced: "bg-emerald-500",
  failed: "bg-red-500",
  not_attempted: "bg-slate-300",
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  const tz = profile?.timezone ?? "Asia/Kolkata";

  const base = params.week ? new Date(`${params.week}T12:00:00`) : new Date();
  const weekStart = mondayOf(isNaN(base.getTime()) ? new Date() : base);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = addDays(weekStart, 7);

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, ends_at, status, booker_name, calendar_sync_status, event_types!inner(title)"
    )
    .gte("starts_at", weekStart.toISOString())
    .lt("starts_at", weekEnd.toISOString())
    .neq("status", "cancelled")
    .order("starts_at", { ascending: true })
    .limit(500);

  // External busy blocks (privacy-preserving: busy only, no titles).
  const svc = await createServiceClient();
  const busyBlocks = await getHostBusyBlocks(
    svc,
    user.id,
    weekStart.toISOString(),
    weekEnd.toISOString()
  );

  const prevWeek = toYmd(addDays(weekStart, -7));
  const nextWeek = toYmd(addDays(weekStart, 7));
  const weekLabel = `${days[0].toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;

  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Calendar
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {weekLabel} · {tz}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/dashboard/calendar?week=${prevWeek}`}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            ← Prev
          </Link>
          <Link
            href="/dashboard/calendar"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Today
          </Link>
          <Link
            href={`/dashboard/calendar?week=${nextWeek}`}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Next →
          </Link>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <div className="min-w-[840px]">
          {/* Day headers */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-slate-200">
            <div />
            {days.map((d, i) => (
              <div key={i} className="px-2 py-3 text-center">
                <p className="text-xs font-semibold uppercase text-slate-400">
                  {DAY_LABELS[i]}
                </p>
                <p
                  className={`mt-0.5 text-sm font-bold ${toYmd(d) === toYmd(new Date()) ? "text-indigo-600" : "text-slate-900"}`}
                >
                  {d.getDate()}
                </p>
              </div>
            ))}
          </div>
          {/* Time grid */}
          <div className="relative grid grid-cols-[56px_repeat(7,1fr)]">
            <div>
              {hours.map((h) => (
                <div
                  key={h}
                  className="border-b border-slate-100 pr-2 text-right text-[10px] text-slate-400"
                  style={{ height: HOUR_PX }}
                >
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
            </div>
            {days.map((day, di) => (
              <div
                key={di}
                className="relative border-l border-slate-100"
                style={{ height: 24 * HOUR_PX }}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="border-b border-slate-100"
                    style={{ height: HOUR_PX }}
                  />
                ))}
                {/* External busy blocks */}
                {busyBlocks
                  .filter(
                    (b) =>
                      sameYmd(b.starts_at, day, tz) || sameYmd(b.ends_at, day, tz)
                  )
                  .map((b, bi) => {
                    const top =
                      (minutesInDay(b.starts_at, day, tz) / 60) * HOUR_PX;
                    const bottom =
                      (minutesInDay(b.ends_at, day, tz) / 60) * HOUR_PX;
                    return (
                      <div
                        key={bi}
                        title="Busy (external calendar)"
                        className="absolute left-1 right-1 rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
                        style={{
                          top: Math.max(0, top),
                          height: Math.max(14, bottom - top),
                        }}
                      >
                        Busy
                      </div>
                    );
                  })}
                {/* BookFlow bookings */}
                {(bookings ?? [])
                  .filter((b) => sameYmd(b.starts_at as string, day, tz))
                  .map((b) => {
                    const et = b.event_types as unknown as { title: string };
                    const top =
                      (minutesInDay(b.starts_at as string, day, tz) / 60) *
                      HOUR_PX;
                    const bottom =
                      (minutesInDay(b.ends_at as string, day, tz) / 60) *
                      HOUR_PX;
                    const pending = b.status === "pending";
                    return (
                      <Link
                        key={b.id as string}
                        href="/dashboard/bookings"
                        title={`${et.title} — ${b.booker_name}`}
                        className={`absolute left-1 right-1 overflow-hidden rounded-lg px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                          pending
                            ? "bg-amber-50 text-amber-800 ring-amber-200"
                            : "bg-indigo-50 text-indigo-800 ring-indigo-200"
                        }`}
                        style={{
                          top: Math.max(0, top),
                          height: Math.max(20, bottom - top),
                        }}
                      >
                        <span className="flex items-center gap-1">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${syncDot[b.calendar_sync_status as string] ?? syncDot.not_attempted}`}
                            title={`Calendar sync: ${b.calendar_sync_status}`}
                          />
                          <span className="truncate">
                            {et.title} · {b.booker_name as string}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> Calendar synced
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500" /> Sync failed — check
          Integrations
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-slate-300" /> No calendar
          connected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded bg-slate-200/70" /> Busy
          (external calendar)
        </span>
      </div>
    </div>
  );
}
