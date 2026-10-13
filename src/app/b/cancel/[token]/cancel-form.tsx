"use client";

import { useState } from "react";
import { cancelBookingByToken } from "@/app/b/actions";

export function CancelForm({ token }: { token: string }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await cancelBookingByToken(token, reason);
      if ("alreadyCancelled" in res) {
        setDone(true);
      } else {
        setDone(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancellation failed.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-6 rounded-2xl bg-emerald-50 p-5">
        <p className="font-semibold text-emerald-800">Booking cancelled</p>
        <p className="mt-1 text-sm text-emerald-700">
          A confirmation email is on its way. The time slot is now free for
          others.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 text-left">
      <label className="mb-1.5 block text-sm font-medium text-slate-700">
        Reason <span className="font-normal text-slate-400">(optional)</span>
      </label>
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Let the host know why (optional)"
        className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      />
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        onClick={onConfirm}
        disabled={busy}
        className="mt-4 w-full rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
      >
        {busy ? "Cancelling…" : "Confirm cancellation"}
      </button>
      <p className="mt-3 text-center text-xs text-slate-400">
        This frees the time slot immediately.
      </p>
    </div>
  );
}
