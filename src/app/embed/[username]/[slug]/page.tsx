import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { BookingWidget } from "@/components/booking-widget";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${slug.replace(/-/g, " ")} · Book` };
}

/**
 * Chromeless embeddable booking widget. Drop it in an iframe on any site:
 *   <iframe src="https://<app>/embed/<username>/<slug>" ... />
 * Secret (private) events work here via direct link — they are never
 * listed on the public profile page.
 */
export default async function EmbedPage({
  params,
}: {
  params: Promise<{ username: string; slug: string }>;
}) {
  const { username, slug } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, display_name, timezone")
    .eq("username", username.toLowerCase())
    .maybeSingle();
  if (!profile) notFound();

  const { data: et } = await supabase
    .from("event_types")
    .select(
      "id, title, slug, description, duration_minutes, price_paise, currency, location_type, meeting_provider, color, max_ahead_days"
    )
    .eq("owner_profile_id", profile.id)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (!et) notFound();

  const initials = (profile.display_name ?? profile.username ?? "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-white p-4 sm:p-6">
      <BookingWidget
        eventTypeId={et.id}
        title={et.title}
        description={et.description}
        durationMin={et.duration_minutes}
        pricePaise={et.price_paise}
        currency={et.currency ?? "INR"}
        color={et.color}
        locationType={et.location_type}
        meetingProvider={et.meeting_provider}
        maxAheadDays={et.max_ahead_days}
        hostName={profile.display_name ?? `@${profile.username}`}
        hostInitials={initials}
        hostTimezone={profile.timezone ?? "Asia/Kolkata"}
      />
      <p className="mt-6 text-center text-[11px] text-slate-400">
        Powered by BookMus
      </p>
    </div>
  );
}
