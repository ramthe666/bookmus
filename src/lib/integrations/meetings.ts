/**
 * Meeting providers.
 *
 * Google Meet links are minted through the Google Calendar API
 * (conferenceData on event creation — see calendar.ts). Zoho Meeting
 * has its own API; this module wraps session creation for it.
 */

export interface ZohoMeetingInput {
  accessToken: string;
  title: string;
  startsAtIso: string;
  endsAtIso: string;
  timeZone: string;
  attendeeEmails: string[];
}

/**
 * Create a Zoho Meeting session and return the join URL.
 * Requires the ZohoMeeting.meeting.CREATE scope on the OAuth app.
 */
export async function createZohoMeeting(
  input: ZohoMeetingInput
): Promise<{ meetingId: string; joinUrl: string }> {
  const res = await fetch("https://meeting.zoho.com/api/v2/meetings", {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: input.title,
      startTime: input.startsAtIso,
      endTime: input.endsAtIso,
      timeZone: input.timeZone,
      participants: input.attendeeEmails.map((email) => ({ email })),
    }),
  });
  if (!res.ok) {
    throw new Error(`Zoho Meeting creation failed: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    meetings?: { meetingId?: string; id?: string; joinUrl?: string }[];
  };
  const m = data.meetings?.[0];
  return {
    meetingId: m?.meetingId ?? m?.id ?? "",
    joinUrl: m?.joinUrl ?? "",
  };
}

/**
 * Resolve which meeting provider an event type wants and whether we can
 * fulfill it right now (tokens connected). Used by booking confirmation
 * to decide whether to auto-create the meeting link.
 */
export type MeetingProvider = "google_meet" | "zoho_meeting" | "none";

export function describeMeetingProvider(p: MeetingProvider): string {
  switch (p) {
    case "google_meet":
      return "Google Meet link auto-created with the calendar invite";
    case "zoho_meeting":
      return "Zoho Meeting link auto-created with the calendar invite";
    case "none":
      return "No automatic meeting link";
  }
}
