"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSlotsForDate } from "@/app/u/actions";
import { createManualBooking } from "@/app/dashboard/actions";
import { toDateStrInTz, zonedTimeToUtc } from "@/lib/scheduling";

export interface ManualEventType {
  id: string;
  title: string;
  duration_minutes: number;
}

function formatSlot(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function formatPicked(iso: string, timeZone: string): string {
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

export function ManualBookingForm({
  timezone,
  eventTypes,
}: {
  timezone: string;
  eventTypes: ManualEventType[];
}) {
  const router = useRouter();
  const [eventTypeId, setEventTypeId] = useState(eventTypes[0]?.id ?? "");
  const [date, setDate] = useState(() =>
    toDateStrInTz(new Date(Date.now() + 86400000), timezone)
  );
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [customTime, setCustomTime] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const duration = useMemo(
    () => eventTypes.find((e) => e.id === eventTypeId)?.duration_minutes ?? 30,
    [eventTypes, eventTypeId]
  );

  useEffect(() => {
    if (!eventTypeId || !date) return;
    setLoading(true);
    setPicked(null);
    getSlotsForDate(eventTypeId, date)
      .then(setSlots)
      .catch(() => setSlots([]))
      .finally(() => setLoading(false));
  }, [eventTypeId, date]);

  const customIso = useMemo(() => {
    if (!useCustom || !customTime) return null;
    try {
      return zonedTimeToUtc(date, customTime, timezone).toISOString();
    } catch {
      return null;
    }
  }, [useCustom, customTime, date, timezone]);

  const chosenIso = useCustom ? customIso : picked;
  const isLiveSlot = !!picked && !useCustom;
  // A custom time outside the live slot list is an availability override and
  // needs a written reason (the server enforces this too).
  const needsOverride = !!chosenIso && !isLiveSlot;

  async function onSubmit() {
    setError(null);
    if (!eventTypeId) return setError("Choose an event type.");
    if (!chosenIso) return setError("Pick a time for the booking.");
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setError("Enter the guest's name and a valid email.");
    }
    if (needsOverride && !overrideReason.trim()) {
      return setError(
        "That time is outside normal availability — add an override reason."
      );
    }
    setBusy(true);
    try {
      await createManualBooking({
        eventTypeId,
        startsAtIso: chosenIso,
        name: name.trim(),
        email: email.trim(),
        phone,
        notes,
        overrideReason: needsOverride ? overrideReason.trim() : undefined,
      });
      router.push("/dashboard/bookings");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the booking.");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Event type
          </span>
          <select
            value={eventTypeId}
            onChange={(e) => setEventTypeId(e.target.value)}
            className={inputCls}
          >
            {eventTypes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} · {e.duration_minutes} min
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Date ({timezone})
          </span>
          <input
            type="date"
            value={date}
            min={toDateStrInTz(new Date(), timezone)}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </label>

        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={useCustom}
              onChange={(e) => {
                setUseCustom(e.target.checked);
                setPicked(null);
              }}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600"
            />
            Custom time (outside availability)
          </label>
        </div>
      </div>

      {!useCustom ? (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Available slots
          </p>
          {loading ? (
            <p className="text-sm text-slate-400">Loading slots…</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-slate-400">
              No bookable slots that day — switch on “Custom time” to book
              anyway with an override reason.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {slots.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPicked(s)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                    picked === s
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-200 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50"
                  }`}
                >
                  {formatSlot(s, timezone)}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Time ({timezone})
            </span>
            <input
              type="time"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>
      )}

      {needsOverride && (
        <label className="mt-4 block rounded-xl border border-amber-200 bg-amber-50 p-4">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-amber-700">
            Override reason (required — kept in the audit trail)
          </span>
          <textarea
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            rows={2}
            placeholder="e.g. VIP client requested 7pm, approved by phone"
            className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-amber-700">
            Overrides availability hours and busy blocks — never an existing
            booking. {duration}-minute booking.
          </p>
        </label>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Guest name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Priya Sharma"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Guest email
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="priya@example.com"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Phone (optional)
          </span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 …"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Notes (optional)
          </span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the guest should know"
            className={inputCls}
          />
        </label>
      </div>

      {chosenIso && (
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Booking <strong>{formatPicked(chosenIso, timezone)}</strong> ·{" "}
          {duration} min · guest gets a confirmation email
          {needsOverride ? " · availability overridden" : ""}.
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || !chosenIso}
        className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create booking"}
      </button>
    </div>
  );
}
