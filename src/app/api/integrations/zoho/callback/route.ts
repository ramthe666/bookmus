import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeZohoCode,
  encryptToken,
} from "@/lib/integrations/calendar";

function appUrl(request: Request): string {
  return new URL(request.url).origin;
}

/**
 * Zoho OAuth callback — ?code=…&state=<userId>
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const origin = appUrl(request);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!code || !user || state !== user.id) {
    return NextResponse.redirect(
      `${origin}/dashboard/integrations?error=oauth_failed`
    );
  }

  try {
    const tokens = await exchangeZohoCode(code);

    const { error } = await supabase.from("connected_calendars").upsert(
      {
        owner_profile_id: user.id,
        organization_id: null,
        provider: "zoho",
        provider_account_email: null,
        access_token_ciphertext: encryptToken(tokens.accessToken),
        refresh_token_ciphertext: tokens.refreshToken
          ? encryptToken(tokens.refreshToken)
          : null,
        expires_at: tokens.expiresAt.toISOString(),
        scopes: ["ZohoCalendar.calendar.ALL", "ZohoMeeting.meeting.CREATE"],
        is_primary: true,
      },
      { onConflict: "owner_profile_id,organization_id,provider,provider_account_email" }
    );
    if (error) throw error;

    return NextResponse.redirect(
      `${origin}/dashboard/integrations?connected=zoho`
    );
  } catch (e) {
    console.error("Zoho OAuth callback failed:", e);
    return NextResponse.redirect(
      `${origin}/dashboard/integrations?error=oauth_failed`
    );
  }
}
