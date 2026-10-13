/**
 * Transactional email via Resend.
 * Gracefully no-ops when RESEND_API_KEY / RESEND_FROM_EMAIL are unset,
 * so local dev and pre-launch deploys never crash on email.
 */
import { Resend } from "resend";

export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL
  );
}

export interface SendResult {
  ok: boolean;
  providerId?: string;
  error?: string;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendResult> {
  if (!isEmailConfigured()) {
    return { ok: false, error: "email_not_configured" };
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY!);
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, providerId: data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send_failed" };
  }
}

/* ── Templates ──────────────────────────────────────────────────── */

function shell(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a;">
<h2 style="margin:0 0 16px;">${title}</h2>
${body}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
<p style="font-size:12px;color:#94a3b8;">Sent by BookMus</p>
</body></html>`;
}

export interface BookingMailArgs {
  hostName: string;
  eventTitle: string;
  whenText: string;
  bookerName: string;
  meetingUrl?: string | null;
  cancelUrl?: string | null;
}

export function bookingConfirmationEmail(a: BookingMailArgs) {
  return {
    subject: `Confirmed: ${a.eventTitle} with ${a.hostName}`,
    html: shell(
      "You're booked! 🎉",
      `<p>Hi ${a.bookerName},</p>
       <p>Your <strong>${a.eventTitle}</strong> with ${a.hostName} is confirmed for <strong>${a.whenText}</strong>.</p>
       ${a.meetingUrl ? `<p><a href="${a.meetingUrl}">Join the meeting</a></p>` : ""}
       ${a.cancelUrl ? `<p style="font-size:13px;color:#64748b;">Need to cancel? <a href="${a.cancelUrl}">Cancel this booking</a></p>` : ""}`
    ),
  };
}

export function bookingCancellationEmail(a: BookingMailArgs) {
  return {
    subject: `Cancelled: ${a.eventTitle} with ${a.hostName}`,
    html: shell(
      "Booking cancelled",
      `<p>Hi ${a.bookerName},</p>
       <p>Your <strong>${a.eventTitle}</strong> with ${a.hostName} scheduled for <strong>${a.whenText}</strong> has been cancelled.</p>
       <p>Feel free to book another time that suits you.</p>`
    ),
  };
}

export interface RescheduleMailArgs extends BookingMailArgs {
  oldWhenText: string;
  newWhenText: string;
}

export function bookingRescheduledEmail(a: RescheduleMailArgs) {
  return {
    subject: `Rescheduled: ${a.eventTitle} with ${a.hostName}`,
    html: shell(
      "Booking rescheduled",
      `<p>Hi ${a.bookerName},</p>
       <p>Your <strong>${a.eventTitle}</strong> with ${a.hostName} has been moved.</p>
       <p style="color:#64748b;text-decoration:line-through;">${a.oldWhenText}</p>
       <p><strong>${a.newWhenText}</strong></p>
       ${a.meetingUrl ? `<p><a href="${a.meetingUrl}">Join the meeting</a></p>` : ""}
       ${a.cancelUrl ? `<p style="font-size:13px;color:#64748b;">Need to cancel? <a href="${a.cancelUrl}">Cancel this booking</a></p>` : ""}`
    ),
  };
}

export function bookingReminderEmail(a: BookingMailArgs) {
  return {
    subject: `Reminder: ${a.eventTitle} with ${a.hostName} tomorrow`,
    html: shell(
      "Reminder ⏰",
      `<p>Hi ${a.bookerName},</p>
       <p>Just a reminder about your <strong>${a.eventTitle}</strong> with ${a.hostName} — <strong>${a.whenText}</strong>.</p>
       ${a.meetingUrl ? `<p><a href="${a.meetingUrl}">Join the meeting</a></p>` : ""}`
    ),
  };
}
