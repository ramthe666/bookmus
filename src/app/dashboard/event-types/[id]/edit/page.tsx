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
    price_rupees: et.price_paise > 0 ? String(et.price_paise / 100) : "",
    location_type: et.location_type,
    meeting_provider: et.meeting_provider,
    color: et.color,
    is_active: et.is_active,
    organization_id: (et.organization_id as string | null) ?? "",
  };

  const orgs = await getUserOrgs(supabase, user.id);
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
        />
      </div>
    </div>
  );
}
