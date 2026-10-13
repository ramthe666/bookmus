import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * Reports (spec §12). Metric definitions are fixed and shown on the page:
 * - Date basis: booking CREATED date (not appointment date).
 * - Timezone: the owner's profile timezone.
 * - Cancellation rate: cancelled / (confirmed + cancelled + completed + no_show).
 * - Revenue: captured payments only (refunds not yet modeled).
 */

function toYmdInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const days = Math.min(Math.max(Number(params.days) || 30, 7), 90);
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

  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, status, created_at, event_types!inner(title)")
    .gte("created_at", since)
    .limit(5000);

  const { data: payments } = await supabase
    .from("payments")
    .select("status, amount_paise, currency, created_at")
    .gte("created_at", since)
    .limit(5000);

  const rows = bookings ?? [];
  const byStatus: Record<string, number> = {};
  for (const b of rows) {
    const s = b.status as string;
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  const eligible =
    (byStatus.confirmed ?? 0) +
    (byStatus.cancelled ?? 0) +
    (byStatus.completed ?? 0) +
    (byStatus.no_show ?? 0);
  const cancellationRate =
    eligible > 0 ? ((byStatus.cancelled ?? 0) / eligible) * 100 : 0;
  const noShowRate =
    eligible > 0 ? ((byStatus.no_show ?? 0) / eligible) * 100 : 0;

  const pays = payments ?? [];
  const captured = pays.filter((p) => p.status === "captured");
  const failedPays = pays.filter((p) => p.status === "failed");
  const revenuePaise = captured.reduce(
    (sum, p) => sum + (p.amount_paise as number),
    0
  );
  const paymentSuccess =
    captured.length + failedPays.length > 0
      ? (captured.length / (captured.length + failedPays.length)) * 100
      : 100;

  // Daily volume, oldest → newest.
  const dayMap = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    dayMap.set(toYmdInTz(d, tz), 0);
  }
  for (const b of rows) {
    const day = toYmdInTz(new Date(b.created_at as string), tz);
    if (dayMap.has(day)) dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }
  const daily = [...dayMap.entries()];
  const maxDaily = Math.max(1, ...daily.map(([, n]) => n));

  const cards = [
    { label: "Bookings", value: String(rows.length), sub: `last ${days} days` },
    {
      label: "Cancellation rate",
      value: `${cancellationRate.toFixed(1)}%`,
      sub: `${byStatus.cancelled ?? 0} cancelled`,
    },
    {
      label: "No-show rate",
      value: `${noShowRate.toFixed(1)}%`,
      sub: `${byStatus.no_show ?? 0} no-shows`,
    },
    {
      label: "Revenue captured",
      value: `₹${(revenuePaise / 100).toLocaleString("en-IN")}`,
      sub: `${captured.length} payments`,
    },
    {
      label: "Payment success",
      value: `${paymentSuccess.toFixed(1)}%`,
      sub: `${failedPays.length} failed`,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Reports
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Date basis: booking created date · Timezone: {tz}
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <Link
              key={d}
              href={`/dashboard/reports?days=${d}`}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                days === d
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {d}d
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-2xl border border-slate-200 bg-white p-5"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {c.label}
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{c.value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold text-slate-900">Booking volume</h2>
        <p className="text-xs text-slate-500">Bookings created per day</p>
        <div className="mt-4 flex h-40 items-end gap-1">
          {daily.map(([day, n]) => (
            <div
              key={day}
              title={`${day}: ${n}`}
              className="flex-1 rounded-t bg-indigo-500/80 hover:bg-indigo-600"
              style={{ height: `${Math.max(4, (n / maxDaily) * 100)}%` }}
            />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-slate-400">
          <span>{daily[0]?.[0].slice(5)}</span>
          <span>{daily[daily.length - 1]?.[0].slice(5)}</span>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold text-slate-900">Bookings by status</h2>
        <div className="mt-4 space-y-2">
          {Object.entries(byStatus)
            .sort((a, b) => b[1] - a[1])
            .map(([s, n]) => (
              <div key={s} className="flex items-center gap-3 text-sm">
                <span className="w-28 capitalize text-slate-600">
                  {s.replace("_", " ")}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-indigo-500"
                    style={{
                      width: `${rows.length ? (n / rows.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="w-10 text-right font-semibold text-slate-900">
                  {n}
                </span>
              </div>
            ))}
          {rows.length === 0 && (
            <p className="text-sm text-slate-400">
              No bookings in this period yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
