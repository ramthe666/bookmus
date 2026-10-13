import { createClient } from "@/lib/supabase/server";
import { isEmailConfigured } from "@/lib/integrations/email";
import { isPaymentsConfigured } from "@/lib/integrations/payments";
import { isCalendarConfigured } from "@/lib/integrations/calendar";
import { disconnectCalendar } from "./actions";

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
        ok
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-slate-100 text-slate-500 ring-slate-200"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-400"}`} />
      {label}
    </span>
  );
}

function DisconnectButton({ id, provider }: { id: string; provider: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await disconnectCalendar(id);
      }}
    >
      <button
        type="submit"
        className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
      >
        Disconnect {provider}
      </button>
    </form>
  );
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: calendars } = await supabase
    .from("connected_calendars")
    .select("id, provider, provider_account_email, created_at")
    .eq("owner_profile_id", user.id);

  const google = (calendars ?? []).find((c) => c.provider === "google");
  const zoho = (calendars ?? []).find((c) => c.provider === "zoho");
  const calCfg = isCalendarConfigured();

  const services = [
    {
      name: "Resend",
      desc: "Booking confirmations, reminders and cancellations by email.",
      ok: isEmailConfigured(),
      action: null as React.ReactNode,
      hint: "Set RESEND_API_KEY + RESEND_FROM_EMAIL in env.",
    },
    {
      name: "Razorpay",
      desc: "Collect payments at booking time. Webhook: /api/webhooks/razorpay",
      ok: isPaymentsConfigured(),
      action: null as React.ReactNode,
      hint: "Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (+ webhook secret).",
    },
    {
      name: "Vercel Cron",
      desc: "Hourly reminder sweep for upcoming bookings.",
      ok: Boolean(process.env.CRON_SECRET),
      action: null as React.ReactNode,
      hint: "Set CRON_SECRET in env; schedule in vercel.json.",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Integrations
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Connect your calendars and services. Tokens are encrypted before storage.
      </p>

      {params.connected && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {params.connected === "google" ? "Google" : "Zoho"} connected successfully.
        </p>
      )}
      {params.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Connection failed — please try again.
        </p>
      )}

      {/* Calendars */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-widest text-slate-400">
        Calendars & meetings
      </h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Google Calendar</h3>
            <StatusPill ok={Boolean(google)} label={google ? "Connected" : "Not connected"} />
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {google?.provider_account_email ?? "Sync bookings + auto-create Google Meet links."}
          </p>
          <div className="mt-4">
            {google ? (
              <DisconnectButton id={google.id} provider="Google" />
            ) : calCfg.google ? (
              <a
                href="/api/integrations/google/connect"
                className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Connect Google
              </a>
            ) : (
              <p className="text-xs text-slate-400">Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in env.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Zoho Calendar</h3>
            <StatusPill ok={Boolean(zoho)} label={zoho ? "Connected" : "Not connected"} />
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Sync bookings + auto-create Zoho Meeting links.
          </p>
          <div className="mt-4">
            {zoho ? (
              <DisconnectButton id={zoho.id} provider="Zoho" />
            ) : calCfg.zoho ? (
              <a
                href="/api/integrations/zoho/connect"
                className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Connect Zoho
              </a>
            ) : (
              <p className="text-xs text-slate-400">Set ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET in env.</p>
            )}
          </div>
        </div>
      </div>

      {/* Services */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-widest text-slate-400">
        Services
      </h2>
      <div className="mt-3 space-y-3">
        {services.map((s) => (
          <div
            key={s.name}
            className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-slate-900">{s.name}</h3>
                <StatusPill ok={s.ok} label={s.ok ? "Configured" : "Not configured"} />
              </div>
              <p className="mt-1 text-sm text-slate-500">{s.desc}</p>
              {!s.ok && <p className="mt-1 text-xs text-slate-400">{s.hint}</p>}
            </div>
            {s.action}
          </div>
        ))}
      </div>
    </div>
  );
}
