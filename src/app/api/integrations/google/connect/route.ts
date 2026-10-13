import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleAuthUrl } from "@/lib/integrations/calendar";

/** Start Google OAuth — redirects the host to Google's consent screen. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect("/login");
  return NextResponse.redirect(googleAuthUrl(user.id));
}
