"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSlotsForDate } from "@/app/u/actions";
import { rescheduleBooking } from "@/app/dashboard/actions";
import { toDateStrInTz } from "@/lib/scheduling";

function formatSlot(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export default function ReschedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [date, setDate] = useState(() =>
    toDateStrInTz(new Date(Date.now() + 86400000), "Asia/Kolkata")
  );
  const [slots, setSlots] = useState<string[]>([]);
  const [eventTypeId, setEventTypeId] = useState<string | null>(null);
  const [tz, setTz] = useState("Asia/Kolkata");
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    params.then(async (p) => {
      setId(p.id);
      // Load the booking's event type + timezone for the slot picker.
      const res = await fetch(`/api/bookings/${p.id}/context`).then((r) =>
        r.ok ? r.json() : null
      );
      if (res) {
        setEventTypeId(res.eventTypeId);
        setTz(res.timezone ?? "Asia/Kolkata");
        setDate(toDateStrInTz(new Date(Date.now() + 86400000), res.timezone ?? "Asia/Kolkata"));
      }
    });
  }, [params]);

  async function loadSlots(etId: string, d: string) {
    setLoading(true);
    setPicked(null);
    try {
      setSlots(await getSlotsForDate(etId, d));
    } catch {
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (eventTypeId && date) loadSlots(eventTypeId, date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventTypeId]);

  async function onConfirm() {
    if (!id || !picked) return;
    setBusy(true);
    setError(null);
    try {
      await rescheduleBooking(id, picked);
      router.push("/dashboard/bookings");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reschedule failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/dashboard/bookings"
        className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
      >
        ← Back to bookings
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
        Reschedule booking
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Pick a new time — availability is re-checked live, and the guest gets
        an email with the new time.
      </p>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          New date
        </label>
        <input
          type="date"
          value={date}
          min={toDateStrInTz(new Date(), tz)}
          onChange={(e) => {
            setDate(e.target.value);
            if (e.target.value && eventTypeId) loadSlots(eventTypeId, e.target.value);
          }}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500"
        />
        <div className="mt-4">
          {loading ? (
            <p className="text-sm text-slate-400">Finding times…</p>
          ) : !eventTypeId ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-slate-400">
              No times on this date — try another day.
            </p>
          ) : (
            <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-1">
              {slots.map((s) => (
                <button
                  key={s}
                  onClick={() => setPicked(s)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                    picked === s
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-200 text-slate-700 hover:border-indigo-400 hover:bg-indigo-50"
                  }`}
                >
                  {formatSlot(s, tz)}
                </button>
              ))}
            </div>
          )}
        </div>
        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          onClick={onConfirm}
          disabled={!picked || busy}
          className="mt-6 w-full rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Rescheduling…" : "Confirm new time"}
        </button>
      </div>
    </div>
  );
}
