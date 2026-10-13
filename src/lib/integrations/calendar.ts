/**
 * Calendar adapters — Google Calendar & Zoho Calendar.
 *
 * OAuth tokens are stored in `connected_calendars` encrypted with
 * TOKEN_ENCRYPTION_KEY (AES-256-GCM). This module handles the OAuth
 * dance, token refresh and event CRUD over plain HTTPS (no heavy SDKs).
 */
import crypto from "crypto";

/* ── Token encryption (AES-256-GCM) ─────────────────────────────── */

function encryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set.");
  // Accept a 64-char hex string or derive from any passphrase.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptToken(plaintext: string): string {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}

export function decryptToken(payload: string): string {
  const key = encryptionKey();
  const [ivHex, tagHex, encHex] = payload.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encHex, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

/* ── OAuth URLs ─────────────────────────────────────────────────── */

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export function googleAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: `${appUrl()}/api/integrations/google/callback`,
    response_type: "code",
    scope: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.events",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export function zohoAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.ZOHO_CLIENT_ID ?? "",
    redirect_uri: `${appUrl()}/api/integrations/zoho/callback`,
    response_type: "code",
    scope: "ZohoCalendar.calendar.ALL,ZohoMeeting.meeting.CREATE",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.zoho.com/oauth/v2/auth?${p.toString()}`;
}

/* ── Token exchange / refresh ───────────────────────────────────── */

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  accountEmail?: string;
}

export async function exchangeGoogleCode(code: string): Promise<OAuthTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: `${appUrl()}/api/integrations/google/callback`,
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  const t = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
  };
}

export async function refreshGoogleToken(refreshToken: string): Promise<OAuthTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  const t = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: t.access_token,
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
  };
}

export async function exchangeZohoCode(code: string): Promise<OAuthTokens> {
  const res = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.ZOHO_CLIENT_ID ?? "",
      client_secret: process.env.ZOHO_CLIENT_SECRET ?? "",
      redirect_uri: `${appUrl()}/api/integrations/zoho/callback`,
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!res.ok) throw new Error(`Zoho token exchange failed: ${await res.text()}`);
  const t = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
  };
}

/* ── Calendar events ────────────────────────────────────────────── */

export interface CalendarEventInput {
  title: string;
  description?: string;
  startsAtIso: string;
  endsAtIso: string;
  timeZone: string;
  attendees: string[];
  /** Request a Google Meet link on the event. */
  withMeet?: boolean;
}

export interface CalendarEventResult {
  providerEventId: string;
  meetingUrl?: string;
}

/**
 * Create a Google Calendar event. With `withMeet`, attaches a Google Meet
 * link via conferenceData (requires the calendar.events scope).
 */
export async function createGoogleEvent(
  accessToken: string,
  input: CalendarEventInput
): Promise<CalendarEventResult> {
  const body: Record<string, unknown> = {
    summary: input.title,
    description: input.description ?? "",
    start: { dateTime: input.startsAtIso, timeZone: input.timeZone },
    end: { dateTime: input.endsAtIso, timeZone: input.timeZone },
    attendees: input.attendees.map((email) => ({ email })),
  };
  let url =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  if (input.withMeet) {
    url += "?conferenceDataVersion=1";
    body.conferenceData = {
      createRequest: {
        requestId: `bm-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google event creation failed: ${await res.text()}`);
  const ev = (await res.json()) as {
    id: string;
    conferenceData?: { entryPoints?: { uri?: string }[] };
    hangoutLink?: string;
  };
  const meetingUrl =
    ev.conferenceData?.entryPoints?.find((e) => e.uri)?.uri ?? ev.hangoutLink;
  return { providerEventId: ev.id, meetingUrl };
}

export async function deleteGoogleEvent(
  accessToken: string,
  providerEventId: string
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(providerEventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok && res.status !== 410) {
    throw new Error(`Google event deletion failed: ${await res.text()}`);
  }
}

/**
 * Create a Zoho Calendar event.
 * Requires a Zoho OAuth app with Calendar scope; meeting links for Zoho
 * Meeting are attached via the `meetingProvider` flow in meetings.ts.
 */
export async function createZohoEvent(
  accessToken: string,
  input: CalendarEventInput
): Promise<CalendarEventResult> {
  const res = await fetch(
    "https://www.zohoapis.com/calendar/v1/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: input.title,
        description: input.description ?? "",
        starttime: input.startsAtIso,
        endtime: input.endsAtIso,
        timezone: input.timeZone,
        attendees: input.attendees.map((email) => ({ email })),
      }),
    }
  );
  if (!res.ok) throw new Error(`Zoho event creation failed: ${await res.text()}`);
  const ev = (await res.json()) as { events?: { event_id?: string; id?: string }[] };
  const id = ev.events?.[0]?.event_id ?? ev.events?.[0]?.id ?? "";
  return { providerEventId: id };
}

export function isCalendarConfigured(): { google: boolean; zoho: boolean } {
  return {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    zoho: Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET),
  };
}
