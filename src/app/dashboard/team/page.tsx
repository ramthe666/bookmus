import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserOrgs, generateInviteToken, inviteUrl } from "@/lib/teams";
import { CopyInviteButton } from "./copy-button";

async function createOrganization(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Team name is required.");
  const slug =
    String(formData.get("slug") ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-") || `team-${Date.now()}`;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: org, error } = await supabase
    .from("organizations")
    .insert({ name: name.slice(0, 80), slug: slug.slice(0, 64) })
    .select("id")
    .single();
  if (error) throw new Error("Could not create the team (slug may be taken).");
  await supabase.from("organization_members").insert({
    organization_id: org.id,
    profile_id: user.id,
    role: "owner",
  });
  revalidatePath("/dashboard/team");
}

async function inviteMember(formData: FormData) {
  "use server";
  const orgId = String(formData.get("org_id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "member");
  if (!orgId || !email || !email.includes("@"))
    throw new Error("Enter a valid email.");
  if (!["admin", "member"].includes(role))
    throw new Error("Invalid role.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const token = generateInviteToken();
  const { error } = await supabase.from("organization_invites").insert({
    organization_id: orgId,
    email,
    role,
    token,
    invited_by: user.id,
  });
  if (error) throw new Error("Could not send the invite.");
  revalidatePath("/dashboard/team");
}

async function updateMemberRole(formData: FormData) {
  "use server";
  const orgId = String(formData.get("org_id") ?? "");
  const profileId = String(formData.get("profile_id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!["admin", "member"].includes(role)) throw new Error("Invalid role.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Owners can't demote themselves via this path (keeps an owner).
  if (profileId === user.id) throw new Error("You can't change your own role.");
  await supabase
    .from("organization_members")
    .update({ role })
    .eq("organization_id", orgId)
    .eq("profile_id", profileId);
  revalidatePath("/dashboard/team");
}

async function removeMember(formData: FormData) {
  "use server";
  const orgId = String(formData.get("org_id") ?? "");
  const profileId = String(formData.get("profile_id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (profileId === user.id) throw new Error("You can't remove yourself.");
  await supabase
    .from("organization_members")
    .delete()
    .eq("organization_id", orgId)
    .eq("profile_id", profileId);
  revalidatePath("/dashboard/team");
}

async function revokeInvite(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await supabase.from("organization_invites").delete().eq("id", id);
  revalidatePath("/dashboard/team");
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const orgs = await getUserOrgs(supabase, user.id);
  const activeOrg =
    orgs.find((o) => o.organization_id === params.org) ?? orgs[0] ?? null;

  let members: {
    profile_id: string;
    role: string;
    profiles: { display_name: string | null } | { display_name: string | null }[] | null;
  }[] = [];
  let invites: {
    id: string;
    email: string;
    role: string;
    token: string;
    expires_at: string;
  }[] = [];
  if (activeOrg) {
    const { data: m } = await supabase
      .from("organization_members")
      .select("profile_id, role, profiles(display_name)")
      .eq("organization_id", activeOrg.organization_id)
      .order("created_at");
    members = ((m ?? []) as unknown) as typeof members;
    const { data: inv } = await supabase
      .from("organization_invites")
      .select("id, email, role, token, expires_at")
      .eq("organization_id", activeOrg.organization_id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });
    invites = (inv ?? []) as typeof invites;
  }

  const myRole = activeOrg?.role ?? null;
  const canManage = myRole === "owner" || myRole === "admin";

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Team</h1>
      <p className="mt-1 text-sm text-slate-500">
        Invite staff to share event types, bookings and customers. Members see
        everything in the team's workspace.
      </p>

      {orgs.length === 0 ? (
        <form
          action={createOrganization}
          className="mt-8 rounded-2xl border border-slate-200 bg-white p-6"
        >
          <h2 className="font-semibold text-slate-900">Create your team</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Team name
              </label>
              <input
                name="name"
                required
                maxLength={80}
                placeholder="Acme Studio"
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Slug
              </label>
              <input
                name="slug"
                maxLength={64}
                placeholder="acme-studio"
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500"
              />
            </div>
          </div>
          <button
            type="submit"
            className="mt-4 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Create team
          </button>
        </form>
      ) : (
        <>
          {orgs.length > 1 && (
            <div className="mt-6 flex gap-2">
              {orgs.map((o) => (
                <a
                  key={o.organization_id}
                  href={`/dashboard/team?org=${o.organization_id}`}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                    activeOrg?.organization_id === o.organization_id
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {o.organizations.name}
                </a>
              ))}
            </div>
          )}

          {activeOrg && (
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">
                  {activeOrg.organizations.name}
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {myRole}
                  </span>
                </h2>
              </div>

              <h3 className="mt-6 font-semibold text-slate-900">Members</h3>
              <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {members.map((m) => (
                  <li
                    key={m.profile_id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
                        {((Array.isArray(m.profiles)
                          ? m.profiles[0]?.display_name
                          : m.profiles?.display_name) ?? "?").charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {Array.isArray(m.profiles)
                            ? m.profiles[0]?.display_name ?? "Team member"
                            : m.profiles?.display_name ?? "Team member"}
                          {m.profile_id === user.id && (
                            <span className="ml-2 text-xs text-slate-400">
                              (you)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">{m.role}</p>
                      </div>
                    </div>
                    {canManage && m.profile_id !== user.id && (
                      <div className="flex gap-2">
                        <form action={updateMemberRole} className="flex gap-1.5">
                          <input
                            type="hidden"
                            name="org_id"
                            value={activeOrg.organization_id}
                          />
                          <input
                            type="hidden"
                            name="profile_id"
                            value={m.profile_id}
                          />
                          <select
                            name="role"
                            defaultValue={m.role}
                            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                          >
                            <option value="member">member</option>
                            <option value="admin">admin</option>
                          </select>
                          <button
                            type="submit"
                            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            Set
                          </button>
                        </form>
                        <form action={removeMember}>
                          <input
                            type="hidden"
                            name="org_id"
                            value={activeOrg.organization_id}
                          />
                          <input
                            type="hidden"
                            name="profile_id"
                            value={m.profile_id}
                          />
                          <button
                            type="submit"
                            className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </form>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              {canManage && (
                <>
                  <h3 className="mt-8 font-semibold text-slate-900">
                    Invite someone
                  </h3>
                  <form
                    action={inviteMember}
                    className="mt-3 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-5"
                  >
                    <input
                      type="hidden"
                      name="org_id"
                      value={activeOrg.organization_id}
                    />
                    <input
                      name="email"
                      required
                      type="email"
                      placeholder="teammate@company.com"
                      className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500"
                    />
                    <select
                      name="role"
                      className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                    <button
                      type="submit"
                      className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
                    >
                      Send invite
                    </button>
                  </form>

                  {invites.length > 0 && (
                    <>
                      <h3 className="mt-6 font-semibold text-slate-900">
                        Pending invites
                      </h3>
                      <ul className="mt-3 space-y-2">
                        {invites.map((inv) => (
                          <li
                            key={inv.id}
                            className="rounded-2xl border border-slate-200 bg-white p-4"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-900">
                                  {inv.email}
                                  <span className="ml-2 text-xs text-slate-400">
                                    {inv.role}
                                  </span>
                                </p>
                                <p className="text-xs text-slate-400">
                                  Expires{" "}
                                  {new Date(inv.expires_at).toLocaleDateString(
                                    "en-IN",
                                    { day: "numeric", month: "short" }
                                  )}
                                </p>
                              </div>
                              <form action={revokeInvite}>
                                <input type="hidden" name="id" value={inv.id} />
                                <button
                                  type="submit"
                                  className="shrink-0 text-xs font-medium text-red-500 hover:text-red-700"
                                >
                                  Revoke
                                </button>
                              </form>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-600">
                                {inviteUrl(inv.token)}
                              </code>
                              <CopyInviteButton url={inviteUrl(inv.token)} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
