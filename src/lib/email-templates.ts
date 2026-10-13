import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Email template studio backend (spec §9.2). Owners customize per-event
 * templates with safe {{merge_fields}}; the worker prefers the active
 * custom template and falls back to the built-in one.
 */

export type TemplateEvent =
  | "booking_confirmation"
  | "booking_cancellation"
  | "booking_rescheduled"
  | "booking_reminder";

export const TEMPLATE_EVENTS: { key: TemplateEvent; label: string }[] = [
  { key: "booking_confirmation", label: "Booking confirmed" },
  { key: "booking_cancellation", label: "Booking cancelled" },
  { key: "booking_rescheduled", label: "Booking rescheduled" },
  { key: "booking_reminder", label: "Reminder (24h)" },
];

export const TEMPLATE_FIELDS: { key: string; label: string }[] = [
  { key: "host_name", label: "Host name" },
  { key: "event_title", label: "Event title" },
  { key: "when_text", label: "Date & time" },
  { key: "old_when_text", label: "Old date & time (reschedule only)" },
  { key: "new_when_text", label: "New date & time (reschedule only)" },
  { key: "booker_name", label: "Guest name" },
  { key: "meeting_url", label: "Meeting URL" },
  { key: "cancel_url", label: "Cancel link" },
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Substitute {{field}} merge tags with HTML-escaped values. */
export function renderTemplate(
  template: string,
  context: Record<string, string | null | undefined>
): string {
  return template.replace(
    /\{\{\s*([a-z_]+)\s*\}\}/g,
    (match: string, key: string) => {
      const v = context[key];
      if (v == null || v === "") return "";
      return escapeHtml(v);
    }
  );
}

export interface ResolvedTemplate {
  subject: string;
  html: string;
}

/**
 * Returns the owner's active custom template rendered with context,
 * or null when the owner hasn't customized this event (use built-in).
 */
export async function resolveCustomTemplate(
  supabase: SupabaseClient,
  ownerProfileId: string,
  event: TemplateEvent,
  context: Record<string, string | null | undefined>
): Promise<ResolvedTemplate | null> {
  const { data } = await supabase
    .from("email_templates")
    .select("subject, html_body")
    .eq("owner_profile_id", ownerProfileId)
    .eq("event", event)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    subject: renderTemplate(data.subject as string, context),
    html: renderTemplate(data.html_body as string, context),
  };
}

/** Sample context for the studio preview. */
export function sampleContext(): Record<string, string> {
  return {
    host_name: "Aarav Patel",
    event_title: "Product Demo",
    when_text: "Friday, 17 October, 3:00 PM",
    old_when_text: "Thursday, 16 October, 3:00 PM",
    new_when_text: "Friday, 17 October, 3:00 PM",
    booker_name: "Jordan Lee",
    meeting_url: "https://meet.google.com/abc-defg-hij",
    cancel_url: "https://bookmus.vercel.app/b/cancel/sample-token",
  };
}
