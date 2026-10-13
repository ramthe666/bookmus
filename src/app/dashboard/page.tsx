import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

function formatInTz(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function ymdInTz(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export default async function DashboardOverview() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, username, timezone")
    .eq("id", user.id)
    .maybeSingle();

  const tz = (profile?.timezone as string) ?? "Asia/Kolkata";
  const now = new Date();

  const [
    { data: eventTypes },
    { data: bookings },
    { data: integrations },
    { data: failedEmails },
    { data: failedSyncs },
  ] = await Promise.all([
    supabase
      .from("event_types")
      .select("id, title, is_active")
      .eq("owner_profile_id", user.id),
    supabase
      .from("bookings")
      .select("id, starts_at, ends_at, status, booker_name, event_types!inner(title)")
      .gte("starts_at", new Date(now.getTime() - 90 * 86400000).toISOString())
      .order("starts_at", { ascending: true })
      .limit(500),
    supabase
      .from("calendar_integrations")
      .select("provider, sync_status")
      .eq("profile_id", user.id),
    supabase.from("outbox_events").select("id").eq("status", "failed").limit(5),
    supabase
      .from("bookings")
      .select("id")
      .eq("calendar_sync_status", "failed")
      .neq("status", "cancelled")
      .limit(5),
  ]);

  const all = ((bookings ?? []) as {
    id: string;
    starts_at: string;
    status: string;
    booker_name: string;
    event_types: { title: string } | { title: string }[];
  }[]).map((b) => ({
    ...b,
    event_types: Array.isArray(b.event_types) ? b.event_types[0] : b.event_types,
  })) as {
    id: string;
    starts_at: string;
    status: string;
    booker_name: string;
    event_types: { title: string };
  }[];

  const upcoming = all.filter(
    (b) => b.status === "confirmed" && new Date(b.starts_at).getTime() > now.getTime()
  );
  const thisWeek = upcoming.filter(
    (b) => new Date(b.starts_at).getTime() < now.getTime() + 7 * 86400000
  );
  const cancelled = all.filter((b) => b.status === "cancelled").length;
  const cancelRate = all.length > 0 ? Math.round((cancelled / all.length) * 100) : 0;
  const activeEvents = (eventTypes ?? []).filter((e) => e.is_active).length;

  const days: { label: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = ymdInTz(d, tz);
    const count = all.filter((b) => ymdInTz(new Date(b.starts_at), tz) === key).length;
    days.push({
      label: new Intl.DateTimeFormat("en-IN", {
        timeZone: tz,
        day: "numeric",
        month: "short",
      }).format(d),
      count,
    });
  }
  const maxCount = Math.max(1, ...days.map((d) => d.count));

  const hasUsername = !!profile?.username;
  const hasEventType = (eventTypes ?? []).length > 0;
  const hasCalendar = (integrations ?? []).some((c) => c.sync_status === "connected");
  const checklist = [
    { label: "Claim your booking link", done: hasUsername, href: "/dashboard/settings" },
    { label: "Create your first event type", done: hasEventType, href: "/dashboard/event-types/new" },
    { label: "Set your availability", done: true, href: "/dashboard/availability" },
    { label: "Connect Google or Zoho Calendar", done: hasCalendar, href: "/dashboard/integrations" },
  ];
  const checklistDone = checklist.filter((c) => c.done).length;

  const health: { label: string; href: string; tone: "red" | "amber" }[] = [];
  if ((failedSyncs ?? []).length > 0) {
    health.push({
      label: `${(failedSyncs ?? []).length} booking(s) failed calendar sync`,
      href: "/dashboard/bookings",
      tone: "red",
    });
  }
  if ((failedEmails ?? []).length > 0) {
    health.push({
      label: `${(failedEmails ?? []).length} email(s) failed delivery`,
      href: "/dashboard/activity",
      tone: "amber",
    });
  }
  if ((integrations ?? []).some((c) => c.sync_status !== "connected")) {
    health.push({
      label: "Calendar connection needs attention",
      href: "/dashboard/integrations",
      tone: "amber",
    });
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const firstName = ((profile?.display_name as string | null) ?? "").split(" ")[0];

  const stats = [
    { label: "Upcoming bookings", value: String(upcoming.length), sub: `${thisWeek.length} in next 7 days` },
    { label: "Active event types", value: String(activeEvents), sub: `${(eventTypes ?? []).length} total` },
    { label: "Bookings (90 days)", value: String(all.length), sub: `${cancelRate}% cancelled` },
    {
      label: "Next appointment",
      value: upcoming.length > 0 ? formatInTz(upcoming[0].starts_at, tz).split(",")[0] : "—",
      sub: upcoming.length > 0 ? (upcoming[0].event_types.title as string) : "Nothing scheduled",
    },
  ];

  const bookingLink = profile?.username
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/u/${profile.username}`
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Good {greeting}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Here&apos;s what&apos;s happening with your schedule.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/bookings/new"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            + Manual booking
          </Link>
          <Link
            href="/dashboard/event-types/new"
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/30 transition hover:bg-indigo-700"
          >
            + New event type
          </Link>
        </div>
      </div>

      {checklistDone < checklist.length && (
        <section className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Get your booking page ready ({checklistDone}/{checklist.length})
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {checklist.map((c) => (
              <Link
                key={c.label}
                href={c.href}
                className={`flex items-center gap-3 rounded-xl border p-3 text-sm transition ${
                  c.done
                    ? "border-emerald-200 bg-emerald-50/50 text-slate-500"
                    : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:shadow-sm"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    c.done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {c.done ? "✓" : "·"}
                </span>
                {c.label}
              </Link>
            ))}
          </div>
        </section>
      )}

      {health.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5">
          <h2 className="text-sm font-semibold text-slate-900">Needs attention</h2>
          <div className="mt-2 space-y-1">
            {health.map((h) => (
              <Link
                key={h.label}
                href={h.href}
                className={`block text-sm underline-offset-2 hover:underline ${
                  h.tone === "red" ? "text-red-700" : "text-amber-800"
                }`}
              >
                ⚠ {h.label} →
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {s.label}
            </p>
            <p className="mt-2 truncate text-2xl font-bold text-slate-900">{s.value}</p>
            <p className="mt-1 truncate text-xs text-slate-500">{s.sub}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Bookings — last 14 days</h2>
          <div className="mt-4 flex h-40 items-end gap-1.5">
            {days.map((d, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t-md bg-indigo-500/80 transition hover:bg-indigo-500"
                  style={{ height: `${Math.max(4, (d.count / maxCount) * 120)}px` }}
                  title={`${d.label}: ${d.count}`}
                />
                <span className="text-[10px] text-slate-400">
                  {i % 2 === 0 ? d.label.split(" ")[0] : ""}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Up next</h2>
            <Link
              href="/dashboard/calendar"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              Open calendar →
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              Nothing scheduled.{" "}
              <Link href="/dashboard/bookings/new" className="text-indigo-600 hover:underline">
                Create a booking
              </Link>{" "}
              or share your booking link.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {upcoming.slice(0, 5).map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{b.booker_name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {b.event_types.title as string}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs font-medium text-slate-600">
                    {formatInTz(b.starts_at, tz)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {bookingLink && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Your booking page</h2>
            <p className="mt-0.5 text-sm text-slate-500">{bookingLink}</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/dashboard/page-builder"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Customize page
            </Link>
            <a
              href={bookingLink}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              View live →
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
