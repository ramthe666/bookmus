"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export async function disconnectCalendar(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: conn } = await supabase
    .from("connected_calendars")
    .select("provider")
    .eq("id", id)
    .eq("owner_profile_id", user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("connected_calendars")
    .delete()
    .eq("id", id)
    .eq("owner_profile_id", user.id);
  if (error) throw new Error(error.message);

  await logAudit(supabase, {
    action: "integration.disconnected",
    targetType: "integration",
    targetId: id,
    ownerProfileId: user.id,
    actorProfileId: user.id,
    actorType: "user",
    metadata: { provider: (conn?.provider as string | undefined) ?? null },
  });
  revalidatePath("/dashboard/integrations");
}
