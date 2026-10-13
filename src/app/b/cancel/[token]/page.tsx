import { createServiceClient } from "@/lib/supabase/server";
import { CancelForm } from "./cancel-form";
import { RescheduleForm } from "./reschedule-form";

function formatWhen(startsAtIso: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: timeZone ?? "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(startsAtIso));
}

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-900/5">
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export default async function GuestCancelPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createServiceClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, status, timezone, booker_timezone, event_type_id, event_types!inner(title, owner_profile_id)"
    )
    .eq("cancel_token", token.trim())
    .maybeSingle();

  if (!booking) {
    return (
      <Shell title="Link not found">
        <p className="text-sm text-slate-500">
          This manage link is invalid or has expired. If you need help, please
          contact the host directly.
        </p>
      </Shell>
    );
  }

  if (booking.status === "cancelled") {
    return (
      <Shell title="Already cancelled">
        <p className="text-sm text-slate-500">
          This booking has already been cancelled. No further action is needed.
        </p>
      </Shell>
    );
  }

  const cancellable =
    (booking.status === "confirmed" || booking.status === "pending") &&
    new Date(booking.starts_at as string).getTime() > Date.now();

  if (!cancellable) {
    return (
      <Shell title="Can't cancel online">
        <p className="text-sm text-slate-500">
          This booking can no longer be cancelled through this link. Please
          contact the host directly.
        </p>
      </Shell>
    );
  }

  const et = booking.event_types as unknown as {
    title: string;
    owner_profile_id: string;
  };
  const { data: host } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", et.owner_profile_id)
    .maybeSingle();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5">
        <h1 className="text-xl font-bold text-slate-900">Manage booking</h1>
        <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-left">
          <p className="font-semibold text-slate-900">{et.title}</p>
          <p className="mt-1 text-sm text-slate-600">
            {formatWhen(
              booking.starts_at as string,
              (booking.booker_timezone as string | null) ?? null
            )}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            with {host?.display_name ?? "your host"}
          </p>
        </div>
        <RescheduleForm
          token={token}
          eventTypeId={booking.event_type_id as string}
          hostTimezone={(booking.timezone as string) ?? "Asia/Kolkata"}
          bookerTimezone={(booking.booker_timezone as string | null) ?? null}
        />
        <div className="mt-4 border-t border-slate-100 pt-4">
          <CancelForm token={token} />
        </div>
      </div>
    </div>
  );
}
