import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function acceptInvite(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  if (!token) throw new Error("Invalid invite.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/invite/${token}`);
  const { error } = await supabase.rpc("accept_organization_invite", {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  redirect("/dashboard/team");
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  const { data: preview } = await supabase.rpc("get_invite_preview", {
    p_token: token,
  });
  const row = (preview as { organization_name: string; role: string; expired: boolean }[] | null)?.[0] ?? null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-900/5">
        <h1 className="text-xl font-bold text-slate-900">Team invite</h1>
        {!row || row.expired ? (
          <p className="mt-4 text-sm text-slate-500">
            This invite link is invalid or has expired. Ask the team admin for
            a new one.
          </p>
        ) : (
          <>
            <p className="mt-4 text-sm text-slate-600">
              You've been invited to join{" "}
              <strong className="text-slate-900">
                {row.organization_name}
              </strong>{" "}
              as <strong className="text-slate-900">{row.role}</strong>.
            </p>
            {!user ? (
              <div className="mt-6 space-y-2">
                <Link
                  href={`/login?next=/invite/${token}`}
                  className="block rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  Log in to accept
                </Link>
                <p className="text-xs text-slate-400">
                  New here? Create an account with the invited email address
                  first.
                </p>
              </div>
            ) : (
              <form action={acceptInvite} className="mt-6">
                <input type="hidden" name="token" value={token} />
                <button
                  type="submit"
                  className="w-full rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  Accept invite
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
