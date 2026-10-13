"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in.");
  return { supabase, user };
}

const VALID_TRIGGERS = [
  "booking.created",
  "booking.cancelled",
  "booking.rescheduled",
  "booking.before_start",
  "booking.after_end",
];
const VALID_ACTIONS = ["send_email", "call_webhook"];
const VALID_TEMPLATES = ["confirmation", "cancellation", "reschedule", "reminder"];

export async function createWorkflow(formData: FormData) {
  const { supabase, user } = await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  const trigger = String(formData.get("trigger") ?? "");
  const action = String(formData.get("action") ?? "");
  const offsetHours = Math.max(
    0,
    Math.min(720, Number(formData.get("offset_hours") ?? 24) || 0)
  );
  if (!name) throw new Error("Give your workflow a name.");
  if (!VALID_TRIGGERS.includes(trigger)) throw new Error("Invalid trigger.");
  if (!VALID_ACTIONS.includes(action)) throw new Error("Invalid action.");

  const actionConfig: Record<string, string> = {};
  if (action === "send_email") {
    const t = String(formData.get("template_event") ?? "confirmation");
    if (!VALID_TEMPLATES.includes(t)) throw new Error("Invalid email template.");
    actionConfig.template_event = t;
  } else {
    const webhookId = String(formData.get("webhook_id") ?? "");
    if (!webhookId) throw new Error("Pick a webhook endpoint.");
    // Verify the endpoint belongs to this user.
    const { data: ep } = await supabase
      .from("webhook_endpoints")
      .select("id")
      .eq("id", webhookId)
      .eq("owner_profile_id", user.id)
      .maybeSingle();
    if (!ep) throw new Error("Webhook endpoint not found.");
    actionConfig.webhook_id = webhookId;
  }

  const { error } = await supabase.from("workflows").insert({
    owner_profile_id: user.id,
    name,
    trigger,
    offset_hours: offsetHours,
    action,
    action_config: actionConfig,
    is_active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/workflows");
}

export async function toggleWorkflow(id: string, active: boolean) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("workflows")
    .update({ is_active: active })
    .eq("id", id)
    .eq("owner_profile_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/workflows");
}

export async function deleteWorkflow(id: string) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("workflows")
    .delete()
    .eq("id", id)
    .eq("owner_profile_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/workflows");
}
