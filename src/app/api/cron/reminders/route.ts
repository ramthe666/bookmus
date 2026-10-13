import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  sendEmail,
  bookingReminderEmail,
  isEmailConfigured,
} from "@/lib/integrations/email";
import { expireStaleHolds } from "@/lib/booking-lifecycle";

/**
 * Reminder + lifecycle sweep (Vercel Cron / cron-job.org → /api/cron/reminders).
 * 1. Expires stale payment holds (pending > 30 min) so their slots release.
 * 2. Sends a reminder for confirmed bookings starting in ~24h that
 *    haven't been reminded yet. Guarded by CRON_SECRET.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isEmailConfigured()) {
    return NextResponse.json({ skipped: "email_not_configured" });
  }

  const supabase = await createServiceClient();

  // Release slots held by abandoned payment attempts.
  const expired = await expireStaleHolds(supabase);

  const now = new Date();
  const from = new Date(now.getTime() + 23 * 3600_000).toISOString();
  const to = new Date(now.getTime() + 25 * 3600_000).toISOString();

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, booker_name, booker_email, booker_timezone, meeting_url, event_types!inner(title)"
    )
    .eq("status", "confirmed")
    .gte("starts_at", from)
    .lt("starts_at", to)
    .limit(500);

  if (error) {
    console.error("Reminder sweep query failed:", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const { data: already } = await supabase
    .from("notification_log")
    .select("booking_id")
    .eq("template", "booking_reminder")
    .gte("created_at", new Date(now.getTime() - 26 * 3600_000).toISOString());

  const reminded = new Set((already ?? []).map((r) => r.booking_id));
  let sent = 0;

  for (const b of bookings ?? []) {
    if (reminded.has(b.id)) continue;
    try {
      const et = b.event_types as unknown as { title: string };
      const whenText = new Intl.DateTimeFormat("en-IN", {
        timeZone: b.booker_timezone ?? "Asia/Kolkata",
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(b.starts_at));
      const mail = bookingReminderEmail({
        hostName: "your host",
        eventTitle: et.title,
        whenText,
        bookerName: b.booker_name,
        meetingUrl: b.meeting_url,
      });
      const res = await sendEmail({
        to: b.booker_email,
        subject: mail.subject,
        html: mail.html,
      });
      await supabase.from("notification_log").insert({
        booking_id: b.id,
        channel: "email",
        template: "booking_reminder",
        recipient: b.booker_email,
        provider: "resend",
        provider_id: res.providerId ?? null,
        status: res.ok ? "sent" : "failed",
        error: res.error ?? null,
      });
      if (res.ok) sent++;
    } catch (e) {
      console.error(`Reminder failed for booking ${b.id}:`, e);
    }
  }

  return NextResponse.json({
    sent,
    checked: (bookings ?? []).length,
    expired,
  });
}
