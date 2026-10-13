import Link from "next/link";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getHostBusyBlocks, type BusyBlock } from "@/lib/integrations/calendar";

const HOUR_PX = 48;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type View = "day" | "week" | "month" | "agenda";

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

function fmtTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function fmtDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

const syncDot: Record<string, string> = {
  synced: "bg-emerald-500",
  failed: "bg-red-500",
  not_attempted: "bg-slate-300",
};

type BookingRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  booker_name: string;
  calendar_sync_status: string;
  event_types: unknown;
};

function bookingTitle(b: BookingRow): string {
  const et = b.event_types as unknown as { title: string } | null;
  return et?.title ?? "Booking";
}

/** One timeline column for a single day (used by day + week views). */
function DayColumn({
  day,
  bookings,
  busyBlocks,
  tz,
}: {
  day: Date;
  bookings: BookingRow[];
  busyBlocks: BusyBlock[];
  tz: string;
}) {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="relative border-l border-slate-100" style={{ height: 24 * HOUR_PX }}>
      {hours.map((h) => (
        <div key={h} className="border-b border-slate-100" style={{ height: HOUR_PX }} />
      ))}
      {busyBlocks
        .filter((b) => sameYmd(b.starts_at, day, tz) || sameYmd(b.ends_at, day, tz))
        .map((b, bi) => {
          const top = (minutesInDay(b.starts_at, day, tz) / 60) * HOUR_PX;
          const bottom = (minutesInDay(b.ends_at, day, tz) / 60) * HOUR_PX;
          return (
            <div
              key={bi}
              title="Busy (external calendar)"
              className="absolute left-1 right-1 rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
              style={{ top: Math.max(0, top), height: Math.max(14, bottom - top) }}
            >
              Busy
            </div>
          );
        })}
      {bookings
        .filter((b) => sameYmd(b.starts_at, day, tz))
        .map((b) => {
          const top = (minutesInDay(b.starts_at, day, tz) / 60) * HOUR_PX;
          const bottom = (minutesInDay(b.ends_at, day, tz) / 60) * HOUR_PX;
          const pending = b.status === "pending";
          return (
            <Link
              key={b.id}
              href="/dashboard/bookings"
              title={`${bookingTitle(b)} — ${b.booker_name}`}
              className={`absolute left-1 right-1 overflow-hidden rounded-lg px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                pending
                  ? "bg-amber-50 text-amber-800 ring-amber-200"
                  : "bg-indigo-50 text-indigo-800 ring-indigo-200"
              }`}
              style={{ top: Math.max(0, top), height: Math.max(20, bottom - top) }}
            >
              <span className="flex items-center gap-1">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${syncDot[b.calendar_sync_status] ?? syncDot.not_attempted}`}
                  title={`Calendar sync: ${b.calendar_sync_status}`}
                />
                <span className="truncate">
                  {bookingTitle(b)} · {b.booker_name}
                </span>
              </span>
            </Link>
          );
        })}
    </div>
  );
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; week?: string }>;
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
  const tz = (profile?.timezone as string | undefined) ?? "Asia/Kolkata";

  const view: View =
    params.view === "day" || params.view === "month" || params.view === "agenda"
      ? params.view
      : "week";
  const anchorRaw = params.date ?? params.week; // `week` kept for back-compat
  const anchorBase = anchorRaw ? new Date(`${anchorRaw}T12:00:00`) : new Date();
  const anchor = isNaN(anchorBase.getTime()) ? new Date() : anchorBase;
  const anchorYmd = toYmd(anchor);

  let rangeStart: Date;
  let rangeEnd: Date;
  let label: string;
  let prevHref = "";
  let nextHref = "";

  if (view === "day") {
    rangeStart = new Date(anchor);
    rangeStart.setHours(0, 0, 0, 0);
    rangeEnd = addDays(rangeStart, 1);
    label = new Date(anchor).toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    prevHref = `/dashboard/calendar?view=day&date=${toYmd(addDays(anchor, -1))}`;
    nextHref = `/dashboard/calendar?view=day&date=${toYmd(addDays(anchor, 1))}`;
  } else if (view === "month") {
    rangeStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    rangeEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    label = new Date(anchor).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
    const pm = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
    const nm = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    prevHref = `/dashboard/calendar?view=month&date=${toYmd(pm)}`;
    nextHref = `/dashboard/calendar?view=month&date=${toYmd(nm)}`;
  } else if (view === "agenda") {
    rangeStart = new Date();
    rangeStart.setHours(0, 0, 0, 0);
    rangeEnd = addDays(rangeStart, 60);
    label = "Upcoming bookings";
    prevHref = "";
    nextHref = "";
  } else {
    const weekStart = mondayOf(anchor);
    rangeStart = weekStart;
    rangeEnd = addDays(weekStart, 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    label = `${days[0].toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
    prevHref = `/dashboard/calendar?view=week&date=${toYmd(addDays(weekStart, -7))}`;
    nextHref = `/dashboard/calendar?view=week&date=${toYmd(addDays(weekStart, 7))}`;
  }

  const { data: bookingRows } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, ends_at, status, booker_name, calendar_sync_status, event_types!inner(title)"
    )
    .gte("starts_at", rangeStart.toISOString())
    .lt("starts_at", rangeEnd.toISOString())
    .neq("status", "cancelled")
    .order("starts_at", { ascending: true })
    .limit(1000);
  const bookings = (bookingRows ?? []) as unknown as BookingRow[];

  // External busy blocks (privacy-preserving: busy only, no titles).
  const svc = await createServiceClient();
  const busyBlocks = await getHostBusyBlocks(
    svc,
    user.id,
    rangeStart.toISOString(),
    rangeEnd.toISOString()
  );

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const todayYmd = toYmd(new Date());

  const tabCls = (v: View) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      view === v
        ? "bg-indigo-600 text-white"
        : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Calendar
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {label} · {tz}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["day", "week", "month", "agenda"] as View[]).map((v) => (
            <Link
              key={v}
              href={`/dashboard/calendar?view=${v}&date=${anchorYmd}`}
              className={tabCls(v)}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </Link>
          ))}
        </div>
      </div>

      {view !== "agenda" && (
        <div className="mt-4 flex gap-2">
          <Link
            href={prevHref}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            ← Prev
          </Link>
          <Link
            href={`/dashboard/calendar?view=${view}`}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Today
          </Link>
          <Link
            href={nextHref}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Next →
          </Link>
        </div>
      )}

      {/* ── Day view ── */}
      {view === "day" && (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <div className="min-w-[420px]">
            <div className="grid grid-cols-[56px_1fr] border-b border-slate-200">
              <div />
              <div className="px-2 py-3 text-center">
                <p className="text-xs font-semibold uppercase text-slate-400">
                  {DAY_LABELS[(anchor.getDay() + 6) % 7]}
                </p>
                <p
                  className={`mt-0.5 text-sm font-bold ${anchorYmd === todayYmd ? "text-indigo-600" : "text-slate-900"}`}
                >
                  {anchor.getDate()}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-[56px_1fr]">
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
              <DayColumn day={anchor} bookings={bookings} busyBlocks={busyBlocks} tz={tz} />
            </div>
          </div>
        </div>
      )}

      {/* ── Week view ── */}
      {view === "week" && (() => {
        const weekStart = mondayOf(anchor);
        const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
        return (
          <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <div className="min-w-[840px]">
              <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-slate-200">
                <div />
                {days.map((d, i) => (
                  <div key={i} className="px-2 py-3 text-center">
                    <p className="text-xs font-semibold uppercase text-slate-400">
                      {DAY_LABELS[i]}
                    </p>
                    <p
                      className={`mt-0.5 text-sm font-bold ${toYmd(d) === todayYmd ? "text-indigo-600" : "text-slate-900"}`}
                    >
                      {d.getDate()}
                    </p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-[56px_repeat(7,1fr)]">
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
                  <DayColumn
                    key={di}
                    day={day}
                    bookings={bookings}
                    busyBlocks={busyBlocks}
                    tz={tz}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Month view ── */}
      {view === "month" && (() => {
        const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
        const gridStart = mondayOf(monthStart);
        const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
        const inMonth = (d: Date) => d.getMonth() === anchor.getMonth();
        return (
          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {DAY_LABELS.map((l) => (
                <div
                  key={l}
                  className="px-2 py-2 text-center text-xs font-semibold uppercase text-slate-400"
                >
                  {l}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((d, i) => {
                const dayBookings = bookings.filter((b) => sameYmd(b.starts_at, d, tz));
                const isToday = toYmd(d) === todayYmd;
                return (
                  <Link
                    key={i}
                    href={`/dashboard/calendar?view=day&date=${toYmd(d)}`}
                    className={`min-h-[92px] border-b border-r border-slate-100 p-1.5 align-top transition hover:bg-indigo-50/50 ${inMonth(d) ? "" : "bg-slate-50/60"}`}
                  >
                    <p
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                        isToday
                          ? "bg-indigo-600 text-white"
                          : inMonth(d)
                            ? "text-slate-900"
                            : "text-slate-400"
                      }`}
                    >
                      {d.getDate()}
                    </p>
                    <div className="mt-1 space-y-1">
                      {dayBookings.slice(0, 3).map((b) => (
                        <div
                          key={b.id}
                          className="truncate rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800 ring-1 ring-indigo-200"
                          title={`${fmtTime(b.starts_at, tz)} · ${bookingTitle(b)} — ${b.booker_name}`}
                        >
                          {fmtTime(b.starts_at, tz)} {bookingTitle(b)}
                        </div>
                      ))}
                      {dayBookings.length > 3 && (
                        <p className="px-1 text-[10px] font-medium text-slate-400">
                          +{dayBookings.length - 3} more
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Agenda view ── */}
      {view === "agenda" && (() => {
        const byDay = new Map<string, BookingRow[]>();
        for (const b of bookings) {
          const ymd = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(b.starts_at));
          if (!byDay.has(ymd)) byDay.set(ymd, []);
          byDay.get(ymd)!.push(b);
        }
        const groups = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
        return (
          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {groups.length === 0 ? (
              <p className="p-12 text-center text-sm text-slate-500">
                Nothing scheduled in the next 60 days.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {groups.map(([ymd, rows]) => (
                  <li key={ymd} className="p-4 sm:px-6">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {fmtDay(rows[0].starts_at, tz)}
                    </p>
                    <ul className="mt-2 space-y-2">
                      {rows.map((b) => (
                        <li key={b.id}>
                          <Link
                            href="/dashboard/bookings"
                            className="flex items-center gap-3 rounded-xl px-3 py-2 transition hover:bg-slate-50"
                          >
                            <span className="w-20 shrink-0 text-sm font-semibold text-slate-900">
                              {fmtTime(b.starts_at, tz)}
                            </span>
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${syncDot[b.calendar_sync_status] ?? syncDot.not_attempted}`}
                              title={`Calendar sync: ${b.calendar_sync_status}`}
                            />
                            <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                              <strong className="font-semibold text-slate-900">
                                {bookingTitle(b)}
                              </strong>{" "}
                              · {b.booker_name}
                            </span>
                            {b.status === "pending" && (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                                pending
                              </span>
                            )}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })()}

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
