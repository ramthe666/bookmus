import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/site-nav";
import { mergeConfig, arrangeEvents } from "@/lib/page-builder";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username} · Book with me` };
}

export default async function HostPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, bio")
    .eq("username", username.toLowerCase())
    .maybeSingle();

  if (!profile) notFound();

  const { data: eventTypes } = await supabase
    .from("event_types")
    .select("id, title, slug, description, duration_minutes, price_paise, color")
    .eq("owner_profile_id", profile.id)
    .eq("is_active", true)
    .eq("is_private", false)
    .order("duration_minutes", { ascending: true });

  // Published page design (never the draft).
  const { data: publishedRaw } = await supabase.rpc(
    "get_published_page_config",
    { p_owner_id: profile.id }
  );
  const config = mergeConfig(publishedRaw);
  const events = arrangeEvents(
    (eventTypes ?? []).map((et) => ({
      id: et.id as string,
      title: et.title as string,
      slug: et.slug as string,
      description: (et.description as string | null) ?? "",
      duration_minutes: et.duration_minutes as number,
      price_paise: et.price_paise as number,
      color: (et.color as string | null) ?? config.accent_color,
    })),
    config
  );

  const initials = (profile.display_name ?? profile.username ?? "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const dark = config.theme === "dark";
  const displayName = profile.display_name ?? `@${profile.username}`;

  return (
    <div className={`min-h-full ${dark ? "bg-slate-950" : "bg-slate-50"}`}>
      <header
        className={`border-b ${dark ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white"}`}
      >
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Logo />
          <Link
            href="/signup"
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${dark ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
          >
            Create your own page
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12">
        <div className="flex items-center gap-5">
          <div
            className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl text-2xl font-bold text-white"
            style={{ backgroundColor: config.accent_color }}
          >
            {initials}
          </div>
          <div>
            <h1
              className={`text-2xl font-bold tracking-tight ${dark ? "text-white" : "text-slate-900"}`}
            >
              {config.headline || displayName}
            </h1>
            {(config.intro || profile.bio) && (
              <p
                className={`mt-1 max-w-lg text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}
              >
                {config.intro || profile.bio}
              </p>
            )}
          </div>
        </div>

        <h2
          className={`mt-10 text-sm font-semibold uppercase tracking-widest ${dark ? "text-slate-500" : "text-slate-400"}`}
        >
          Book a time
        </h2>
        <div className="mt-4 space-y-3">
          {events.map((et) => (
            <Link
              key={et.id}
              href={`/u/${profile.username}/${et.slug}`}
              className={`group flex items-center gap-4 rounded-2xl border p-5 transition hover:shadow-lg ${
                dark
                  ? "border-slate-800 bg-slate-900 hover:border-slate-700"
                  : "border-slate-200 bg-white hover:border-indigo-300 hover:shadow-indigo-600/5"
              }`}
            >
              <span
                className="h-12 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: config.accent_color }}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={`font-semibold ${dark ? "text-white" : "text-slate-900"}`}
                >
                  {et.title}
                </p>
                <p
                  className={`mt-0.5 text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}
                >
                  {et.duration_minutes} min
                  {config.show_prices &&
                    et.price_paise > 0 &&
                    ` · ₹${(et.price_paise / 100).toLocaleString("en-IN")}`}
                </p>
                {et.description && (
                  <p
                    className={`mt-1 line-clamp-1 text-sm ${dark ? "text-slate-500" : "text-slate-400"}`}
                  >
                    {et.description}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-indigo-600">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                  <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </Link>
          ))}
          {events.length === 0 && (
            <p
              className={`rounded-2xl border border-dashed p-10 text-center text-sm ${
                dark
                  ? "border-slate-700 bg-slate-900 text-slate-500"
                  : "border-slate-300 bg-white text-slate-500"
              }`}
            >
              No bookable events right now — check back soon.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
