"use client";

import { useState } from "react";
import type { WeeklyHours } from "@/lib/scheduling";

const DAYS = [
  { n: 1, label: "Monday" },
  { n: 2, label: "Tuesday" },
  { n: 3, label: "Wednesday" },
  { n: 4, label: "Thursday" },
  { n: 5, label: "Friday" },
  { n: 6, label: "Saturday" },
  { n: 7, label: "Sunday" },
];

interface DayState {
  enabled: boolean;
  start: string;
  end: string;
}

export function AvailabilityEditor({
  initial,
  action,
}: {
  initial: WeeklyHours;
  action: (formData: FormData) => Promise<void>;
}) {
  const [days, setDays] = useState<Record<number, DayState>>(() => {
    const s: Record<number, DayState> = {};
    for (const d of DAYS) {
      const w = initial[String(d.n)]?.[0];
      s[d.n] = {
        enabled: Boolean(w),
        start: w?.start ?? "09:00",
        end: w?.end ?? "17:00",
      };
    }
    return s;
  });
  const [saving, setSaving] = useState(false);

  function set(n: number, patch: Partial<DayState>) {
    setDays((prev) => ({ ...prev, [n]: { ...prev[n], ...patch } }));
  }

  return (
    <form
      action={async (fd) => {
        setSaving(true);
        await action(fd);
        setSaving(false);
      }}
      className="rounded-2xl border border-slate-200 bg-white p-6"
    >
      <div className="space-y-2">
        {DAYS.map((d) => {
          const st = days[d.n];
          return (
            <div
              key={d.n}
              className="flex flex-col gap-3 rounded-xl px-3 py-3 transition sm:flex-row sm:items-center hover:bg-slate-50"
            >
              <label className="flex w-40 shrink-0 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  name={`day_${d.n}_enabled`}
                  checked={st.enabled}
                  onChange={(e) => set(d.n, { enabled: e.target.checked })}
                  className="h-4 w-4 rounded accent-indigo-600"
                />
                <span className="text-sm font-medium text-slate-700">
                  {d.label}
                </span>
              </label>
              {st.enabled ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    name={`day_${d.n}_start`}
                    value={st.start}
                    onChange={(e) => set(d.n, { start: e.target.value })}
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500"
                  />
                  <span className="text-sm text-slate-400">to</span>
                  <input
                    type="time"
                    name={`day_${d.n}_end`}
                    value={st.end}
                    onChange={(e) => set(d.n, { end: e.target.value })}
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500"
                  />
                </div>
              ) : (
                <span className="text-sm text-slate-400">Unavailable</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-6 border-t border-slate-100 pt-5">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/30 transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save availability"}
        </button>
      </div>
    </form>
  );
}
