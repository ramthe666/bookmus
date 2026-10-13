import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Minimal booking context for the host reschedule picker.
 * RLS restricts to the event owner's bookings.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, event_type_id, timezone")
    .eq("id", id)
    .maybeSingle();
  if (!booking) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    eventTypeId: booking.event_type_id,
    timezone: booking.timezone,
  });
}
