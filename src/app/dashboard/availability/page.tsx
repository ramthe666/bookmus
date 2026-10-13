import { createClient } from "@/lib/supabase/server";
import { ensureDefaultSchedule, type WeeklyHours } from "@/lib/scheduling";
import { AvailabilityEditor } from "@/components/availability-editor";
import { saveAvailability } from "../actions";

export default async function AvailabilityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .single();

  const schedule = await ensureDefaultSchedule(
    supabase,
    user.id,
    profile?.timezone ?? "Asia/Kolkata"
  );

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Availability
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        When can guests book you? Times are in{" "}
        <span className="font-medium text-slate-700">
          {profile?.timezone ?? "Asia/Kolkata"}
        </span>{" "}
        (change it in Settings).
      </p>
      <div className="mt-8">
        <AvailabilityEditor
          initial={(schedule.weekly_hours ?? {}) as WeeklyHours}
          action={saveAvailability}
        />
      </div>
      <p className="mt-4 text-xs text-slate-400">
        Buffers, minimum notice and daily caps are set per event type.
      </p>
    </div>
  );
}
