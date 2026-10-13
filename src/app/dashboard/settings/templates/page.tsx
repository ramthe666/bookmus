import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TEMPLATE_EVENTS } from "@/lib/email-templates";

export default async function TemplatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: templates } = await supabase
    .from("email_templates")
    .select("event, version, updated_at, created_at")
    .eq("owner_profile_id", user.id)
    .eq("is_active", true);

  const active = new Map(
    (templates ?? []).map((t) => [t.event as string, t])
  );

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/dashboard/settings"
        className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
      >
        ← Settings
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
        Email templates
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Customize the emails guests receive. Use {"{{merge_fields}}"} — every
        change saves a new version you can roll back.
      </p>

      <div className="mt-8 space-y-3">
        {TEMPLATE_EVENTS.map(({ key, label }) => {
          const t = active.get(key);
          return (
            <Link
              key={key}
              href={`/dashboard/settings/templates/${key}`}
              className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm"
            >
              <div>
                <p className="font-semibold text-slate-900">{label}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t
                    ? `Customized · v${t.version as number}`
                    : "Using the default template"}
                </p>
              </div>
              <span className="text-sm font-medium text-indigo-600">
                {t ? "Edit →" : "Customize →"}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
