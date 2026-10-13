/**
 * Calendar adapters — Google Calendar & Zoho Calendar.
 *
 * OAuth tokens are stored in `connected_calendars` encrypted with
 * TOKEN_ENCRYPTION_KEY (AES-256-GCM). This module handles the OAuth
 * dance, token lifecycle, event CRUD and busy-time reads over plain
 * HTTPS (no heavy SDKs).
 */
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

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

export async function refreshZohoToken(refreshToken: string): Promise<OAuthTokens> {
  const res = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.ZOHO_CLIENT_ID ?? "",
      client_secret: process.env.ZOHO_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Zoho token refresh failed: ${await res.text()}`);
  const t = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: t.access_token,
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
  };
}

/* ── Token lifecycle ────────────────────────────────────────────── */

export interface CalendarConnection {
  id: string;
  provider: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  expires_at: string | null;
}

const TOKEN_SKEW_MS = 5 * 60_000;

/**
 * Returns a usable access token for a stored connection, refreshing and
 * persisting it when expired. Throws when no refresh is possible — callers
 * decide whether that is fatal or degraded.
 */
export async function getValidAccessToken(
  supabase: SupabaseClient,
  conn: CalendarConnection
): Promise<string> {
  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > TOKEN_SKEW_MS) {
    return decryptToken(conn.access_token_ciphertext);
  }
  if (!conn.refresh_token_ciphertext) {
    throw new Error(`${conn.provider} token expired and cannot be refreshed.`);
  }
  const refreshToken = decryptToken(conn.refresh_token_ciphertext);
  const fresh =
    conn.provider === "google"
      ? await refreshGoogleToken(refreshToken)
      : await refreshZohoToken(refreshToken);
  const patch: Record<string, string | null> = {
    access_token_ciphertext: encryptToken(fresh.accessToken),
    expires_at: fresh.expiresAt.toISOString(),
  };
  if (fresh.refreshToken) {
    patch.refresh_token_ciphertext = encryptToken(fresh.refreshToken);
  }
  const { error } = await supabase
    .from("connected_calendars")
    .update(patch)
    .eq("id", conn.id);
  if (error) throw new Error(`Could not persist refreshed token: ${error.message}`);
  return fresh.accessToken;
}

/** All calendar connections for a host (service-role caller). */
export async function getHostConnections(
  supabase: SupabaseClient,
  ownerProfileId: string
): Promise<CalendarConnection[]> {
  const { data, error } = await supabase
    .from("connected_calendars")
    .select(
      "id, provider, access_token_ciphertext, refresh_token_ciphertext, expires_at"
    )
    .eq("owner_profile_id", ownerProfileId);
  if (error) throw new Error(`Could not load calendar connections: ${error.message}`);
  return (data ?? []) as CalendarConnection[];
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
 * Move an existing Google Calendar event to a new time (reschedule).
 * Updates in place so guests don't get duplicate invites.
 */
export async function updateGoogleEvent(
  accessToken: string,
  providerEventId: string,
  input: Pick<CalendarEventInput, "startsAtIso" | "endsAtIso" | "timeZone" | "title" | "description">
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(providerEventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(input.title ? { summary: input.title } : {}),
        ...(input.description ? { description: input.description } : {}),
        start: { dateTime: input.startsAtIso, timeZone: input.timeZone },
        end: { dateTime: input.endsAtIso, timeZone: input.timeZone },
      }),
    }
  );
  if (!res.ok) throw new Error(`Google event update failed: ${await res.text()}`);
}

export async function deleteZohoEvent(
  accessToken: string,
  providerEventId: string
): Promise<void> {
  const res = await fetch(
    `https://www.zohoapis.com/calendar/v1/calendars/primary/events/${encodeURIComponent(providerEventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Zoho event deletion failed: ${await res.text()}`);
  }
}

export async function updateZohoEvent(
  accessToken: string,
  providerEventId: string,
  input: Pick<CalendarEventInput, "startsAtIso" | "endsAtIso" | "timeZone" | "title">
): Promise<void> {
  const res = await fetch(
    `https://www.zohoapis.com/calendar/v1/calendars/primary/events/${encodeURIComponent(providerEventId)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(input.title ? { title: input.title } : {}),
        starttime: input.startsAtIso,
        endtime: input.endsAtIso,
        timezone: input.timeZone,
      }),
    }
  );
  if (!res.ok) throw new Error(`Zoho event update failed: ${await res.text()}`);
}

/* ── Busy-time reads (spec §8.2: external events → busy blocks) ─── */

export interface BusyBlock {
  starts_at: string;
  ends_at: string;
}

/** Google freebusy → privacy-preserving busy intervals (no titles). */
export async function getGoogleBusyBlocks(
  accessToken: string,
  fromIso: string,
  toIso: string
): Promise<BusyBlock[]> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: fromIso,
      timeMax: toIso,
      items: [{ id: "primary" }],
    }),
  });
  if (!res.ok) throw new Error(`Google freebusy failed: ${await res.text()}`);
  const j = (await res.json()) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  };
  const busy = j.calendars?.primary?.busy ?? [];
  return busy.map((b) => ({ starts_at: b.start, ends_at: b.end }));
}

/**
 * Zoho has no freebusy endpoint on this scope; list events in the range
 * and normalize to busy intervals (titles are dropped — busy only).
 */
export async function getZohoBusyBlocks(
  accessToken: string,
  fromIso: string,
  toIso: string
): Promise<BusyBlock[]> {
  const params = new URLSearchParams({
    start: fromIso,
    end: toIso,
  });
  const res = await fetch(
    `https://www.zohoapis.com/calendar/v1/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Zoho events list failed: ${await res.text()}`);
  const j = (await res.json()) as {
    events?: {
      starttime?: string;
      endtime?: string;
      start?: string;
      end?: string;
    }[];
  };
  return (j.events ?? [])
    .filter((e) => (e.starttime ?? e.start) && (e.endtime ?? e.end))
    .map((e) => ({
      starts_at: (e.starttime ?? e.start) as string,
      ends_at: (e.endtime ?? e.end) as string,
    }));
}

/**
 * Merged external busy blocks for a host across all connected calendars.
 * Never throws — a provider outage degrades to "no external busy data"
 * (logged), never to a broken booking page (spec §8.2 fail-safe).
 */
export async function getHostBusyBlocks(
  supabase: SupabaseClient,
  ownerProfileId: string,
  fromIso: string,
  toIso: string
): Promise<BusyBlock[]> {
  try {
    const conns = await getHostConnections(supabase, ownerProfileId);
    const blocks: BusyBlock[] = [];
    for (const conn of conns) {
      try {
        const token = await getValidAccessToken(supabase, conn);
        const busy =
          conn.provider === "google"
            ? await getGoogleBusyBlocks(token, fromIso, toIso)
            : await getZohoBusyBlocks(token, fromIso, toIso);
        blocks.push(...busy);
      } catch (e) {
        console.error(`Busy-time read failed (${conn.provider}):`, e);
      }
    }
    return blocks;
  } catch (e) {
    console.error("Busy-time read failed:", e);
    return [];
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
