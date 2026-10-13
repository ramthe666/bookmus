import crypto from "crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";

async function addEndpoint(formData: FormData) {
  "use server";
  const url = String(formData.get("url") ?? "").trim();
  const events = WEBHOOK_EVENTS.map((e) => e.key).filter((k) =>
    formData.get(`event_${k}`)
  );
  if (!url.startsWith("https://")) throw new Error("URL must be https://");
  if (!events.length) throw new Error("Pick at least one event.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase.from("webhook_endpoints").insert({
    owner_profile_id: user.id,
    url: url.slice(0, 500),
    secret: crypto.randomBytes(32).toString("hex"),
    events,
    is_active: true,
  });
  if (error) throw new Error("Could not add the endpoint.");
  revalidatePath("/dashboard/settings/webhooks");
}

async function deleteEndpoint(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await supabase
    .from("webhook_endpoints")
    .delete()
    .eq("id", id)
    .eq("owner_profile_id", user.id);
  revalidatePath("/dashboard/settings/webhooks");
}

async function toggleEndpoint(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  if (!id) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await supabase
    .from("webhook_endpoints")
    .update({ is_active: !active })
    .eq("id", id)
    .eq("owner_profile_id", user.id);
  revalidatePath("/dashboard/settings/webhooks");
}

export default async function WebhooksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: endpoints } = await supabase
    .from("webhook_endpoints")
    .select("id, url, secret, events, is_active, created_at")
    .order("created_at", { ascending: false });

  const { data: deliveries } = await supabase
    .from("webhook_deliveries")
    .select("id, event, status, attempts, last_error, created_at, endpoint_id")
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/dashboard/settings"
        className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
      >
        ← Settings
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
        Webhooks
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Get real-time HTTPS callbacks for booking and payment events. Each
        request is signed with <code>HMAC-SHA256</code> in the{" "}
        <code>X-BookMus-Signature</code> header.
      </p>

      <form
        action={addEndpoint}
        className="mt-8 rounded-2xl border border-slate-200 bg-white p-6"
      >
        <h2 className="font-semibold text-slate-900">Add endpoint</h2>
        <input
          name="url"
          required
          type="url"
          placeholder="https://your-app.com/hooks/bookmus"
          className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {WEBHOOK_EVENTS.map((e) => (
            <label
              key={e.key}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                name={`event_${e.key}`}
                defaultChecked
                className="accent-indigo-600"
              />
              {e.label}
            </label>
          ))}
        </div>
        <button
          type="submit"
          className="mt-4 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Add endpoint
        </button>
        <p className="mt-2 text-xs text-slate-400">
          A signing secret is generated automatically — find it in your
          endpoint details after creation.
        </p>
      </form>

      <div className="mt-8 space-y-3">
        {(endpoints ?? []).map((ep) => (
          <div
            key={ep.id as string}
            className="rounded-2xl border border-slate-200 bg-white p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-slate-900">
                  {ep.url as string}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {(ep.events as string[]).join(", ")}
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
                    Signing secret
                  </summary>
                  <code className="mt-1 block break-all rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-700">
                    {ep.secret as string}
                  </code>
                </details>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  ep.is_active
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {ep.is_active ? "active" : "paused"}
              </span>
            </div>
            <div className="mt-3 flex gap-2">
              <form action={toggleEndpoint}>
                <input type="hidden" name="id" value={ep.id as string} />
                <input
                  type="hidden"
                  name="active"
                  value={String(ep.is_active)}
                />
                <button
                  type="submit"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  {ep.is_active ? "Pause" : "Resume"}
                </button>
              </form>
              <form action={deleteEndpoint}>
                <input type="hidden" name="id" value={ep.id as string} />
                <button
                  type="submit"
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </form>
            </div>
          </div>
        ))}
        {(endpoints ?? []).length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
            No endpoints yet — add your first one above.
          </p>
        )}
      </div>

      {(deliveries ?? []).length > 0 && (
        <div className="mt-10">
          <h2 className="font-semibold text-slate-900">Recent deliveries</h2>
          <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {(deliveries ?? []).map((d) => (
              <li key={d.id as string} className="px-5 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-900">
                    {d.event as string}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      d.status === "delivered"
                        ? "bg-emerald-100 text-emerald-700"
                        : d.status === "failed"
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {d.status as string}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  {new Date(d.created_at as string).toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })}
                  {d.status === "failed" &&
                    (d.last_error as string | null) &&
                    ` · ${(d.last_error as string).slice(0, 120)}`}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
