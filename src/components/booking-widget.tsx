"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getMonthAvailability,
  getSlotsForDate,
  createBooking,
  confirmRazorpayPayment,
  type BookingResult,
} from "@/app/u/actions";
import {
  toDateStrInTz,
  addDaysStr,
  dayOfWeek,
} from "@/lib/scheduling";

export interface BookingWidgetProps {
  eventTypeId: string;
  title: string;
  description: string | null;
  durationMin: number;
  pricePaise: number;
  currency: string;
  color: string;
  locationType: string;
  meetingProvider: string;
  maxAheadDays: number;
  hostName: string;
  hostInitials: string;
  hostTimezone: string;
}

type Step = "schedule" | "details" | "payment" | "done";

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the payment form."));
    document.body.appendChild(s);
  });
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatSlot(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function formatFull(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function downloadIcs(args: {
  title: string;
  startsAtIso: string;
  endsAtIso: string;
  hostName: string;
}) {
  const stamp = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BookMus//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${Date.now()}@bookmus`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(new Date(args.startsAtIso))}`,
    `DTEND:${stamp(new Date(args.endsAtIso))}`,
    `SUMMARY:${args.title} with ${args.hostName}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "booking.ics";
  a.click();
  URL.revokeObjectURL(url);
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

export function BookingWidget(props: BookingWidgetProps) {
  const {
    eventTypeId,
    title,
    description,
    durationMin,
    pricePaise,
    currency,
    color,
    locationType,
    maxAheadDays,
    hostName,
    hostInitials,
    hostTimezone,
  } = props;

  const [step, setStep] = useState<Step>("schedule");
  const [guestTz] = useState(
    () =>
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata"
  );

  const todayStr = useMemo(
    () => toDateStrInTz(new Date(), hostTimezone),
    [hostTimezone]
  );
  const maxDateStr = useMemo(
    () => addDaysStr(todayStr, maxAheadDays),
    [todayStr, maxAheadDays]
  );

  const [ty, tm] = todayStr.split("-").map(Number);
  const [my, mm] = maxDateStr.split("-").map(Number);

  const [cursor, setCursor] = useState({ y: ty, m: tm });
  const [availability, setAvailability] = useState<Record<string, number>>({});
  const [loadingMonth, setLoadingMonth] = useState(true);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    startsAtIso: string;
    endsAtIso: string;
    cancelToken: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<
    NonNullable<BookingResult["payment"]> | null
  >(null);
  const [paying, setPaying] = useState(false);

  // Month availability
  useEffect(() => {
    let cancelled = false;
    setLoadingMonth(true);
    getMonthAvailability(eventTypeId, cursor.y, cursor.m)
      .then((res) => {
        if (!cancelled) setAvailability(res);
      })
      .catch(() => {
        if (!cancelled) setAvailability({});
      })
      .finally(() => {
        if (!cancelled) setLoadingMonth(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventTypeId, cursor]);

  const pickDate = useCallback(
    async (dateStr: string) => {
      setSelectedDate(dateStr);
      setSelectedSlot(null);
      setLoadingSlots(true);
      try {
        const s = await getSlotsForDate(eventTypeId, dateStr);
        setSlots(s);
      } catch {
        setSlots([]);
      } finally {
        setLoadingSlots(false);
      }
    },
    [eventTypeId]
  );

  const canPrev = cursor.y > ty || (cursor.y === ty && cursor.m > tm);
  const canNext = cursor.y < my || (cursor.y === my && cursor.m < mm);

  const firstDow = dayOfWeek(
    `${cursor.y}-${String(cursor.m).padStart(2, "0")}-01`
  ); // 1=Mon
  const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 1; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      `${cursor.y}-${String(cursor.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    );
  }

  async function openRazorpayCheckout(
    payment: NonNullable<BookingResult["payment"]>
  ) {
    setPaying(true);
    setError(null);
    try {
      await loadRazorpayScript();
      const Razorpay = (window as unknown as { Razorpay: new (o: object) => { open: () => void } }).Razorpay;
      const rzp = new Razorpay({
        key: payment.keyId,
        amount: payment.amount,
        currency: payment.currency,
        name: "BookMus",
        description: title,
        order_id: payment.orderId,
        prefill: { name, email, contact: phone },
        theme: { color: "#4f46e5" },
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            await confirmRazorpayPayment({
              orderId: resp.razorpay_order_id,
              paymentId: resp.razorpay_payment_id,
              signature: resp.razorpay_signature,
            });
            setStep("done");
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Payment verification failed."
            );
          } finally {
            setPaying(false);
          }
        },
        modal: {
          ondismiss: () => setPaying(false),
        },
      });
      rzp.open();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not open payment form."
      );
      setPaying(false);
    }
  }

  async function submitBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createBooking({
        eventTypeId,
        startsAtIso: selectedSlot,
        name,
        email,
        phone,
        notes,
        bookerTimezone: guestTz,
        idempotencyKey: crypto.randomUUID(),
      });
      setConfirmation({
        startsAtIso: res.startsAtIso,
        endsAtIso: res.endsAtIso,
        cancelToken: res.cancelToken,
      });
      if (res.payment) {
        setPaymentInfo(res.payment);
        setStep("payment");
        // Open checkout automatically; the button below re-opens it.
        openRazorpayCheckout(res.payment);
      } else {
        setStep("done");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const locationLabel =
    locationType === "video"
      ? "Video call"
      : locationType === "phone"
        ? "Phone call"
        : locationType === "in_person"
          ? "In person"
          : "Custom location";

  /* ── Payment ──────────────────────────────────────────────────── */
  if (step === "payment" && confirmation && paymentInfo) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-xl shadow-slate-900/5">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-indigo-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-8 w-8 text-indigo-600">
            <path d="M2 7h20M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7Zm5 7h4" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="mt-6 text-2xl font-bold text-slate-900">
          Almost there — complete payment
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Your slot is held for 30 minutes. Pay securely via Razorpay to
          confirm — unpaid holds are released automatically.
        </p>
        <div className="mt-6 rounded-2xl bg-slate-50 p-5 text-left">
          <p className="font-semibold text-slate-900">{title}</p>
          <p className="mt-1 text-sm text-slate-600">
            {formatFull(confirmation.startsAtIso, guestTz)}
          </p>
          <p className="mt-2 text-lg font-bold text-slate-900">
            ₹{(paymentInfo.amount / 100).toLocaleString("en-IN")}{" "}
            <span className="text-sm font-normal text-slate-500">
              {paymentInfo.currency}
            </span>
          </p>
        </div>
        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          onClick={() => openRazorpayCheckout(paymentInfo)}
          disabled={paying}
          className="mt-6 w-full rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-indigo-600/30 transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {paying ? "Opening secure checkout…" : `Pay ₹${(paymentInfo.amount / 100).toLocaleString("en-IN")}`}
        </button>
        <p className="mt-3 text-xs text-slate-400">
          UPI, cards, netbanking & wallets accepted
        </p>
      </div>
    );
  }

  /* ── Done ─────────────────────────────────────────────────────── */
  if (step === "done" && confirmation) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-xl shadow-slate-900/5">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-8 w-8 text-emerald-600">
            <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="mt-6 text-2xl font-bold text-slate-900">You&apos;re booked!</h2>
        <p className="mt-2 text-sm text-slate-500">
          A confirmation email is on its way to {email}.
        </p>
        <div className="mt-6 rounded-2xl bg-slate-50 p-5 text-left">
          <p className="font-semibold text-slate-900">{title}</p>
          <p className="mt-1 text-sm text-slate-600">
            {formatFull(confirmation.startsAtIso, guestTz)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Shown in your timezone ({guestTz}) · Host timezone: {hostTimezone}
          </p>
        </div>
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Manage this booking
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Save this private link — you can cancel without an account:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 text-xs text-indigo-700 ring-1 ring-slate-200">
              {`${process.env.NEXT_PUBLIC_APP_URL}/b/cancel/${confirmation.cancelToken}`}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  `${process.env.NEXT_PUBLIC_APP_URL}/b/cancel/${confirmation.cancelToken}`
                );
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={() =>
              downloadIcs({
                title,
                startsAtIso: confirmation.startsAtIso,
                endsAtIso: confirmation.endsAtIso,
                hostName,
              })
            }
            className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Add to calendar (.ics)
          </button>
          <button
            onClick={() => {
              setStep("schedule");
              setSelectedDate(null);
              setSelectedSlot(null);
              setConfirmation(null);
            }}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Book another
          </button>
        </div>
      </div>
    );
  }

  /* ── Details ──────────────────────────────────────────────────── */
  if (step === "details" && selectedSlot) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-7">
          <div className="flex items-center gap-3">
            <div
              className="grid h-12 w-12 place-items-center rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {hostInitials}
            </div>
            <div>
              <p className="text-sm text-slate-500">{hostName}</p>
              <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            </div>
          </div>
          <div className="mt-5 space-y-2 text-sm text-slate-600">
            <p>🕐 {durationMin} min</p>
            <p>📍 {locationLabel}</p>
            <p>📅 {formatFull(selectedSlot, guestTz)}</p>
            {pricePaise > 0 && (
              <p className="font-semibold text-slate-900">
                💳 ₹{(pricePaise / 100).toLocaleString("en-IN")} {currency}
              </p>
            )}
          </div>
          <button
            onClick={() => setStep("schedule")}
            className="mt-6 text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            ← Change time
          </button>
        </aside>

        <div className="rounded-3xl border border-slate-200 bg-white p-7">
          <h3 className="text-lg font-bold text-slate-900">Your details</h3>
          <form onSubmit={submitBooking} className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Full name *</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Aarav Patel" className={inputCls} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Email *</label>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={inputCls} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone <span className="font-normal text-slate-400">(optional)</span></label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" className={inputCls} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes <span className="font-normal text-slate-400">(optional)</span></label>
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the host should know?" className={inputCls} />
            </div>
            {error && (
              <p className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>
            )}
            {pricePaise > 0 && (
              <p className="rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
                Payment of ₹{(pricePaise / 100).toLocaleString("en-IN")} will be collected securely via Razorpay on the next step.
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-indigo-600/30 transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {submitting ? "Confirming…" : "Confirm booking"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  /* ── Schedule ─────────────────────────────────────────────────── */
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
      <aside className="rounded-3xl border border-slate-200 bg-white p-7">
        <div className="flex items-center gap-3">
          <div
            className="grid h-12 w-12 place-items-center rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: color }}
          >
            {hostInitials}
          </div>
          <div>
            <p className="text-sm text-slate-500">{hostName}</p>
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          </div>
        </div>
        {description && (
          <p className="mt-4 text-sm leading-6 text-slate-600">{description}</p>
        )}
        <div className="mt-5 space-y-2 text-sm text-slate-600">
          <p>🕐 {durationMin} min</p>
          <p>📍 {locationLabel}</p>
          {pricePaise > 0 && (
            <p className="font-semibold text-slate-900">
              💳 ₹{(pricePaise / 100).toLocaleString("en-IN")} {currency}
            </p>
          )}
        </div>
        <p className="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Times shown in your timezone
          <span className="font-medium text-slate-700"> ({guestTz})</span>
        </p>
      </aside>

      <div className="rounded-3xl border border-slate-200 bg-white p-7">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">
            {MONTHS[cursor.m - 1]} {cursor.y}
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => canPrev && setCursor({ y: cursor.m === 1 ? cursor.y - 1 : cursor.y, m: cursor.m === 1 ? 12 : cursor.m - 1 })}
              disabled={!canPrev}
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-30 hover:bg-slate-50"
              aria-label="Previous month"
            >
              ‹
            </button>
            <button
              onClick={() => canNext && setCursor({ y: cursor.m === 12 ? cursor.y + 1 : cursor.y, m: cursor.m === 12 ? 1 : cursor.m + 1 })}
              disabled={!canNext}
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 disabled:opacity-30 hover:bg-slate-50"
              aria-label="Next month"
            >
              ›
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1 text-center">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <span key={i} className="py-1 text-[11px] font-semibold text-slate-400">{d}</span>
          ))}
          {cells.map((dateStr, i) => {
            if (!dateStr) return <span key={`x-${i}`} />;
            const disabled =
              dateStr < todayStr || dateStr > maxDateStr || !(dateStr in availability);
            const selected = dateStr === selectedDate;
            return (
              <button
                key={dateStr}
                disabled={disabled || loadingMonth}
                onClick={() => pickDate(dateStr)}
                className={`grid h-10 place-items-center rounded-lg text-sm transition ${
                  selected
                    ? "bg-indigo-600 font-semibold text-white"
                    : disabled
                      ? "text-slate-300"
                      : "text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                }`}
              >
                {Number(dateStr.slice(8, 10))}
              </button>
            );
          })}
        </div>

        <div className="mt-6 border-t border-slate-100 pt-5">
          {!selectedDate ? (
            <p className="text-center text-sm text-slate-400">
              {loadingMonth ? "Loading availability…" : "Pick a date to see available times."}
            </p>
          ) : loadingSlots ? (
            <p className="text-center text-sm text-slate-400">Finding times…</p>
          ) : slots.length === 0 ? (
            <p className="text-center text-sm text-slate-400">
              No times left on this date — try another day.
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Available times
              </p>
              <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto pr-1">
                {slots.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setSelectedSlot(s);
                      setStep("details");
                    }}
                    className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:border-indigo-500 hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    {formatSlot(s, guestTz)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
