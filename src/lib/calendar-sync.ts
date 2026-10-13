import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getHostConnections,
  getValidAccessToken,
  createGoogleEvent,
  createZohoEvent,
  updateGoogleEvent,
  updateZohoEvent,
  deleteGoogleEvent,
  deleteZohoEvent,
  type CalendarConnection,
} from "@/lib/integrations/calendar";

/**
 * Booking ↔ provider-calendar synchronization (spec §8.2).
 *
 * - BookFlow owns the booking truth; provider events are linked mirrors.
 * - Every attempt records a visible sync status on the booking row —
 *   a provider outage is surfaced, never silently pretended (spec §1.2).
 * - All entry points are best-effort and never throw.
 */

interface SyncableBooking {
  id: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  booker_name: string;
  booker_email: string;
  meeting_url: string | null;
  meeting_provider: string | null;
  calendar_provider: string | null;
  calendar_event_id: string | null;
  event_title: string;
  host_name: string;
  owner_profile_id: string;
}

async function loadSyncable(
  supabase: SupabaseClient,
  bookingId: string
): Promise<SyncableBooking | null> {
  const { data: b } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, ends_at, timezone, booker_name, booker_email, meeting_url, meeting_provider, calendar_provider, calendar_event_id, event_types!inner(title, owner_profile_id)"
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!b) return null;
  const et = b.event_types as unknown as {
    title: string;
    owner_profile_id: string;
  };
  let hostName = "your host";
  const { data: host } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", et.owner_profile_id)
    .maybeSingle();
  if (host?.display_name) hostName = host.display_name;
  return {
    id: b.id as string,
    starts_at: b.starts_at as string,
    ends_at: b.ends_at as string,
    timezone: (b.timezone as string) ?? "Asia/Kolkata",
    booker_name: b.booker_name as string,
    booker_email: b.booker_email as string,
    meeting_url: (b.meeting_url as string | null) ?? null,
    meeting_provider: (b.meeting_provider as string | null) ?? null,
    calendar_provider: (b.calendar_provider as string | null) ?? null,
    calendar_event_id: (b.calendar_event_id as string | null) ?? null,
    event_title: et.title,
    host_name: hostName,
    owner_profile_id: et.owner_profile_id,
  };
}

async function markSynced(
  supabase: SupabaseClient,
  bookingId: string,
  patch: Record<string, string | null>
) {
  await supabase
    .from("bookings")
    .update({
      ...patch,
      calendar_sync_status: "synced",
      calendar_sync_error: null,
      calendar_synced_at: new Date().toISOString(),
    })
    .eq("id", bookingId);
}

async function markFailed(
  supabase: SupabaseClient,
  bookingId: string,
  error: unknown
) {
  const message =
    error instanceof Error ? error.message.slice(0, 500) : "Unknown sync error";
  await supabase
    .from("bookings")
    .update({
      calendar_sync_status: "failed",
      calendar_sync_error: message,
    })
    .eq("id", bookingId);
  console.error(`Calendar sync failed for booking ${bookingId}:`, error);
}

function eventTitle(b: SyncableBooking): string {
  return `${b.event_title} — ${b.booker_name}`;
}

/**
 * Create linked provider events for a confirmed booking (one per connected
 * calendar). Records provider + event id + meeting URL on success.
 */
export async function syncBookingToCalendars(
  supabase: SupabaseClient,
  bookingId: string
): Promise<void> {
  try {
    const b = await loadSyncable(supabase, bookingId);
    if (!b) return;
    const conns = await getHostConnections(supabase, b.owner_profile_id);
    if (conns.length === 0) return; // nothing connected: stays not_attempted

    let primary: CalendarConnection | null = null;
    for (const conn of conns) {
      try {
        const token = await getValidAccessToken(supabase, conn);
        const withMeet =
          conn.provider === "google" && b.meeting_provider === "google";
        const created =
          conn.provider === "google"
            ? await createGoogleEvent(token, {
                title: eventTitle(b),
                description: `BookMus booking ${b.id}`,
                startsAtIso: b.starts_at,
                endsAtIso: b.ends_at,
                timeZone: b.timezone,
                attendees: [b.booker_email],
                withMeet,
              })
            : await createZohoEvent(token, {
                title: eventTitle(b),
                description: `BookMus booking ${b.id}`,
                startsAtIso: b.starts_at,
                endsAtIso: b.ends_at,
                timeZone: b.timezone,
                attendees: [b.booker_email],
              });
        if (!primary) primary = conn;
        // Remember the first provider event as the linked one.
        if (conn === primary) {
          await markSynced(supabase, b.id, {
            calendar_provider: conn.provider,
            calendar_event_id: created.providerEventId,
            meeting_url: created.meetingUrl ?? b.meeting_url,
          });
        }
      } catch (e) {
        await markFailed(supabase, b.id, e);
      }
    }
  } catch (e) {
    console.error(`Calendar sync failed for booking ${bookingId}:`, e);
  }
}

/**
 * Move the linked provider event on reschedule (no duplicates).
 * If the update fails, the BookFlow booking keeps its new time and the
 * failure is surfaced for retry — the original provider event is left
 * alone rather than silently dropped (spec §5.4).
 */
export async function updateSyncedBooking(
  supabase: SupabaseClient,
  bookingId: string
): Promise<void> {
  try {
    const b = await loadSyncable(supabase, bookingId);
    if (!b || !b.calendar_provider || !b.calendar_event_id) return;
    const conns = await getHostConnections(supabase, b.owner_profile_id);
    const conn = conns.find((c) => c.provider === b.calendar_provider);
    if (!conn) {
      await markFailed(supabase, b.id, new Error("Calendar disconnected"));
      return;
    }
    const token = await getValidAccessToken(supabase, conn);
    if (conn.provider === "google") {
      await updateGoogleEvent(token, b.calendar_event_id, {
        title: eventTitle(b),
        startsAtIso: b.starts_at,
        endsAtIso: b.ends_at,
        timeZone: b.timezone,
      });
    } else {
      await updateZohoEvent(token, b.calendar_event_id, {
        title: eventTitle(b),
        startsAtIso: b.starts_at,
        endsAtIso: b.ends_at,
        timeZone: b.timezone,
      });
    }
    await markSynced(supabase, b.id, {});
  } catch (e) {
    await markFailed(supabase, bookingId, e);
  }
}

/**
 * Delete the linked provider event on cancellation. Failures are surfaced
 * on the booking row for retry; the BookFlow cancellation itself is never
 * rolled back because a provider was down (spec §7.2).
 */
export async function deleteSyncedBooking(
  supabase: SupabaseClient,
  bookingId: string
): Promise<void> {
  try {
    const b = await loadSyncable(supabase, bookingId);
    if (!b || !b.calendar_provider || !b.calendar_event_id) return;
    const conns = await getHostConnections(supabase, b.owner_profile_id);
    const conn = conns.find((c) => c.provider === b.calendar_provider);
    if (!conn) return; // disconnected: nothing to clean up remotely
    const token = await getValidAccessToken(supabase, conn);
    if (conn.provider === "google") {
      await deleteGoogleEvent(token, b.calendar_event_id);
    } else {
      await deleteZohoEvent(token, b.calendar_event_id);
    }
    await supabase
      .from("bookings")
      .update({
        calendar_event_id: null,
        calendar_sync_status: "synced",
        calendar_sync_error: null,
        calendar_synced_at: new Date().toISOString(),
      })
      .eq("id", b.id);
  } catch (e) {
    await markFailed(supabase, bookingId, e);
  }
}
