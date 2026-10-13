/**
 * Booking-page builder config (spec §4).
 * Owners edit a draft, preview, publish; every publish snapshots a version.
 * The public page renders only the published config.
 */

export interface PageConfig {
  headline?: string;
  intro?: string;
  accent_color?: string;
  theme?: "light" | "dark";
  event_order?: string[];
  hidden_events?: string[];
  show_prices?: boolean;
}

export const DEFAULT_PAGE_CONFIG: Required<PageConfig> = {
  headline: "",
  intro: "",
  accent_color: "#4f46e5",
  theme: "light",
  event_order: [],
  hidden_events: [],
  show_prices: true,
};

export function mergeConfig(stored: unknown): Required<PageConfig> {
  const s = (stored ?? {}) as Partial<PageConfig>;
  return {
    headline: s.headline ?? "",
    intro: s.intro ?? "",
    accent_color: s.accent_color ?? DEFAULT_PAGE_CONFIG.accent_color,
    theme: s.theme === "dark" ? "dark" : "light",
    event_order: Array.isArray(s.event_order) ? s.event_order : [],
    hidden_events: Array.isArray(s.hidden_events) ? s.hidden_events : [],
    show_prices: s.show_prices !== false,
  };
}

/** Order + visibility for the public list. */
export function arrangeEvents<T extends { id: string }>(
  events: T[],
  config: Required<PageConfig>
): T[] {
  const visible = events.filter(
    (e) => !config.hidden_events.includes(e.id)
  );
  if (!config.event_order.length) return visible;
  const order = new Map(config.event_order.map((id, i) => [id, i]));
  return [...visible].sort(
    (a, b) =>
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
}
