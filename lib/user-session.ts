import type { OrderTurnIntent } from "./ai";
import type { ConversationState } from "./order-engine";
import { supabaseAdmin } from "./supabase-admin";

export type SessionGraphNode =
  | "branch_selection"
  | "menu_lookup"
  | "cart_builder"
  | "checkout"
  | "order_review"
  | "support"
  | "human_handoff";

export type SessionStatus = "active" | "paused" | "human_handoff";

export type SemanticCandidateSnapshot = {
  id: string;
  name: string;
  price: number;
  category: string | null;
  similarity: number | null;
};

export interface UserSession {
  conversation_id: string;
  active_node: SessionGraphNode;
  return_node: SessionGraphNode | null;
  status: SessionStatus;
  is_bot_active: boolean;
  invalid_step_count: number;
  consecutive_tool_failures: number;
  anger_level: number;
  last_intent: OrderTurnIntent | null;
  last_tool_name: string | null;
  last_tool_error: string | null;
  last_user_message: string | null;
  last_assistant_reply: string | null;
  last_semantic_candidates: SemanticCandidateSnapshot[];
  escalation_reason: string | null;
  escalated_at: string | null;
  created_at: string;
  updated_at: string;
}

const BLOCKING_WORKFLOW_STEPS = new Set([
  "awaiting_branch_selection",
  "awaiting_order_type",
  "awaiting_delivery_address",
  "awaiting_dine_in_details",
  "awaiting_confirmation",
  "awaiting_resume_decision",
]);

function isSemanticCandidateSnapshot(value: unknown): value is SemanticCandidateSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.price === "number" &&
    (typeof record.category === "string" || record.category === null) &&
    (typeof record.similarity === "number" || record.similarity === null)
  );
}

export function getDefaultUserSession(conversationId: string): UserSession {
  const now = new Date().toISOString();
  return {
    conversation_id: conversationId,
    active_node: "cart_builder",
    return_node: null,
    status: "active",
    is_bot_active: true,
    invalid_step_count: 0,
    consecutive_tool_failures: 0,
    anger_level: 0,
    last_intent: null,
    last_tool_name: null,
    last_tool_error: null,
    last_user_message: null,
    last_assistant_reply: null,
    last_semantic_candidates: [],
    escalation_reason: null,
    escalated_at: null,
    created_at: now,
    updated_at: now,
  };
}

export function parseUserSession(
  raw: Partial<UserSession> & { conversation_id: string },
): UserSession {
  const defaults = getDefaultUserSession(raw.conversation_id);
  return {
    ...defaults,
    ...raw,
    active_node: isGraphNode(raw.active_node) ? raw.active_node : defaults.active_node,
    return_node: isGraphNode(raw.return_node) ? raw.return_node : null,
    status: isSessionStatus(raw.status) ? raw.status : defaults.status,
    is_bot_active: raw.is_bot_active !== false,
    invalid_step_count: normalizeCounter(raw.invalid_step_count),
    consecutive_tool_failures: normalizeCounter(raw.consecutive_tool_failures),
    anger_level: normalizeCounter(raw.anger_level),
    last_intent: typeof raw.last_intent === "string" ? (raw.last_intent as OrderTurnIntent) : null,
    last_tool_name: typeof raw.last_tool_name === "string" ? raw.last_tool_name : null,
    last_tool_error: typeof raw.last_tool_error === "string" ? raw.last_tool_error : null,
    last_user_message: typeof raw.last_user_message === "string" ? raw.last_user_message : null,
    last_assistant_reply: typeof raw.last_assistant_reply === "string" ? raw.last_assistant_reply : null,
    last_semantic_candidates: Array.isArray(raw.last_semantic_candidates)
      ? raw.last_semantic_candidates.filter(isSemanticCandidateSnapshot)
      : [],
    escalation_reason: typeof raw.escalation_reason === "string" ? raw.escalation_reason : null,
    escalated_at: typeof raw.escalated_at === "string" ? raw.escalated_at : null,
    created_at: typeof raw.created_at === "string" ? raw.created_at : defaults.created_at,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : defaults.updated_at,
  };
}

export function isGraphNode(value: unknown): value is SessionGraphNode {
  return (
    value === "branch_selection" ||
    value === "menu_lookup" ||
    value === "cart_builder" ||
    value === "checkout" ||
    value === "order_review" ||
    value === "support" ||
    value === "human_handoff"
  );
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return value === "active" || value === "paused" || value === "human_handoff";
}

function normalizeCounter(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.min(Math.floor(numeric), 25);
}

export function deriveSessionNode(
  state: ConversationState,
  mode: "agent" | "human",
): SessionGraphNode {
  if (mode === "human") return "human_handoff";

  if (state.workflow_step === "awaiting_branch_selection") return "branch_selection";
  if (
    state.workflow_step === "awaiting_order_type" ||
    state.workflow_step === "awaiting_delivery_address" ||
    state.workflow_step === "awaiting_dine_in_details"
  ) {
    return "checkout";
  }
  if (state.workflow_step === "awaiting_confirmation" || state.workflow_step === "awaiting_resume_decision") {
    return "order_review";
  }
  if (state.workflow_step === "idle" || state.workflow_step === "collecting_items" || state.workflow_step === "awaiting_upsell_reply") {
    return "cart_builder";
  }

  return "support";
}

export function isCheckoutNode(node: SessionGraphNode | null | undefined): boolean {
  return node === "checkout" || node === "order_review";
}

export async function getOrCreateUserSession(
  conversationId: string,
  seed?: Partial<UserSession>,
): Promise<UserSession> {
  const fetchExisting = async () => {
    const { data, error } = await supabaseAdmin
      .from("user_sessions")
      .select("*")
      .eq("conversation_id", conversationId)
      .maybeSingle();

    if (error) throw error;
    return data ? parseUserSession(data as Partial<UserSession> & { conversation_id: string }) : null;
  };

  const existing = await fetchExisting();
  if (existing) return existing;

  const defaults = {
    ...getDefaultUserSession(conversationId),
    ...seed,
    conversation_id: conversationId,
  };

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("user_sessions")
    .insert(defaults)
    .select("*")
    .single();

  if (insertError || !inserted) {
    if (String((insertError as { code?: string } | null)?.code) === "23505") {
      const raced = await fetchExisting();
      if (raced) return raced;
    }
    throw insertError ?? new Error("Failed to create user session.");
  }

  return parseUserSession(inserted as Partial<UserSession> & { conversation_id: string });
}

export async function updateUserSession(
  conversationId: string,
  patch: Partial<UserSession>,
): Promise<UserSession> {
  const nextPatch = {
    ...patch,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("user_sessions")
    .update(nextPatch)
    .eq("conversation_id", conversationId)
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to update user session.");
  }

  return parseUserSession(data as Partial<UserSession> & { conversation_id: string });
}

export function buildSessionUpdate(input: {
  session: UserSession;
  stateBefore: ConversationState;
  stateAfter: ConversationState;
  mode: "agent" | "human";
  intent: OrderTurnIntent | null;
  lastUserMessage: string;
  lastAssistantReply: string | null;
  semanticCandidates?: SemanticCandidateSnapshot[];
  toolError?: string | null;
  forceNode?: SessionGraphNode | null;
  escalationReason?: string | null;
}): Partial<UserSession> {
  const { session, stateBefore, stateAfter, mode, intent, lastUserMessage, lastAssistantReply, semanticCandidates, toolError, forceNode, escalationReason } = input;
  const targetNode = forceNode ?? deriveSessionNode(stateAfter, mode);
  const wasInCheckout = isCheckoutNode(session.active_node);
  const isSupportInterrupt =
    wasInCheckout &&
    (intent === "browse_menu" ||
      intent === "category_question" ||
      intent === "payment_question" ||
      intent === "eta_question" ||
      intent === "order_status_question");
  const remainsBlocked =
    stateBefore.workflow_step === stateAfter.workflow_step && BLOCKING_WORKFLOW_STEPS.has(stateAfter.workflow_step);
  const invalidStepCount = escalationReason
    ? 0
    : remainsBlocked
      ? Math.min(session.invalid_step_count + 1, 10)
      : 0;

  return {
    active_node: targetNode,
    return_node: isSupportInterrupt ? session.active_node : targetNode === session.return_node ? null : session.return_node,
    status: mode === "human" || escalationReason ? "human_handoff" : session.status,
    is_bot_active: mode !== "human" && !escalationReason,
    invalid_step_count: invalidStepCount,
    consecutive_tool_failures: toolError ? Math.min(session.consecutive_tool_failures + 1, 10) : 0,
    anger_level: escalationReason ? Math.min(session.anger_level + 1, 10) : Math.max(session.anger_level - 1, 0),
    last_intent: intent,
    last_tool_name: toolError ? "order_interpreter" : null,
    last_tool_error: toolError ?? null,
    last_user_message: lastUserMessage,
    last_assistant_reply: lastAssistantReply,
    last_semantic_candidates: semanticCandidates ?? [],
    escalation_reason: escalationReason ?? null,
    escalated_at: escalationReason ? new Date().toISOString() : null,
  };
}
