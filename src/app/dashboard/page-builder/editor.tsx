"use client";

import { useMemo, useState } from "react";
import type { PageConfig } from "@/lib/page-builder";
import { mergeConfig, arrangeEvents } from "@/lib/page-builder";

interface EventType {
  id: string;
  title: string;
  duration_minutes: number;
  price_paise: number;
  color: string;
}

export function PageBuilderEditor({
  initialDraft,
  eventTypes,
  hostName,
  hostBio,
  saveDraft,
  publishPage,
}: {
  initialDraft: PageConfig;
  eventTypes: EventType[];
  hostName: string;
  hostBio: string;
  saveDraft: (formData: FormData) => Promise<void>;
  publishPage: () => Promise<void>;
}) {
  const merged = useMemo(() => mergeConfig(initialDraft), [initialDraft]);
  const [headline, setHeadline] = useState(merged.headline);
  const [intro, setIntro] = useState(merged.intro);
  const [accent, setAccent] = useState(merged.accent_color);
  const [theme, setTheme] = useState<"light" | "dark">(merged.theme);
  const [showPrices, setShowPrices] = useState(merged.show_prices);
  const [order, setOrder] = useState<string[]>(
    merged.event_order.length
      ? merged.event_order
      : eventTypes.map((e) => e.id)
  );
  const [hidden, setHidden] = useState<string[]>(merged.hidden_events);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const previewEvents = useMemo(() => {
    const byId = new Map(eventTypes.map((e) => [e.id, e]));
    const ordered = order
      .map((id) => byId.get(id))
      .filter((e): e is EventType => !!e);
    const rest = eventTypes.filter((e) => !order.includes(e.id));
    return arrangeEvents([...ordered, ...rest], {
      ...mergeConfig({}),
      event_order: order,
      hidden_events: hidden,
    });
  }, [eventTypes, order, hidden]);

  function move(id: string, dir: -1 | 1) {
    setOrder((o) => {
      const i = o.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function toggleHidden(id: string) {
    setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  }

  function buildForm(): FormData {
    const fd = new FormData();
    fd.set("headline", headline);
    fd.set("intro", intro);
    fd.set("accent_color", accent);
    fd.set("theme", theme);
    fd.set("event_order", JSON.stringify(order));
    fd.set("hidden_events", JSON.stringify(hidden));
    if (showPrices) fd.set("show_prices", "on");
    return fd;
  }

  async function onSave() {
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      await saveDraft(buildForm());
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onPublish() {
    if (!confirm("Publish this design to your live booking page?")) return;
    setBusy("publish");
    setError(null);
    try {
      await saveDraft(buildForm());
      await publishPage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed.");
    } finally {
      setBusy(null);
    }
  }

  const dark = theme === "dark";

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-2">
      {/* Controls */}
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold text-slate-900">Branding</h2>
          <label className="mb-1.5 mt-4 block text-sm font-medium text-slate-700">
            Headline
          </label>
          <input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder={hostName}
            maxLength={120}
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500"
          />
          <label className="mb-1.5 mt-4 block text-sm font-medium text-slate-700">
            Intro
          </label>
          <textarea
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            placeholder={hostBio || "A short intro for your guests…"}
            maxLength={500}
            rows={3}
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500"
          />
          <div className="mt-4 flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-slate-300"
              />
              Accent color
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={theme === "dark"}
                onChange={(e) => setTheme(e.target.checked ? "dark" : "light")}
                className="accent-indigo-600"
              />
              Dark theme
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={showPrices}
                onChange={(e) => setShowPrices(e.target.checked)}
                className="accent-indigo-600"
              />
              Show prices
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold text-slate-900">Events</h2>
          <p className="text-xs text-slate-500">
            Reorder with ↑↓, or hide events from the page.
          </p>
          <ul className="mt-4 space-y-2">
            {order.map((id) => {
              const e = eventTypes.find((x) => x.id === id);
              if (!e) return null;
              const isHidden = hidden.includes(id);
              return (
                <li
                  key={id}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${
                    isHidden
                      ? "border-slate-200 bg-slate-50 opacity-60"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <span className="flex-1 truncate text-sm font-medium text-slate-800">
                    {e.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => move(id, -1)}
                    className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(id, 1)}
                    className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleHidden(id)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                      isHidden
                        ? "bg-slate-200 text-slate-600"
                        : "bg-indigo-50 text-indigo-700"
                    }`}
                  >
                    {isHidden ? "Hidden" : "Visible"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
        {saved && (
          <p className="rounded-lg bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
            Draft saved.
          </p>
        )}
        <div className="flex gap-3">
          <button
            onClick={onSave}
            disabled={busy !== null}
            className="flex-1 rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
          <button
            onClick={onPublish}
            disabled={busy !== null}
            className="flex-1 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy === "publish" ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>

      {/* Live preview */}
      <div>
        <p className="mb-2 text-sm font-medium text-slate-500">
          Live preview (draft)
        </p>
        <div
          className={`overflow-hidden rounded-2xl border ${
            dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"
          }`}
        >
          <div className="p-6">
            <div className="flex items-center gap-4">
              <div
                className="grid h-14 w-14 place-items-center rounded-xl text-lg font-bold text-white"
                style={{ backgroundColor: accent }}
              >
                {hostName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p
                  className={`text-lg font-bold ${dark ? "text-white" : "text-slate-900"}`}
                >
                  {headline || hostName}
                </p>
                {(intro || hostBio) && (
                  <p
                    className={`mt-0.5 text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}
                  >
                    {intro || hostBio}
                  </p>
                )}
              </div>
            </div>
            <p
              className={`mt-6 text-xs font-semibold uppercase tracking-widest ${
                dark ? "text-slate-500" : "text-slate-400"
              }`}
            >
              Book a time
            </p>
            <div className="mt-3 space-y-2">
              {previewEvents.map((e) => (
                <div
                  key={e.id}
                  className={`flex items-center gap-3 rounded-xl border p-4 ${
                    dark
                      ? "border-slate-700 bg-slate-800"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <span
                    className="h-10 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: accent }}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-sm font-semibold ${
                        dark ? "text-white" : "text-slate-900"
                      }`}
                    >
                      {e.title}
                    </p>
                    <p
                      className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}
                    >
                      {e.duration_minutes} min
                      {showPrices &&
                        e.price_paise > 0 &&
                        ` · ₹${(e.price_paise / 100).toLocaleString("en-IN")}`}
                    </p>
                  </div>
                </div>
              ))}
              {previewEvents.length === 0 && (
                <p
                  className={`rounded-xl border border-dashed p-6 text-center text-xs ${
                    dark
                      ? "border-slate-700 text-slate-500"
                      : "border-slate-300 text-slate-400"
                  }`}
                >
                  All events hidden — the page will show an empty state.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
