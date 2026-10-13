"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function disconnectCalendar(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("connected_calendars")
    .delete()
    .eq("id", id)
    .eq("owner_profile_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/integrations");
}
