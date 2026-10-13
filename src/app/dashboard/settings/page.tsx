import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updateProfile } from "../actions";

const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
];

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name, timezone")
    .eq("id", user.id)
    .maybeSingle();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Settings
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Your public profile and preferences.
      </p>

      <form
        action={updateProfile}
        className="mt-8 rounded-2xl border border-slate-200 bg-white p-6"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Display name
            </label>
            <input
              name="display_name"
              defaultValue={profile?.display_name ?? ""}
              placeholder="Aarav Patel"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Username
            </label>
            <input
              name="username"
              defaultValue={profile?.username ?? ""}
              placeholder="aarav"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-slate-400">
              Your booking page: {appUrl}/u/
              {profile?.username ?? "username"}
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Timezone
            </label>
            <select
              name="timezone"
              defaultValue={profile?.timezone ?? "Asia/Kolkata"}
              className={inputCls}
            >
              {TIMEZONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              value={user.email ?? ""}
              disabled
              className={`${inputCls} bg-slate-50 text-slate-500`}
            />
          </div>
        </div>
        <div className="mt-6 border-t border-slate-100 pt-5">
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/30 transition hover:bg-indigo-700"
          >
            Save settings
          </button>
        </div>
      </form>

      <Link
        href="/dashboard/settings/templates"
        className="mt-6 flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm"
      >
        <div>
          <p className="font-semibold text-slate-900">Email templates</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Customize confirmation, cancellation, reschedule and reminder
            emails with your own wording.
          </p>
        </div>
        <span className="text-sm font-medium text-indigo-600">Open →</span>
      </Link>

      <Link
        href="/dashboard/settings/webhooks"
        className="mt-3 flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm"
      >
        <div>
          <p className="font-semibold text-slate-900">Webhooks</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Real-time HTTPS callbacks for booking and payment events.
          </p>
        </div>
        <span className="text-sm font-medium text-indigo-600">Open →</span>
      </Link>
    </div>
  );
}
