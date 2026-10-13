import { EventTypeForm, type EventTypeValues } from "@/components/event-type-form";
import { createEventType } from "../../actions";
import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/teams";

const defaults: EventTypeValues = {
  title: "",
  slug: "",
  description: "",
  duration_minutes: 30,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  min_notice_hours: 2,
  max_ahead_days: 60,
  max_bookings_per_day: "",
  price_rupees: "",
  location_type: "video",
  meeting_provider: "google_meet",
  color: "#4f46e5",
  is_active: true,
  organization_id: "",
  scheduling_mode: "single",
  host_ids: [],
};

async function loadTeamMembers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const orgs = await getUserOrgs(supabase, userId);
  if (!orgs.length) return { orgs, members: [] as { orgId: string; id: string; name: string }[] };
  const { data } = await supabase
    .from("organization_members")
    .select("organization_id, profile_id, profiles(display_name)")
    .in(
      "organization_id",
      orgs.map((o) => o.organization_id)
    );
  const members = (data ?? []).map((m) => {
    const prof = m.profiles as unknown as { display_name: string | null } | null;
    return {
      orgId: m.organization_id as string,
      id: m.profile_id as string,
      name: prof?.display_name ?? "Team member",
    };
  });
  return { orgs, members };
}

export default async function NewEventTypePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { orgs, members } = user
    ? await loadTeamMembers(supabase, user.id)
    : { orgs: [], members: [] };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        New event type
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Define a meeting guests can book.
      </p>
      <div className="mt-8">
        <EventTypeForm
          initial={defaults}
          action={createEventType}
          submitLabel="Create event type"
          organizations={orgs.map((o) => ({
            id: o.organization_id,
            name: o.organizations.name,
          }))}
          teamMembers={members}
        />
      </div>
    </div>
  );
}
