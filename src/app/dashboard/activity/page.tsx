import { createClient } from "@/lib/supabase/server";
import { auditActionLabel } from "@/lib/audit";

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

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Activity
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Append-only audit trail of bookings, payments and integrations. Entries
        can never be edited or deleted.
      </p>

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
