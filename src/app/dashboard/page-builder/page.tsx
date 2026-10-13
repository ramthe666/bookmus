import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { PageConfig } from "@/lib/page-builder";
import { PageBuilderEditor } from "./editor";

async function ensurePage(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: existing } = await supabase
    .from("booking_pages")
    .select("id, draft, published, published_at, published_version")
    .eq("owner_profile_id", user.id)
    .maybeSingle();
  if (existing) return { user, page: existing };
  const { data: created, error } = await supabase
    .from("booking_pages")
    .insert({ owner_profile_id: user.id, draft: {}, published: {} })
    .select("id, draft, published, published_at, published_version")
    .single();
  if (error) throw new Error("Could not load the page builder.");
  return { user, page: created };
}

async function saveDraft(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { user } = await ensurePage(supabase);
  const config: PageConfig = {
    headline: String(formData.get("headline") ?? "").slice(0, 120),
    intro: String(formData.get("intro") ?? "").slice(0, 500),
    accent_color: String(formData.get("accent_color") ?? "#4f46e5"),
    theme:
      String(formData.get("theme") ?? "light") === "dark" ? "dark" : "light",
    event_order: JSON.parse(String(formData.get("event_order") ?? "[]")),
    hidden_events: JSON.parse(String(formData.get("hidden_events") ?? "[]")),
    show_prices: formData.get("show_prices") === "on",
  };
  const { error } = await supabase
    .from("booking_pages")
    .update({ draft: config, updated_at: new Date().toISOString() })
    .eq("owner_profile_id", user.id);
  if (error) throw new Error("Could not save the draft.");
  revalidatePath("/dashboard/page-builder");
}

async function publishPage() {
  "use server";
  const supabase = await createClient();
  const { user, page } = await ensurePage(supabase);
  const draft = (page.draft ?? {}) as PageConfig;
  const nextVersion = ((page.published_version as number) ?? 0) + 1;
  const { error } = await supabase
    .from("booking_pages")
    .update({
      published: draft,
      published_at: new Date().toISOString(),
      published_version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("owner_profile_id", user.id);
  if (error) throw new Error("Could not publish.");
  await supabase.from("booking_page_versions").insert({
    owner_profile_id: user.id,
    config: draft,
    version: nextVersion,
  });
  revalidatePath("/dashboard/page-builder");
}

async function rollbackPage(formData: FormData) {
  "use server";
  const version = Number(formData.get("version") ?? 0);
  if (!version) return;
  const supabase = await createClient();
  const { user } = await ensurePage(supabase);
  const { data: v } = await supabase
    .from("booking_page_versions")
    .select("config")
    .eq("owner_profile_id", user.id)
    .eq("version", version)
    .maybeSingle();
  if (!v) throw new Error("Version not found.");
  const config = v.config as PageConfig;
  const { data: page } = await supabase
    .from("booking_pages")
    .select("published_version")
    .eq("owner_profile_id", user.id)
    .maybeSingle();
  const nextVersion = ((page?.published_version as number) ?? 0) + 1;
  await supabase
    .from("booking_pages")
    .update({
      draft: config,
      published: config,
      published_at: new Date().toISOString(),
      published_version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("owner_profile_id", user.id);
  await supabase.from("booking_page_versions").insert({
    owner_profile_id: user.id,
    config,
    version: nextVersion,
  });
  revalidatePath("/dashboard/page-builder");
}

export default async function PageBuilderPage() {
  const supabase = await createClient();
  const { user, page } = await ensurePage(supabase);

  const { data: eventTypes } = await supabase
    .from("event_types")
    .select("id, title, slug, duration_minutes, price_paise, color")
    .eq("owner_profile_id", user.id)
    .eq("is_active", true)
    .order("title");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, username, bio")
    .eq("id", user.id)
    .maybeSingle();

  const { data: versions } = await supabase
    .from("booking_page_versions")
    .select("version, created_at")
    .eq("owner_profile_id", user.id)
    .order("version", { ascending: false })
    .limit(10);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Page builder
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Design your public booking page. Edits save as a draft — publish when
        it looks right.{" "}
        <a
          href={`/u/${profile?.username ?? ""}`}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-indigo-600 hover:text-indigo-800"
        >
          View live page →
        </a>
      </p>
      {page.published_at ? (
        <p className="mt-1 text-xs text-slate-400">
          Published v{page.published_version as number} ·{" "}
          {new Date(page.published_at as string).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })}
        </p>
      ) : (
        <p className="mt-1 text-xs text-amber-600">
          Not published yet — your page shows the default layout.
        </p>
      )}

      <PageBuilderEditor
        initialDraft={page.draft as PageConfig}
        eventTypes={(eventTypes ?? []).map((e) => ({
          id: e.id as string,
          title: e.title as string,
          duration_minutes: e.duration_minutes as number,
          price_paise: e.price_paise as number,
          color: (e.color as string) ?? "#4f46e5",
        }))}
        hostName={
          (profile?.display_name as string | null) ??
          (profile?.username as string | null) ??
          "Your host"
        }
        hostBio={(profile?.bio as string | null) ?? ""}
        saveDraft={saveDraft}
        publishPage={publishPage}
      />

      {(versions ?? []).length > 0 && (
        <div className="mt-10 max-w-3xl">
          <h2 className="font-semibold text-slate-900">Published history</h2>
          <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {(versions ?? []).map((v) => (
              <li
                key={v.version as number}
                className="flex items-center justify-between px-5 py-3"
              >
                <div className="text-sm">
                  <span className="font-semibold text-slate-900">
                    v{v.version as number}
                  </span>
                  {(v.version as number) ===
                    (page.published_version as number) && (
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      live
                    </span>
                  )}
                  <span className="ml-2 text-xs text-slate-400">
                    {new Date(v.created_at as string).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    })}
                  </span>
                </div>
                {(v.version as number) !==
                  (page.published_version as number) && (
                  <form action={rollbackPage}>
                    <input
                      type="hidden"
                      name="version"
                      value={v.version as number}
                    />
                    <button
                      type="submit"
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      Restore this version
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
