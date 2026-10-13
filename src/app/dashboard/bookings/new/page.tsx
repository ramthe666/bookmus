import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ManualBookingForm } from "./manual-booking-form";

export default async function NewManualBookingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  const tz = (profile?.timezone as string | undefined) ?? "Asia/Kolkata";

  // Manageable event types: owned, or belonging to an org the user is in
  // (mirrors can_manage_event_type; the server action re-verifies).
  const { data: orgIds } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("profile_id", user.id);
  const orgList = (orgIds ?? []).map((r) => r.organization_id as string);

  let query = supabase
    .from("event_types")
    .select("id, title, duration_minutes, is_active, scheduling_mode")
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (orgList.length > 0) {
    query = query.or(
      `owner_profile_id.eq.${user.id},organization_id.in.(${orgList.join(",")})`
    );
  } else {
    query = query.eq("owner_profile_id", user.id);
  }
  const { data: eventTypes } = await query;

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/dashboard/bookings"
        className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
      >
        ← Back to bookings
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
        New booking
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Book directly for a guest — confirmed immediately. Booking outside
        normal availability needs a written reason, which is kept in the audit
        trail.
      </p>

      <div className="mt-6">
        <ManualBookingForm
          timezone={tz}
          eventTypes={(eventTypes ?? []).map((e) => ({
            id: e.id as string,
            title: e.title as string,
            duration_minutes: e.duration_minutes as number,
          }))}
        />
      </div>
    </div>
  );
}
