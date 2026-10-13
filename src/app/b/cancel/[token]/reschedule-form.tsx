"use client";

import { useState } from "react";
import { getSlotsForDate } from "@/app/u/actions";
import { rescheduleBookingByToken } from "@/app/b/actions";
import { toDateStrInTz } from "@/lib/scheduling";

function formatSlot(iso: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: timeZone ?? "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export function RescheduleForm({
  token,
  eventTypeId,
  hostTimezone,
  bookerTimezone,
}: {
  token: string;
  eventTypeId: string;
  hostTimezone: string;
  bookerTimezone: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() =>
    toDateStrInTz(new Date(Date.now() + 86400000), hostTimezone)
  );
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function loadSlots(d: string) {
    setLoading(true);
    setPicked(null);
    try {
      setSlots(await getSlotsForDate(eventTypeId, d));
    } catch {
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }

  async function onConfirm() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await rescheduleBookingByToken(token, picked);
      setDone(res.newStartsAtIso);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reschedule failed.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-6 rounded-2xl bg-emerald-50 p-5 text-left">
        <p className="font-semibold text-emerald-800">Rescheduled ✓</p>
        <p className="mt-1 text-sm text-emerald-700">
          Your new time: {formatSlot(done, bookerTimezone)}. A confirmation
          email is on its way.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          loadSlots(date);
        }}
        className="mt-4 w-full rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-3 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
      >
        Reschedule instead
      </button>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 p-4 text-left">
      <p className="text-sm font-semibold text-slate-900">Pick a new time</p>
      <input
        type="date"
        value={date}
        min={toDateStrInTz(new Date(), hostTimezone)}
        onChange={(e) => {
          setDate(e.target.value);
          if (e.target.value) loadSlots(e.target.value);
        }}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
      />
      <div className="mt-3">
        {loading ? (
          <p className="text-sm text-slate-400">Finding times…</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-slate-400">
            No times on this date — try another day.
          </p>
        ) : (
          <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto pr-1">
            {slots.map((s) => (
              <button
                key={s}
                onClick={() => setPicked(s)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                  picked === s
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-slate-200 text-slate-700 hover:border-indigo-400 hover:bg-indigo-50"
                }`}
              >
                {formatSlot(s, bookerTimezone)}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => setOpen(false)}
          className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          Back
        </button>
        <button
          onClick={onConfirm}
          disabled={!picked || busy}
          className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Moving…" : "Confirm new time"}
        </button>
      </div>
    </div>
  );
}
