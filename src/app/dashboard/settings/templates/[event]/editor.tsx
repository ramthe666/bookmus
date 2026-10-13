"use client";

import { useState } from "react";
import { TEMPLATE_FIELDS } from "@/lib/email-templates";

export function TemplateEditor({
  event,
  initialSubject,
  initialBody,
  saveAction,
}: {
  event: string;
  initialSubject: string;
  initialBody: string;
  saveAction: (formData: FormData) => Promise<void>;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function insertField(field: string, target: "subject" | "body") {
    const tag = `{{${field}}}`;
    if (target === "subject") setSubject((s) => s + tag);
    else setBody((s) => s + tag);
  }

  async function onSubmit(formData: FormData) {
    setSaving(true);
    setError(null);
    try {
      await saveAction(formData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={onSubmit} className="mt-8 space-y-5">
      <input type="hidden" name="event" value={event} />
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          Subject
        </label>
        <input
          name="subject"
          required
          maxLength={200}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. Confirmed: {{event_title}} with {{host_name}}"
          className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
        <FieldButtons onInsert={(f) => insertField(f, "subject")} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          Body (HTML allowed)
        </label>
        <textarea
          name="html_body"
          required
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="<p>Hi {{booker_name}},</p><p>Your {{event_title}} is confirmed for {{when_text}}.</p>"
          className="w-full rounded-xl border border-slate-300 px-4 py-2.5 font-mono text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
        <FieldButtons onInsert={(f) => insertField(f, "body")} />
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={saving || !subject.trim() || !body.trim()}
        className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save as new version"}
      </button>
    </form>
  );
}

function FieldButtons({ onInsert }: { onInsert: (field: string) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {TEMPLATE_FIELDS.map((f) => (
        <button
          key={f.key}
          type="button"
          title={f.label}
          onClick={() => onInsert(f.key)}
          className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-indigo-100 hover:text-indigo-700"
        >
          +{f.key}
        </button>
      ))}
    </div>
  );
}
