"use client";

import { useState } from "react";
import Link from "next/link";

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
  price_rupees: string;
  location_type: string;
  meeting_provider: string;
  color: string;
  is_active: boolean;
  organization_id: string;
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
}: {
  initial: EventTypeValues;
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  organizations?: { id: string; name: string }[];
}) {
  const [paid, setPaid] = useState(Number(initial.price_rupees) > 0);

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
                defaultValue={initial.organization_id}
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
          <Field label="Color">
            <input name="color" type="color" defaultValue={initial.color} className="h-11 w-20 cursor-pointer rounded-lg border border-slate-300" />
          </Field>
          <label className="flex items-center gap-3 pt-6 text-sm font-medium text-slate-700">
            <input name="is_active" type="checkbox" defaultChecked={initial.is_active} className="h-4 w-4 rounded accent-indigo-600" />
            Active — bookable on your public page
          </label>
        </div>
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
