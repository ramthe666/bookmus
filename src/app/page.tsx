import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

/* ── Small inline icons ─────────────────────────────────────────────── */
function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="h-6 w-6"
    >
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const features = [
  {
    d: "M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
    title: "Booking pages in minutes",
    body: "Branded scheduling links with your rules — durations, buffers, limits. No back-and-forth emails, ever.",
  },
  {
    d: "M12 8v4l2.5 2.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    title: "Smart availability",
    body: "Weekly hours, date overrides and buffers that respect your real calendar. Double-bookings are impossible by design.",
  },
  {
    d: "M2 7h20M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7Zm5 7h4",
    title: "Collect payments",
    body: "Charge for sessions with Razorpay at booking time. Failed payments never block your calendar.",
  },
  {
    d: "m23 7-7 5 7 5V7ZM1 5h15v14H1z",
    title: "Meetings included",
    body: "Every booking spins up a Google Meet or Zoho Meeting link automatically and puts it on both calendars.",
  },
  {
    d: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm14 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    title: "Team scheduling",
    body: "Round-robin, collective and managed events for sales, support and hiring pipelines.",
  },
  {
    d: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
    title: "Reminders that work",
    body: "Email confirmations, reminders and follow-ups via Resend. No-shows drop the week you turn them on.",
  },
];

const steps = [
  {
    n: "01",
    title: "Create your event types",
    body: "Define 15-min intros, 60-min deep-dives, paid consultations — each with its own rules and price.",
  },
  {
    n: "02",
    title: "Share your link",
    body: "bookmus.io/you/intro — drop it in your email signature, website or DMs. Guests pick a time that suits them.",
  },
  {
    n: "03",
    title: "Get booked, get paid",
    body: "Confirmations, calendar invites, meeting links and receipts go out automatically. You just show up.",
  },
];

const plans = [
  {
    name: "Starter",
    price: "₹0",
    per: "forever",
    cta: "Start for free",
    features: ["1 event type", "Unlimited bookings", "Google Meet links", "Email confirmations"],
    highlight: false,
  },
  {
    name: "Professional",
    price: "₹799",
    per: "per user / month",
    cta: "Start 14-day trial",
    features: [
      "Unlimited event types",
      "Razorpay payments",
      "Calendar sync (Google + Zoho)",
      "Reminders & follow-ups",
      "Custom branding",
    ],
    highlight: true,
  },
  {
    name: "Business",
    price: "₹1,999",
    per: "per user / month",
    cta: "Talk to sales",
    features: [
      "Everything in Professional",
      "Team scheduling & round-robin",
      "SSO / SAML",
      "Audit logs & API access",
      "Dedicated support",
    ],
    highlight: false,
  },
];

const testimonials = [
  {
    quote:
      "We replaced three tools with BookMus. Booking, payment and the Meet link just happen — our no-show rate fell by half.",
    name: "Ananya Sharma",
    role: "Founder, GrowthStudio",
  },
  {
    quote:
      "The availability engine is the first one that actually respects buffers and overrides. It feels invisible, which is the point.",
    name: "Rahul Verma",
    role: "Sales Lead, FinEdge",
  },
  {
    quote:
      "Clients pay when they book. Our consultation revenue is up 30% and my calendar manages itself.",
    name: "Dr. Meera Nair",
    role: "Independent Consultant",
  },
];

/* ── Product mock: a mini booking widget ────────────────────────────── */
function BookingMock() {
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  const slots = ["09:00", "09:30", "10:00", "11:30", "14:00", "15:30"];
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-indigo-600/10">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
          AS
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">Intro call</p>
          <p className="text-xs text-slate-500">30 min · Google Meet · Free</p>
        </div>
      </div>
      <div className="grid gap-6 p-5 sm:grid-cols-2">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            October 2026
          </p>
          <div className="grid grid-cols-7 gap-1 text-center">
            {days.map((d, i) => (
              <span key={i} className="py-1 text-[11px] font-medium text-slate-400">
                {d}
              </span>
            ))}
            {Array.from({ length: 21 }, (_, i) => {
              const day = i + 1;
              const selected = day === 14;
              return (
                <span
                  key={day}
                  className={`grid h-8 place-items-center rounded-lg text-xs ${
                    selected
                      ? "bg-indigo-600 font-semibold text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {day}
                </span>
              );
            })}
          </div>
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Wed, Oct 14
          </p>
          <div className="grid grid-cols-2 gap-2">
            {slots.map((s, i) => (
              <span
                key={s}
                className={`rounded-lg border px-3 py-2 text-center text-xs font-medium ${
                  i === 2
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-slate-200 text-slate-700"
                }`}
              >
                {s}
              </span>
            ))}
          </div>
          <div className="mt-4 rounded-lg bg-indigo-600 px-4 py-2.5 text-center text-sm font-semibold text-white">
            Confirm booking
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────── */
export default function Home() {
  return (
    <>
      <SiteNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(79,70,229,0.12),transparent)]" />
        <div className="mx-auto max-w-7xl px-4 pb-20 pt-16 text-center sm:px-6 sm:pt-24 lg:px-8">
          <a
            href="#pricing"
            className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-xs font-semibold text-indigo-700"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
            New · Razorpay payments at booking time
          </a>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
            Scheduling that sells itself
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            BookMus gives every team beautiful booking pages, automatic
            payments, calendar sync and video meetings — so the right meetings
            happen without the email ping-pong.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="w-full rounded-xl bg-indigo-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 sm:w-auto"
            >
              Start scheduling free
            </Link>
            <a
              href="#how"
              className="w-full rounded-xl border border-slate-300 bg-white px-7 py-3.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 sm:w-auto"
            >
              See how it works
            </a>
          </div>
          <div className="mx-auto mt-14 max-w-3xl">
            <BookingMock />
          </div>
        </div>
      </section>

      {/* Integrations strip */}
      <section className="border-y border-slate-200 bg-slate-50/60">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-400">
            Works with the tools you already use
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm font-semibold text-slate-500">
            {[
              "Google Calendar",
              "Zoho Calendar",
              "Google Meet",
              "Zoho Meeting",
              "Razorpay",
              "Resend",
            ].map((name) => (
              <span key={name} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-indigo-400" />
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">
            Features
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Everything scheduling needs. Nothing it doesn&apos;t.
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Built as one coherent system — not five plugins taped together.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-slate-200 bg-white p-7 transition hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-600/5"
            >
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
                <Icon d={f.d} />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-slate-900">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-slate-200 bg-slate-50/60">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Live in three steps
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="relative rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
                <span className="text-4xl font-bold text-indigo-100">{s.n}</span>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Pricing that scales with you
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-slate-600">
          Start free. Upgrade when bookings — and revenue — start flowing.
        </p>
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.name}
              className={`flex flex-col rounded-2xl p-8 ${
                p.highlight
                  ? "bg-slate-900 text-white shadow-2xl shadow-slate-900/20 ring-2 ring-indigo-500"
                  : "border border-slate-200 bg-white"
              }`}
            >
              <h3 className={`text-lg font-semibold ${p.highlight ? "text-white" : "text-slate-900"}`}>
                {p.name}
              </h3>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-bold">{p.price}</span>
                <span className={`text-sm ${p.highlight ? "text-slate-400" : "text-slate-500"}`}>
                  {p.per}
                </span>
              </div>
              <ul className="mt-6 flex-1 space-y-3">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-sm">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className={`mt-0.5 h-4 w-4 shrink-0 ${p.highlight ? "text-indigo-400" : "text-indigo-600"}`}>
                      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className={p.highlight ? "text-slate-300" : "text-slate-600"}>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className={`mt-8 rounded-xl px-5 py-3 text-center text-sm font-semibold transition ${
                  p.highlight
                    ? "bg-indigo-600 text-white hover:bg-indigo-500"
                    : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="border-y border-slate-200 bg-slate-50/60">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Loved by people who live on their calendar
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {testimonials.map((t) => (
              <figure key={t.name} className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
                <blockquote className="text-sm leading-6 text-slate-700">
                  “{t.quote}”
                </blockquote>
                <figcaption className="mt-6">
                  <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                  <p className="text-sm text-slate-500">{t.role}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-indigo-600 px-6 py-16 text-center sm:px-16">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_50%_100%,rgba(255,255,255,0.18),transparent)]" />
          <h2 className="relative text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Your calendar, on autopilot
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-indigo-100">
            Join thousands of hosts who stopped emailing about times and
            started getting booked.
          </p>
          <Link
            href="/signup"
            className="relative mt-8 inline-block rounded-xl bg-white px-8 py-3.5 text-sm font-semibold text-indigo-700 shadow-lg transition hover:bg-indigo-50"
          >
            Get started free
          </Link>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
