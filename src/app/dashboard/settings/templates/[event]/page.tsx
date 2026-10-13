import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  TEMPLATE_EVENTS,
  TEMPLATE_FIELDS,
  renderTemplate,
  sampleContext,
  type TemplateEvent,
} from "@/lib/email-templates";
import { TemplateEditor } from "./editor";

async function saveTemplate(formData: FormData) {
  "use server";
  const event = String(formData.get("event") ?? "") as TemplateEvent;
  const subject = String(formData.get("subject") ?? "").trim();
  const htmlBody = String(formData.get("html_body") ?? "").trim();
  if (!event || !subject || !htmlBody) throw new Error("All fields are required.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: latest } = await supabase
    .from("email_templates")
    .select("version")
    .eq("owner_profile_id", user.id)
    .eq("event", event)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((latest?.version as number | undefined) ?? 0) + 1;

  // Deactivate current, insert new version (history preserved).
  await supabase
    .from("email_templates")
    .update({ is_active: false })
    .eq("owner_profile_id", user.id)
    .eq("event", event)
    .eq("is_active", true);
  const { error } = await supabase.from("email_templates").insert({
    owner_profile_id: user.id,
    event,
    subject: subject.slice(0, 200),
    html_body: htmlBody.slice(0, 50000),
    is_active: true,
    version: nextVersion,
  });
  if (error) throw new Error("Could not save the template.");
  revalidatePath(`/dashboard/settings/templates/${event}`);
  revalidatePath("/dashboard/settings/templates");
}

async function rollbackTemplate(formData: FormData) {
  "use server";
  const event = String(formData.get("event") ?? "");
  const version = Number(formData.get("version") ?? 0);
  if (!event || !version) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await supabase
    .from("email_templates")
    .update({ is_active: false })
    .eq("owner_profile_id", user.id)
    .eq("event", event)
    .eq("is_active", true);
  await supabase
    .from("email_templates")
    .update({ is_active: true })
    .eq("owner_profile_id", user.id)
    .eq("event", event)
    .eq("version", version);
  revalidatePath(`/dashboard/settings/templates/${event}`);
  revalidatePath("/dashboard/settings/templates");
}

export default async function TemplateEditPage({
  params,
}: {
  params: Promise<{ event: string }>;
}) {
  const { event } = await params;
  const meta = TEMPLATE_EVENTS.find((e) => e.key === event);
  if (!meta) redirect("/dashboard/settings/templates");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: active } = await supabase
    .from("email_templates")
    .select("subject, html_body, version")
    .eq("owner_profile_id", user.id)
    .eq("event", event)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: versions } = await supabase
    .from("email_templates")
    .select("version, created_at, is_active")
    .eq("owner_profile_id", user.id)
    .eq("event", event)
    .order("version", { ascending: false })
    .limit(10);

  const ctx = sampleContext();
  const previewSubject = active
    ? renderTemplate(active.subject as string, ctx)
    : "(default subject)";
  const previewHtml = active
    ? renderTemplate(active.html_body as string, ctx)
    : "(default template — save a customization to preview it)";

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/dashboard/settings/templates"
        className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
      >
        ← Email templates
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
        {meta.label}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {active
          ? `Customized · v${active.version as number}`
          : "Using the default template — save below to customize it."}
      </p>

      <TemplateEditor
        event={event}
        initialSubject={(active?.subject as string | undefined) ?? ""}
        initialBody={(active?.html_body as string | undefined) ?? ""}
        saveAction={saveTemplate}
      />

      <div className="mt-10">
        <h2 className="font-semibold text-slate-900">Preview</h2>
        <p className="text-xs text-slate-500">Rendered with sample data.</p>
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <p className="border-b border-slate-100 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-800">
            {previewSubject}
          </p>
          <div
            className="prose prose-sm max-w-none px-5 py-4 text-slate-700"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      </div>

      {(versions ?? []).length > 0 && (
        <div className="mt-10">
          <h2 className="font-semibold text-slate-900">Version history</h2>
          <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {(versions ?? []).map((v) => (
              <li
                key={v.version as number}
                className="flex items-center justify-between px-5 py-3"
              >
                <div className="text-sm">
                  <span className="font-semibold text-slate-900">
                    v{v.version as number}
                  </span>
                  {(v.is_active as boolean) && (
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      active
                    </span>
                  )}
                  <span className="ml-2 text-xs text-slate-400">
                    {new Date(v.created_at as string).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    })}
                  </span>
                </div>
                {!(v.is_active as boolean) && (
                  <form action={rollbackTemplate}>
                    <input type="hidden" name="event" value={event} />
                    <input
                      type="hidden"
                      name="version"
                      value={v.version as number}
                    />
                    <button
                      type="submit"
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      Roll back to this
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm font-semibold text-slate-900">
          Available merge fields
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TEMPLATE_FIELDS.map((f) => (
            <code
              key={f.key}
              title={f.label}
              className="rounded-lg bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200"
            >
              {`{{${f.key}}}`}
            </code>
          ))}
        </div>
      </div>
    </div>
  );
}
