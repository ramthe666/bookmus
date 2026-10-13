import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cancelBooking } from "../actions";
import { CopyLinkButton } from "./copy-link-button";

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

const statusStyles: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  expired: "bg-slate-100 text-slate-500 ring-slate-200",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-200",
  rescheduled: "bg-amber-50 text-amber-700 ring-amber-200",
  no_show: "bg-red-50 text-red-700 ring-red-200",
  completed: "bg-indigo-50 text-indigo-700 ring-indigo-200",
};

function CancelButton({ id }: { id: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await cancelBooking(id);
      }}
    >
      <button
        type="submit"
        className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
      >
        Cancel
      </button>
    </form>
  );
}

export default async function BookingsPage() {
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

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, ends_at, status, booker_name, booker_email, cancel_token, calendar_sync_status, calendar_sync_error, event_types!inner(title)"
    )
    .order("starts_at", { ascending: false })
    .limit(200);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Bookings
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Everyone who booked time with you.
      </p>

      <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {(bookings ?? []).length === 0 ? (
          <p className="p-12 text-center text-sm text-slate-500">
            No bookings yet. Share your booking link to get your first one.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(bookings ?? []).map((b) => {
              const et = b.event_types as unknown as { title: string };
              return (
                <li
                  key={b.id}
                  className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {b.booker_name}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusStyles[b.status] ?? statusStyles.confirmed}`}
                      >
                        {b.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-slate-500">
                      {et.title} · {b.booker_email}
                    </p>
                    {b.calendar_sync_status === "failed" && (
                      <p
                        className="mt-0.5 text-xs text-red-600"
                        title={(b.calendar_sync_error as string | null) ?? "Calendar sync failed"}
                      >
                        ⚠ Calendar sync failed —{" "}
                        <Link
                          href="/dashboard/integrations"
                          className="underline"
                        >
                          check Integrations
                        </Link>
                      </p>
                    )}
                  </div>
                  <p className="shrink-0 text-sm font-medium text-slate-700">
                    {formatInTz(b.starts_at, tz)}
                  </p>
                  {b.status === "confirmed" &&
                    new Date(b.starts_at).getTime() > Date.now() && (
                      <>
                        <Link
                          href={`/dashboard/bookings/${b.id}/reschedule`}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50"
                        >
                          Reschedule
                        </Link>
                        <CopyLinkButton token={b.cancel_token as string} />
                        <CancelButton id={b.id} />
                      </>
                    )}
                  {b.status === "pending" &&
                    new Date(b.starts_at).getTime() > Date.now() && (
                      <>
                        <CopyLinkButton token={b.cancel_token as string} />
                        <CancelButton id={b.id} />
                      </>
                    )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
