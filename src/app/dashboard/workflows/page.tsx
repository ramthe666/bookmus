import { createClient } from "@/lib/supabase/server";
import {
  createWorkflow,
  toggleWorkflow,
} from "./actions";
import { DeleteWorkflowButton } from "./delete-button";
import {
  WORKFLOW_TRIGGERS,
  WORKFLOW_ACTIONS,
  WORKFLOW_TEMPLATES,
} from "@/lib/workflows";

const triggerLabel = (v: string) =>
  WORKFLOW_TRIGGERS.find((t) => t.value === v)?.label ?? v;
const actionLabel = (v: string) =>
  WORKFLOW_ACTIONS.find((a) => a.value === v)?.label ?? v;

function ToggleButton({ id, active }: { id: string; active: boolean }) {
  const toggle = toggleWorkflow.bind(null, id, !active);
  return (
    <form action={toggle}>
      <button
        type="submit"
        className={`relative h-6 w-11 rounded-full transition ${
          active ? "bg-indigo-600" : "bg-slate-300"
        }`}
        aria-label={active ? "Pause workflow" : "Activate workflow"}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            active ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </form>
  );
}

export default async function WorkflowsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: workflows }, { data: webhooks }] = await Promise.all([
    supabase
      .from("workflows")
      .select("id, name, trigger, offset_hours, action, action_config, is_active, created_at")
      .eq("owner_profile_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("webhook_endpoints")
      .select("id, url")
      .eq("owner_profile_id", user.id)
      .eq("is_active", true),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Workflows
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Automate follow-ups: when something happens, send an email or ping a
        webhook — no code needed.
      </p>

      {/* Existing workflows */}
      <div className="mt-8 space-y-3">
        {(workflows ?? []).length === 0 && (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-10 text-center">
            <p className="text-sm font-medium text-slate-700">
              No workflows yet
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Example: 24 hours before a booking starts → send the reminder
              email. Or: after a booking ends → call your CRM webhook.
            </p>
          </div>
        )}
        {(workflows ?? []).map((w) => {
          const cfg = (w.action_config ?? {}) as {
            template_event?: string;
            webhook_id?: string;
          };
          return (
            <div
              key={w.id}
              className={`flex items-center gap-4 rounded-2xl border bg-white p-5 ${
                w.is_active ? "border-slate-200" : "border-slate-200 opacity-60"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {w.name}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  When <span className="font-medium text-slate-700">{triggerLabel(w.trigger as string)}</span>
                  {(w.trigger === "booking.before_start" ||
                    w.trigger === "booking.after_end") &&
                    ` (${w.offset_hours}h)`}
                  {" → "}
                  <span className="font-medium text-slate-700">{actionLabel(w.action as string)}</span>
                  {w.action === "send_email" &&
                    ` (${WORKFLOW_TEMPLATES.find((t) => t.value === cfg.template_event)?.label ?? "Confirmation"})`}
                  {w.action === "call_webhook" && " (webhook)"}
                </p>
              </div>
              <ToggleButton id={w.id} active={w.is_active} />
              <DeleteWorkflowButton id={w.id} />
            </div>
          );
        })}
      </div>

      {/* Create */}
      <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">
          New workflow
        </h2>
        <WorkflowForm hasWebhooks={(webhooks ?? []).length > 0} webhooks={webhooks ?? []} />
      </div>
    </div>
  );
}

function WorkflowForm({
  hasWebhooks,
  webhooks,
}: {
  hasWebhooks: boolean;
  webhooks: { id: string; url: string }[];
}) {
  return (
    <form action={createWorkflow} className="mt-4 grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          Name
        </label>
        <input
          name="name"
          required
          placeholder="e.g. 24h reminder email"
          className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          When this happens…
        </label>
        <select
          name="trigger"
          className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        >
          {WORKFLOW_TRIGGERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          Hours before / after <span className="font-normal text-slate-400">(time triggers only)</span>
        </label>
        <input
          name="offset_hours"
          type="number"
          min={0}
          max={720}
          defaultValue={24}
          className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          Do this…
        </label>
        <select
          name="action"
          className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        >
          {WORKFLOW_ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          Email template <span className="font-normal text-slate-400">(for Send email)</span>
        </label>
        <select
          name="template_event"
          className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        >
          {WORKFLOW_TEMPLATES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          Webhook endpoint <span className="font-normal text-slate-400">(for Call webhook)</span>
        </label>
        {hasWebhooks ? (
          <select
            name="webhook_id"
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">— Pick an endpoint —</option>
            {webhooks.map((wh) => (
              <option key={wh.id} value={wh.id}>
                {wh.url}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-slate-500">
            No webhook endpoints yet — add one in{" "}
            <a href="/dashboard/settings/webhooks" className="font-medium text-indigo-600 hover:text-indigo-800">
              Settings → Webhooks
            </a>
            .
          </p>
        )}
      </div>
      <div className="sm:col-span-2">
        <button
          type="submit"
          className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/30 transition hover:bg-indigo-700"
        >
          Create workflow
        </button>
      </div>
    </form>
  );
}
