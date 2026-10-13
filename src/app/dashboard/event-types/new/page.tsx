import { EventTypeForm, type EventTypeValues } from "@/components/event-type-form";
import { createEventType } from "../../actions";

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
};

export default function NewEventTypePage() {
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
        />
      </div>
    </div>
  );
}
