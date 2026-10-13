import { createClient, createServiceClient } from "@/lib/supabase/server";
import { auditActionLabel } from "@/lib/audit";

interface FailedOutbox {
  id: string;
  event_type: string;
  payload: { booking_id?: string };
  attempts: number;
  last_error: string | null;
  updated_at: string;
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatAt(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

const actorStyles: Record<string, string> = {
  user: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  guest: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  system: "bg-slate-100 text-slate-600 ring-slate-200",
};

export default async function ActivityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: events } = await supabase
    .from("audit_events")
    .select("id, action, target_type, actor_type, actor_label, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  // Failed outbox deliveries need human attention (spec §8.2: visible,
  // never silently pretended). Tenant-safe: only failures whose booking
  // belongs to this owner (via RLS-scoped booking ids) are shown.
  const { data: ownBookings } = await supabase
    .from("bookings")
    .select("id")
    .limit(2000);
  const ownIds = new Set((ownBookings ?? []).map((b) => b.id as string));
  const svc = await createServiceClient();
  const { data: failedAll } = await svc
    .from("outbox_events")
    .select("id, event_type, payload, attempts, last_error, updated_at")
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(100);
  const failed = ((failedAll ?? []) as FailedOutbox[]).filter((f) =>
    ownIds.has(f.payload?.booking_id ?? "")
  );

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Activity
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Append-only audit trail of bookings, payments and integrations. Entries
        can never be edited or deleted.
      </p>

      {failed.length > 0 && (
        <div className="mt-8 overflow-hidden rounded-2xl border border-red-200 bg-red-50/50">
          <p className="border-b border-red-200 px-5 py-3 text-sm font-semibold text-red-800">
            ⚠ Failed deliveries needing attention
          </p>
          <ul className="divide-y divide-red-100">
            {failed.map((f) => (
              <li key={f.id as string} className="px-5 py-3">
                <p className="text-sm font-medium text-slate-900">
                  {f.event_type as string}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {f.attempts as number} attempts
                  </span>
                </p>
                <p className="mt-0.5 truncate text-xs text-red-700">
                  {(f.last_error as string | null) ?? "Unknown error"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {(events ?? []).length === 0 ? (
          <p className="p-12 text-center text-sm text-slate-500">
            No activity yet. Bookings, payments and integration changes will
            appear here.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(events ?? []).map((e) => (
              <li key={e.id} className="flex items-start gap-4 p-5">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                    actorStyles[e.actor_type as string] ?? actorStyles.system
                  }`}
                >
                  {e.actor_type as string}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    {auditActionLabel(e.action as string)}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {(e.actor_label as string | null) ??
                      (e.actor_type === "system"
                        ? "automated"
                        : (e.target_type as string))}
                    {(e.metadata as Record<string, unknown> | null)?.reason
                      ? ` · ${String((e.metadata as Record<string, unknown>).reason)}`
                      : ""}
                  </p>
                </div>
                <p
                  className="shrink-0 text-xs text-slate-400"
                  title={formatAt(e.created_at as string)}
                >
                  {timeAgo(e.created_at as string)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
