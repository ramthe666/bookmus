import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Teams / workspaces (spec §2). Builds on the existing organizations +
 * organization_members model and its RLS (is_org_member,
 * can_manage_event_type). Invitations are token-based.
 */

export interface OrgMembership {
  organization_id: string;
  role: "owner" | "admin" | "member";
  organizations: { id: string; name: string; slug: string };
}

export async function getUserOrgs(
  supabase: SupabaseClient,
  userId: string
): Promise<OrgMembership[]> {
  const { data } = await supabase
    .from("organization_members")
    .select("organization_id, role, organizations(id, name, slug)")
    .eq("profile_id", userId);
  return (data ?? []) as unknown as OrgMembership[];
}

/** Org IDs where the user is a member (for org-aware dashboard queries). */
export async function getMemberOrgIds(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  const orgs = await getUserOrgs(supabase, userId);
  return orgs.map((o) => o.organization_id);
}

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function inviteUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://bookmus.vercel.app";
  return `${base}/invite/${token}`;
}
