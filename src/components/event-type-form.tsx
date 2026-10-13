"use client";

import { useState } from "react";
import Link from "next/link";

export interface EventQuestion {
  id: string;
  label: string;
  field_type: string;
  is_required: boolean;
  options: string[];
}

export interface EventTypeValues {
  title: string;
  slug: string;
  description: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  min_notice_hours: number;
  max_ahead_days: number;
  max_bookings_per_day: string;
  max_attendees: number;
  cancel_cutoff_hours: number;
  price_rupees: string;
  location_type: string;
  meeting_provider: string;
  color: string;
  is_active: boolean;
  is_private: boolean;
  organization_id: string;
  scheduling_mode: string;
  host_ids: string[];
  questions: EventQuestion[];
}

export interface TeamMemberOption {
  orgId: string;
  id: string;
  name: string;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
const labelCls = "mb-1.5 block text-sm font-medium text-slate-700";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function EventTypeForm({
  initial,
  action,
  submitLabel,
  organizations,
  teamMembers,
}: {
  initial: EventTypeValues;
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  organizations?: { id: string; name: string }[];
  teamMembers?: TeamMemberOption[];
}) {
  const [paid, setPaid] = useState(Number(initial.price_rupees) > 0);
  const [orgId, setOrgId] = useState(initial.organization_id);
  const [mode, setMode] = useState(initial.scheduling_mode || "single");
  const [hostIds, setHostIds] = useState<string[]>(initial.host_ids);
  const [questions, setQuestions] = useState<EventQuestion[]>(initial.questions ?? []);

  const orgMembers = (teamMembers ?? []).filter((m) => m.orgId === orgId);
  const showHosts = mode !== "single" && orgId !== "";

  function toggleHost(id: string) {
    setHostIds((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  }

  function addQuestion() {
    setQuestions((q) => [
      ...q,
      {
        id: `q${Date.now()}`,
        label: "",
        field_type: "text",
        is_required: false,
        options: [],
      },
    ]);
  }

  function updateQuestion(id: string, patch: Partial<EventQuestion>) {
    setQuestions((q) => q.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function removeQuestion(id: string) {
    setQuestions((q) => q.filter((x) => x.id !== id));
  }

  return (
    <form action={action} className="space-y-8">
      {/* Basics */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">Basics</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Event name">
            <input name="title" required defaultValue={initial.title} placeholder="Intro call" className={inputCls} />
          </Field>
          <Field label="URL slug" hint="Used in your public booking link.">
            <input name="slug" defaultValue={initial.slug} placeholder="intro-call" className={inputCls} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <textarea name="description" rows={3} defaultValue={initial.description} placeholder="What should guests expect?" className={inputCls} />
            </Field>
          </div>
          {(organizations ?? []).length > 0 && (
            <Field
              label="Workspace"
              hint="Team events are visible to everyone in the workspace."
            >
              <select
                name="organization_id"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                className={inputCls}
              >
                <option value="">Personal (only me)</option>
                {organizations!.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field
            label="Scheduling"
            hint={
              mode === "round_robin"
                ? "Bookings rotate across hosts — each slot shows if any host is free."
                : mode === "collective"
                  ? "All hosts must be free — every booking blocks the whole team."
                  : "One host (you)."
            }
          >
            <select
              name="scheduling_mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className={inputCls}
            >
              <option value="single">Single host</option>
              <option value="round_robin">Round robin (team)</option>
              <option value="collective">Collective (team)</option>
            </select>
          </Field>
          {showHosts && (
            <div className="sm:col-span-2">
              <Field
                label="Hosts"
                hint="Who can take bookings for this event. Each host uses their own availability."
              >
                <div className="space-y-2">
                  {orgMembers.length === 0 && (
                    <p className="text-xs text-slate-400">
                      No team members in this workspace yet — invite them from
                      the Team page.
                    </p>
                  )}
                  {orgMembers.map((m) => (
                    <label
                      key={m.id}
                      className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={hostIds.includes(m.id)}
                        onChange={() => toggleHost(m.id)}
                        className="accent-indigo-600"
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
              </Field>
              <input type="hidden" name="host_ids" value={JSON.stringify(hostIds)} />
            </div>
          )}
          <Field label="Color">
            <input name="color" type="color" defaultValue={initial.color} className="h-11 w-20 cursor-pointer rounded-lg border border-slate-300" />
          </Field>
          <label className="flex items-center gap-3 pt-6 text-sm font-medium text-slate-700">
            <input name="is_active" type="checkbox" defaultChecked={initial.is_active} className="h-4 w-4 rounded accent-indigo-600" />
            Active — bookable on your public page
          </label>
          <label className="flex items-start gap-3 pt-2 text-sm font-medium text-slate-700">
            <input name="is_private" type="checkbox" defaultChecked={initial.is_private} className="mt-0.5 h-4 w-4 rounded accent-indigo-600" />
            <span>
              Secret event
              <span className="block text-xs font-normal text-slate-500">
                Hidden from your public page — only people with the direct link (or embed) can book.
              </span>
            </span>
          </label>
        </div>
      </section>

      {/* Questions */}
      <section>
        <h2 className="text-base font-semibold text-slate-900">
          Booking questions
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Ask guests for extra info at booking time.
        </p>
        <div className="mt-5 space-y-4">
          {questions.map((q, i) => (
            <div
              key={q.id}
              className="rounded-xl border border-slate-200 bg-slate-50/50 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Question {i + 1}
                </p>
                <button
                  type="button"
                  onClick={() => removeQuestion(q.id)}
                  className="text-xs font-medium text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input
                  value={q.label}
                  onChange={(e) => updateQuestion(q.id, { label: e.target.value })}
                  placeholder="e.g. What is your company name?"
                  className={inputCls}
                />
                <select
                  value={q.field_type}
                  onChange={(e) => updateQuestion(q.id, { field_type: e.target.value })}
                  className={inputCls}
                >
                  <option value="text">Short text</option>
                  <option value="textarea">Long text</option>
                  <option value="select">Dropdown</option>
                  <option value="radio">Multiple choice</option>
                  <option value="phone">Phone number</option>
                </select>
              </div>
              {(q.field_type === "select" || q.field_type === "radio") && (
                <input
                  value={q.options.join(", ")}
                  onChange={(e) =>
                    updateQuestion(q.id, {
                      options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  placeholder="Options, separated by commas"
                  className={`${inputCls} mt-3`}
                />
              )}
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={q.is_required}
                  onChange={(e) => updateQuestion(q.id, { is_required: e.target.checked })}
                  className="h-4 w-4 rounded accent-indigo-600"
                />
                Required
              </label>
            </div>
          ))}
          <button
            type="button"
            onClick={addQuestion}
            className="rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600"
          >
            + Add question
          </button>
        </div>
        <input
          type="hidden"
          name="questions"
          value={JSON.stringify(
            questions
              .filter((q) => q.label.trim())
              .map((q, i) => ({ ...q, label: q.label.trim(), position: i }))
          )}
        />
      </section>

      {/* Timing */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">Timing</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          <Field label="Duration (minutes)">
            <input name="duration_minutes" type="number" min={5} max={1440} defaultValue={initial.duration_minutes} className={inputCls} />
          </Field>
          <Field label="Buffer before (min)" hint="Padding before the meeting.">
            <input name="buffer_before_minutes" type="number" min={0} defaultValue={initial.buffer_before_minutes} className={inputCls} />
          </Field>
          <Field label="Buffer after (min)" hint="Padding after the meeting.">
            <input name="buffer_after_minutes" type="number" min={0} defaultValue={initial.buffer_after_minutes} className={inputCls} />
          </Field>
          <Field label="Min. notice (hours)" hint="How late can someone book?">
            <input name="min_notice_hours" type="number" min={0} step="0.5" defaultValue={initial.min_notice_hours} className={inputCls} />
          </Field>
          <Field label="Bookable ahead (days)">
            <input name="max_ahead_days" type="number" min={1} defaultValue={initial.max_ahead_days} className={inputCls} />
          </Field>
          <Field label="Max bookings / day" hint="Empty = unlimited.">
            <input name="max_bookings_per_day" type="number" min={1} defaultValue={initial.max_bookings_per_day} placeholder="Unlimited" className={inputCls} />
          </Field>
          <Field label="Cancel cutoff (hours)" hint="Guests can't cancel/reschedule within this window.">
            <input name="cancel_cutoff_hours" type="number" min={0} defaultValue={initial.cancel_cutoff_hours} className={inputCls} />
          </Field>
        </div>
      </section>

      {/* Location & payments */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">Location & payments</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Location">
            <select name="location_type" defaultValue={initial.location_type} className={inputCls}>
              <option value="video">Video call</option>
              <option value="phone">Phone call</option>
              <option value="in_person">In person</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          <Field label="Meeting provider">
            <select name="meeting_provider" defaultValue={initial.meeting_provider} className={inputCls}>
              <option value="google_meet">Google Meet</option>
              <option value="zoho_meeting">Zoho Meeting</option>
              <option value="none">None</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={paid}
                onChange={(e) => setPaid(e.target.checked)}
                className="h-4 w-4 rounded accent-indigo-600"
              />
              Charge for this event (via Razorpay)
            </label>
            {paid && (
              <div className="mt-3 max-w-xs">
                <Field label="Price (INR ₹)">
                  <input name="price_rupees" type="number" min={0} step="1" defaultValue={initial.price_rupees || "499"} className={inputCls} />
                </Field>
              </div>
            )}
            {!paid && <input type="hidden" name="price_rupees" value="0" />}
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/30 transition hover:bg-indigo-700"
        >
          {submitLabel}
        </button>
        <Link href="/dashboard/event-types" className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
          Cancel
        </Link>
      </div>
    </form>
  );
}
