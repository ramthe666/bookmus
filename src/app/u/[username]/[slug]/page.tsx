import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/site-nav";
import { BookingWidget } from "@/components/booking-widget";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${slug.replace(/-/g, " ")} · Book` };
}

export default async function BookEventPage({
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
    .eq("is_private", false)
    .maybeSingle();
  if (!et) notFound();

  const initials = (profile.display_name ?? profile.username ?? "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Logo />
          <Link
            href={`/u/${profile.username}`}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            ← All events
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
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
      </main>
    </div>
  );
}
