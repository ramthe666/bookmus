import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { zohoAuthUrl } from "@/lib/integrations/calendar";

/** Start Zoho OAuth — redirects the host to Zoho's consent screen. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect("/login");
  return NextResponse.redirect(zohoAuthUrl(user.id));
}
