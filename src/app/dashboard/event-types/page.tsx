import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { EmbedSnippet } from "./embed-snippet";
import { deleteEventType, toggleEventType } from "../actions";

function DeleteButton({ id, title }: { id: string; title: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await deleteEventType(id);
      }}
    >
      <button
        type="submit"
        title={`Delete ${title}`}
        className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
      >
        Delete
      </button>
    </form>
  );
}

function ToggleButton({ id, isActive }: { id: string; isActive: boolean }) {
  return (
    <form
      action={async () => {
        "use server";
        await toggleEventType(id, !isActive);
      }}
    >
      <button
        type="submit"
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
          isActive ? "bg-indigo-600" : "bg-slate-300"
        }`}
        title={isActive ? "Deactivate" : "Activate"}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
            isActive ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </form>
  );
}

export default async function EventTypesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Personal events + workspace events (RLS already restricts to what the
  // user can manage — this filter only shapes the list).
  const { data: orgIds } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("profile_id", user.id);
  const orgList = (orgIds ?? []).map((r) => r.organization_id as string);

  let query = supabase
    .from("event_types")
    .select(
      "id, title, slug, description, duration_minutes, price_paise, is_active, is_private, color, organization_id, scheduling_mode, organizations(name)"
    )
    .order("created_at", { ascending: false });
  if (orgList.length > 0) {
    query = query.or(
      `owner_profile_id.eq.${user.id},organization_id.in.(${orgList.join(",")})`
    );
  } else {
    query = query.eq("owner_profile_id", user.id);
  }
  const { data: eventTypes } = await query;

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Event types
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            The meetings people can book with you.
          </p>
        </div>
        <Link
          href="/dashboard/event-types/new"
          className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/30 transition hover:bg-indigo-700"
        >
          + New event type
        </Link>
      </div>

      <div className="mt-8 space-y-4">
        {(eventTypes ?? []).map((et) => {
          const link =
            profile?.username != null
              ? `${appUrl}/u/${profile.username}/${et.slug}`
              : null;
          return (
            <div
              key={et.id}
              className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center"
            >
              <span
                className="h-10 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: et.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-slate-900">
                    {et.title}
                  </h2>
                  {!et.is_active && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                      Off
                    </span>
                  )}
                  {(() => {
                    const org = et.organizations as unknown as
                      | { name: string }
                      | { name: string }[]
                      | null;
                    const name = Array.isArray(org) ? org[0]?.name : org?.name;
                    return (
                      name && (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                          {name}
                        </span>
                      )
                    );
                  })()}
                  {(et.scheduling_mode as string) !== "single" && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      {(et.scheduling_mode as string) === "round_robin"
                        ? "Round robin"
                        : "Collective"}
                    </span>
                  )}
                  {(et.is_private as boolean) && (
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-white">
                      Secret
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-sm text-slate-500">
                  {et.duration_minutes} min
                  {et.price_paise > 0 &&
                    ` · ₹${(et.price_paise / 100).toLocaleString("en-IN")}`}
                  {link && ` · ${link.replace(/^https?:\/\//, "")}`}
                </p>
                {et.description && (
                  <p className="mt-1 line-clamp-1 text-sm text-slate-500">
                    {et.description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ToggleButton id={et.id} isActive={et.is_active} />
                {link && profile?.username && (
                  <EmbedSnippet
                    username={profile.username as string}
                    slug={et.slug as string}
                  />
                )}
                {link && (
                  <Link
                    href={link}
                    target="_blank"
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    Preview
                  </Link>
                )}
                <Link
                  href={`/dashboard/event-types/${et.id}/edit`}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  Edit
                </Link>
                <DeleteButton id={et.id} title={et.title} />
              </div>
            </div>
          );
        })}
        {(eventTypes ?? []).length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <p className="text-sm font-medium text-slate-900">
              No event types yet
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
              Create your first event type — a 30-minute intro call is a great
              start.
            </p>
            <Link
              href="/dashboard/event-types/new"
              className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Create event type
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
