import { supabaseAdmin } from "./supabase-admin";
import type { DashboardSession } from "./auth";
import { isBranchAllowed } from "./auth";

export async function canAccessConversation(session: DashboardSession, conversationId: string) {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("id, branch_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (error || !data) return null;
  return isBranchAllowed(session, data.branch_id) ? data : null;
}

export async function canAccessOrder(session: DashboardSession, orderId: string) {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, branch_id")
    .eq("id", orderId)
    .maybeSingle();

  if (error || !data) return null;
  return isBranchAllowed(session, data.branch_id) ? data : null;
}

export async function canAccessMenuItem(session: DashboardSession, menuItemId: string) {
  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select("id, branch_id")
    .eq("id", menuItemId)
    .maybeSingle();

  if (error || !data) return null;
  return isBranchAllowed(session, data.branch_id) ? data : null;
}
