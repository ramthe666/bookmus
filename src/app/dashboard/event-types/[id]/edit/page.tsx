import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EventTypeForm, type EventTypeValues } from "@/components/event-type-form";
import { updateEventType } from "../../../actions";
import { getUserOrgs } from "@/lib/teams";

export default async function EditEventTypePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // RLS (can_manage_event_type) allows team members to edit workspace events.
  const { data: et } = await supabase
    .from("event_types")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!et) notFound();

  const { data: hostRows } = await supabase
    .from("event_type_hosts")
    .select("profile_id")
    .eq("event_type_id", id)
    .order("position");

  let questionRows: {
    id: string;
    label: string;
    field_type: string;
    is_required: boolean;
    options: string[];
  }[] = [];
  try {
    const { data } = await supabase
      .from("event_type_questions")
      .select("id, label, field_type, is_required, options")
      .eq("event_type_id", id)
      .order("position");
    questionRows = (data ?? []) as typeof questionRows;
  } catch {
    // Migration not applied yet.
  }

  const initial: EventTypeValues = {
    title: et.title,
    slug: et.slug,
    description: et.description ?? "",
    duration_minutes: et.duration_minutes,
    buffer_before_minutes: et.buffer_before_minutes,
    buffer_after_minutes: et.buffer_after_minutes,
    min_notice_hours: Number(et.min_notice_hours),
    max_ahead_days: et.max_ahead_days,
    max_bookings_per_day: et.max_bookings_per_day ? String(et.max_bookings_per_day) : "",
    max_attendees: (et as { max_attendees?: number }).max_attendees ?? 1,
    cancel_cutoff_hours: (et as { cancel_cutoff_hours?: number }).cancel_cutoff_hours ?? 24,
    price_rupees: et.price_paise > 0 ? String(et.price_paise / 100) : "",
    location_type: et.location_type,
    meeting_provider: et.meeting_provider,
    color: et.color,
    is_active: et.is_active,
    is_private: (et.is_private as boolean) ?? false,
    questions: questionRows.map((q) => ({
      id: q.id as string,
      label: q.label as string,
      field_type: q.field_type as string,
      is_required: q.is_required as boolean,
      options: (q.options ?? []) as string[],
    })),
    organization_id: (et.organization_id as string | null) ?? "",
    scheduling_mode: (et.scheduling_mode as string) ?? "single",
    host_ids: (hostRows ?? []).map((h) => h.profile_id as string),
  };

  const orgs = await getUserOrgs(supabase, user.id);
  const { data: memberRows } = await supabase
    .from("organization_members")
    .select("organization_id, profile_id, profiles(display_name)")
    .in(
      "organization_id",
      orgs.map((o) => o.organization_id)
    );
  const teamMembers = (memberRows ?? []).map((m) => {
    const prof = m.profiles as unknown as { display_name: string | null } | null;
    return {
      orgId: m.organization_id as string,
      id: m.profile_id as string,
      name: prof?.display_name ?? "Team member",
    };
  });
  const update = updateEventType.bind(null, id);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Edit event type
      </h1>
      <p className="mt-1 text-sm text-slate-500">{et.title}</p>
      <div className="mt-8">
        <EventTypeForm
          initial={initial}
          action={update}
          submitLabel="Save changes"
          organizations={orgs.map((o) => ({
            id: o.organization_id,
            name: o.organizations.name,
          }))}
          teamMembers={teamMembers}
        />
      </div>
    </div>
  );
}
