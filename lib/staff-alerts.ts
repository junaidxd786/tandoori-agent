import { supabaseAdmin } from "./supabase-admin";

export type StaffAlertKind =
  | "human_handoff"
  | "tool_validation"
  | "webhook_processing"
  | "delivery_notification";

export type StaffAlertStatus = "open" | "acknowledged" | "resolved";

export async function createStaffAlert(input: {
  conversationId: string;
  branchId: string;
  kind: StaffAlertKind;
  message: string;
  severity?: "low" | "medium" | "high";
}) {
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("staff_alerts")
    .select("id")
    .eq("conversation_id", input.conversationId)
    .eq("kind", input.kind)
    .eq("status", "open")
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from("staff_alerts")
    .insert({
      conversation_id: input.conversationId,
      branch_id: input.branchId,
      kind: input.kind,
      status: "open",
      severity: input.severity ?? "medium",
      message: input.message,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

export async function resolveStaffAlerts(
  conversationId: string,
  kind?: StaffAlertKind,
): Promise<void> {
  let query = supabaseAdmin
    .from("staff_alerts")
    .update({
      status: "resolved" satisfies StaffAlertStatus,
      resolved_at: new Date().toISOString(),
    })
    .eq("conversation_id", conversationId)
    .eq("status", "open");

  if (kind) {
    query = query.eq("kind", kind);
  }

  const { error } = await query;
  if (error) throw error;
}
