import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeGoogleCode,
  encryptToken,
} from "@/lib/integrations/calendar";

function appUrl(request: Request): string {
  return new URL(request.url).origin;
}

/**
 * Google OAuth callback — ?code=…&state=<userId>
 * Exchanges the code, encrypts tokens, upserts connected_calendars.
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
    const tokens = await exchangeGoogleCode(code);

    // Best-effort account email for display.
    let accountEmail: string | null = null;
    try {
      const me = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
      );
      if (me.ok) {
        const j = (await me.json()) as { email?: string };
        accountEmail = j.email ?? null;
      }
    } catch {
      /* non-fatal */
    }

    // Delete-then-insert: the unique constraint includes nullable
    // organization_id, so upsert(onConflict) cannot match on reconnect.
    await supabase
      .from("connected_calendars")
      .delete()
      .eq("owner_profile_id", user.id)
      .eq("provider", "google")
      .is("organization_id", null);

    const { error } = await supabase.from("connected_calendars").insert(
      {
        owner_profile_id: user.id,
        organization_id: null,
        provider: "google",
        provider_account_email: accountEmail,
        access_token_ciphertext: encryptToken(tokens.accessToken),
        refresh_token_ciphertext: tokens.refreshToken
          ? encryptToken(tokens.refreshToken)
          : null,
        expires_at: tokens.expiresAt.toISOString(),
        scopes: ["calendar.events"],
        is_primary: true,
      }
    );
    if (error) throw error;

    return NextResponse.redirect(
      `${origin}/dashboard/integrations?connected=google`
    );
  } catch (e) {
    console.error("Google OAuth callback failed:", e);
    return NextResponse.redirect(
      `${origin}/dashboard/integrations?error=oauth_failed`
    );
  }
}
