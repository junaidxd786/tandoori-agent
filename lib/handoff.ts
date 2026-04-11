import { sendAndPersistOutboundMessage, persistSystemMessage } from "./messages";
import { createStaffAlert, resolveStaffAlerts } from "./staff-alerts";
import { supabaseAdmin } from "./supabase-admin";
import { getOrCreateUserSession, updateUserSession } from "./user-session";

function buildHandoffReply(prefersRomanUrdu: boolean): string {
  return prefersRomanUrdu
    ? "Main aap ko restaurant manager se connect kar raha hoon. Thori dair mein human team reply karegi."
    : "I'm transferring you to the restaurant manager now. A human team member will reply shortly.";
}

export async function escalateToHuman(input: {
  conversationId: string;
  branchId: string;
  phone: string;
  reason: string;
  prefersRomanUrdu: boolean;
}) {
  const session = await getOrCreateUserSession(input.conversationId);
  const alreadyEscalated = session.status === "human_handoff" || session.is_bot_active === false;

  const now = new Date().toISOString();
  const { error: conversationError } = await supabaseAdmin
    .from("conversations")
    .update({
      mode: "human",
      has_unread: true,
      updated_at: now,
    })
    .eq("id", input.conversationId);

  if (conversationError) throw conversationError;

  await updateUserSession(input.conversationId, {
    active_node: "human_handoff",
    return_node: null,
    status: "human_handoff",
    is_bot_active: false,
    invalid_step_count: 0,
    escalation_reason: input.reason,
    escalated_at: now,
  });

  await createStaffAlert({
    conversationId: input.conversationId,
    branchId: input.branchId,
    kind: "human_handoff",
    severity: "high",
    message: input.reason,
  });

  await persistSystemMessage(input.conversationId, `Conversation escalated to a human operator: ${input.reason}`).catch(
    (error) => {
      console.error("[handoff] Failed to persist handoff note:", error);
    },
  );

  if (!alreadyEscalated) {
    await sendAndPersistOutboundMessage({
      conversationId: input.conversationId,
      phone: input.phone,
      content: buildHandoffReply(input.prefersRomanUrdu),
      senderKind: "system",
    }).catch((error) => {
      console.error("[handoff] Failed to notify customer about handoff:", error);
    });
  }
}

export async function resumeBotForConversation(conversationId: string): Promise<void> {
  await updateUserSession(conversationId, {
    status: "active",
    is_bot_active: true,
    active_node: "cart_builder",
    return_node: null,
    escalation_reason: null,
    escalated_at: null,
  });
  await resolveStaffAlerts(conversationId, "human_handoff").catch((error) => {
    console.error("[handoff] Failed to resolve handoff alerts:", error);
  });
}
