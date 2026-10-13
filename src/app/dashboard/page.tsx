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

  const tz = profile?.timezone ?? "Asia/Kolkata";

  const [{ data: eventTypes }, { data: bookings }] = await Promise.all([
    supabase
      .from("event_types")
      .select("id, is_active")
      .eq("owner_profile_id", user.id),
    supabase
      .from("bookings")
      .select("id, starts_at, ends_at, status, booker_name, event_types!inner(title)")
      .order("starts_at", { ascending: true })
      .limit(200),
  ]);

  const now = Date.now();
  const upcoming = (bookings ?? []).filter(
    (b) => b.status === "confirmed" && new Date(b.starts_at).getTime() > now
  );
  const pastCount = (bookings ?? []).filter(
    (b) => new Date(b.starts_at).getTime() <= now
  ).length;

  const stats = [
    { label: "Upcoming bookings", value: upcoming.length },
    { label: "Active event types", value: (eventTypes ?? []).filter((e) => e.is_active).length },
    { label: "Total bookings", value: (bookings ?? []).length },
    { label: "Past meetings", value: pastCount },
  ];

  const bookingLink =
    profile?.username != null
      ? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/u/${profile.username}`
      : null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}
            {profile?.display_name ? `, ${profile.display_name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Here&apos;s what&apos;s happening with your schedule.
          </p>
        </div>
        <Link
          href="/dashboard/event-types/new"
          className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/30 transition hover:bg-indigo-700"
        >
          + New event type
        </Link>
      </div>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-slate-200 bg-white p-5"
          >
            <p className="text-3xl font-bold text-slate-900">{s.value}</p>
            <p className="mt-1 text-sm text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Upcoming */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Upcoming bookings
            </h2>
            <Link
              href="/dashboard/bookings"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              View all
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {upcoming.slice(0, 5).map((b) => {
              const et = b.event_types as unknown as { title: string };
              return (
                <div
                  key={b.id}
                  className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {b.booker_name}
                    </p>
                    <p className="text-xs text-slate-500">{et.title}</p>
                  </div>
                  <p className="text-xs font-medium text-slate-600">
                    {formatInTz(b.starts_at, tz)}
                  </p>
                </div>
              );
            })}
            {upcoming.length === 0 && (
              <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                No upcoming bookings. Share your booking link to get started.
              </p>
            )}
          </div>
        </div>

        {/* Booking link */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">
            Your booking page
          </h2>
          {bookingLink ? (
            <>
              <p className="mt-2 text-sm text-slate-500">
                Share this link anywhere — guests pick a time, no sign-in needed.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2.5 text-sm text-slate-700">
                  {bookingLink}
                </code>
                <Link
                  href={bookingLink}
                  target="_blank"
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Open
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-slate-500">
                Set a username in Settings to unlock your public booking page.
              </p>
              <Link
                href="/dashboard/settings"
                className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Go to Settings
              </Link>
            </>
          )}

          <h3 className="mt-6 text-sm font-semibold text-slate-900">
            Quick actions
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Link
              href="/dashboard/event-types/new"
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/50"
            >
              New event type
            </Link>
            <Link
              href="/dashboard/availability"
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/50"
            >
              Edit availability
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
