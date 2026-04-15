import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextRequest } from "next/server";
import { getCustomerSupportReply, type OrderTurnIntent } from "@/lib/ai";
import {
  findBranchSelection,
  getActiveBranches,
  getBranchById,
  getBranchSelectionPrompt,
  isBranchChangeRequest,
  type BranchSummary,
} from "@/lib/branches";
import { escalateToHuman, resumeBotForConversation } from "@/lib/handoff";
import {
  OutboundMessageError,
  sendAndPersistOutboundFlowMessage,
  sendAndPersistOutboundInteractiveMessage,
  sendAndPersistOutboundMessage,
} from "@/lib/messages";
import {
  decideTurn,
  getDefaultConversationState,
  inferLanguagePreference,
  parseConversationState,
  detectMessageType,
  type MenuCatalogItem,
  type TurnDecision,
  type ConversationState,
  type PlaceableOrderPayload,
} from "@/lib/order-engine";
import { getMenuCatalog, getMenuForAI } from "@/lib/menu";
import { getSemanticMenuMatches } from "@/lib/semantic-menu";
import { getRestaurantSettings, isWithinOperatingHours } from "@/lib/settings";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildSessionUpdate, getDefaultUserSession, getOrCreateUserSession, updateUserSession } from "@/lib/user-session";
import {
  buildWhatsAppFlowPayload,
  extractFlowResponseCommand,
  type WhatsAppFlowContext,
} from "@/lib/whatsapp-flow";
import {
  claimWebhookEvent,
  markWebhookEventFailed,
  markWebhookEventProcessed,
  recordWebhookEvent,
} from "@/lib/webhook-events";
import {
  sendWhatsAppInteractiveFlow,
  sendWhatsAppInteractiveList,
  sendWhatsAppMessage,
  type WhatsAppInteractiveFlowPayload,
} from "@/lib/whatsapp";

function shouldResumeBotFromHumanMessage(content: string): boolean {
  const normalized = content.toLowerCase().trim();
  return (
    normalized.includes("resume bot") ||
    normalized.includes("back to bot") ||
    normalized.includes("switch to bot") ||
    normalized.includes("bot resume") ||
    normalized.includes("ai handle") ||
    normalized.includes("let ai handle") ||
    normalized.includes("transfer to ai") ||
    normalized.includes("bot can handle")
  );
}
function shouldRunSemanticLookup(content: string): boolean {
  const normalized = content.toLowerCase().trim();
  if (normalized.length < 4) return false;
  if (/^(ok|okay|yes|no|han|haan|nahi|menu|\d{1,2})$/.test(normalized)) return false;
  return /\p{L}/u.test(normalized);
}
type IncomingWhatsAppMessage = {
  id: string;
  from: string;
  type: string;
  timestamp: string;
  text?: { body?: string };
  interactive?: {
    type?: "button_reply" | "list_reply" | "nfm_reply";
    button_reply?: {
      id?: string;
      title?: string;
    };
    list_reply?: {
      id?: string;
      title?: string;
      description?: string;
    };
    nfm_reply?: {
      name?: string;
      body?: string;
      response_json?: string;
    };
  };
};

type IncomingEnvelope = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ profile?: { name?: string } }>;
        messages?: IncomingWhatsAppMessage[];
      };
    }>;
  }>;
};

type IncomingMessageEvent = {
  message: IncomingWhatsAppMessage;
  contactName: string;
};

type ConversationRow = {
  id: string;
  branch_id: string;
  contact_id: string;
  phone: string;
  name: string | null;
  mode: "agent" | "human";
};

type ContactRow = {
  id: string;
  phone: string;
  name: string | null;
  active_branch_id: string | null;
};

type MessageRow = {
  id: string;
  ingest_seq: number;
  content: string;
  created_at: string;
  whatsapp_msg_id: string | null;
};

type PersistedUserMessage = {
  message: MessageRow | null;
};

type CityBranchGroup = {
  city: string;
  branches: BranchSummary[];
};

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  let rawBody = "";
  let body: unknown;
  const signature = req.headers.get("x-hub-signature-256");
  try {
    rawBody = await req.text();
    if (!isValidWhatsAppSignature(rawBody, signature)) {
      return new Response("Unauthorized", { status: 401 });
    }
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  try {
    const event = await recordWebhookEvent({
      rawBody,
      payload: body,
      signature,
    });

    after(async () => {
      await processWebhookEventInBackground(event.id);
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[webhook] Failed to persist webhook event:", error);
    return new Response("Server Error", { status: 500 });
  }
}

async function processWebhookEventInBackground(eventId: string) {
  const claimed = await claimWebhookEvent(eventId);
  if (!claimed) return;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await processWebhook(claimed.payload);
      await markWebhookEventProcessed(eventId);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown webhook processing error");
      console.error(`[webhook] Background processing attempt ${attempt + 1} failed:`, lastError);
      if (attempt < 2) {
        await sleep((attempt + 1) * 500);
      }
    }
  }

  await markWebhookEventFailed(eventId, lastError?.message ?? "Unknown webhook processing error");
}

async function processWebhook(body: unknown) {
  const events = extractIncomingMessages(body);
  if (events.length === 0) return;

  const branches = await getActiveBranches();
  const cityGroups = await buildCityBranchGroups(branches);
  const agentConversations = new Map<string, ConversationRow>();

  for (const event of events) {
    const { message, contactName } = event;
    const contact = await upsertContact(message.from, contactName);
    const incomingContent = extractIncomingContent(message);
    const prefersRomanUrdu = inferLanguagePreference(incomingContent ?? "", "english") === "roman_urdu";
    const activeBranch = contact.active_branch_id
      ? branches.find((branch) => branch.id === contact.active_branch_id) ?? null
      : null;

    if (!contact.active_branch_id || !activeBranch) {
      if (contact.active_branch_id && !activeBranch) {
        await setActiveBranch(contact.id, null);
      }

      if (!incomingContent) {
        if (message.type !== "reaction") {
          await sendCitySelectionMessage(message.from, cityGroups, prefersRomanUrdu);
        }
        continue;
      }

      let selectedBranch = findBranchSelection(incomingContent, branches);
      if (!selectedBranch) {
        const selectedCity = findCitySelection(
          incomingContent,
          cityGroups.map((group) => group.city),
        );

        if (!selectedCity) {
          await sendCitySelectionMessage(message.from, cityGroups, prefersRomanUrdu);
          continue;
        }

        const cityGroup =
          cityGroups.find((group) => normalizeCityValue(group.city) === normalizeCityValue(selectedCity)) ?? null;
        const cityBranches = cityGroup?.branches ?? [];
        if (cityBranches.length === 0) {
          await sendCitySelectionMessage(message.from, cityGroups, prefersRomanUrdu);
          continue;
        }

        if (cityBranches.length === 1) {
          selectedBranch = cityBranches[0];
        } else {
          await sendBranchSelectionMessage(message.from, cityBranches, prefersRomanUrdu, selectedCity);
          continue;
        }
      }

      if (!selectedBranch) {
        await sendCitySelectionMessage(message.from, cityGroups, prefersRomanUrdu);
        continue;
      }

      await setActiveBranch(contact.id, selectedBranch.id);
      // Update local contact object so subsequent logic uses the correct branch
      contact.active_branch_id = selectedBranch.id;

      const selectedConversation = await upsertConversation(contact, selectedBranch.id, contactName);
      const selectedState = await getOrCreateConversationState(selectedConversation.id);
      
      const createdAt = toIsoTimestamp(message.timestamp);
      if (selectedState.last_processed_user_message_id === message.id) {
        continue;
      }

      const persistedMessage = await persistUserMessage(
        selectedConversation.id,
        incomingContent,
        message.id,
        createdAt,
      );

      const assistantReply = prefersRomanUrdu
        ? `Theek hai, *${selectedBranch.name}* select ho gayi. Address: ${selectedBranch.address}\n\nAb category select karein ya item name bhej dein.`
        : `Great, you've selected *${selectedBranch.name}*. Address: ${selectedBranch.address}\n\nNow choose a category or send any item name.`;
      const selectedMenuItems = await getMenuCatalog(selectedBranch.id);
      const categoryInteractiveList = buildInteractiveCategoryList(selectedMenuItems, prefersRomanUrdu, 1);

      await sendAndPersistAssistantMessage(
        selectedConversation.id,
        message.from,
        assistantReply,
        categoryInteractiveList,
        null,
      );

      await markMessageProcessed(
        selectedState,
        message.id,
        createdAt,
        persistedMessage.message?.ingest_seq ?? null,
        {
          workflow_step: "collecting_items",
          last_presented_category: "__category_list__",
          last_presented_options: null,
          last_presented_options_at: null,
          preferred_language: prefersRomanUrdu ? "roman_urdu" : "english",
        },
      );
      
      const selectedSession = await getOrCreateUserSession(selectedConversation.id, {
        active_node: "cart_builder",
        status: "active",
        is_bot_active: true,
      });

      await updateUserSession(
        selectedConversation.id,
        buildSessionUpdate({
          session: selectedSession,
          stateBefore: selectedState,
          stateAfter: parseConversationState({
            ...selectedState,
            conversation_id: selectedConversation.id,
            workflow_step: "collecting_items",
            last_presented_category: "__category_list__",
            last_presented_options: null,
            last_presented_options_at: null,
            preferred_language: prefersRomanUrdu ? "roman_urdu" : "english",
          }),
          mode: "agent",
          intent: null,
          lastUserMessage: incomingContent,
          lastAssistantReply: assistantReply,
        }),
      );
      continue;
    }

    // Normal processing if branch is already active
    const conversation = await upsertConversation(contact, contact.active_branch_id, contactName);
    const state = await getOrCreateConversationState(conversation.id);
    if (state.last_processed_user_message_id === message.id) {
      continue;
    }

    if (!incomingContent) {
      if (message.type !== "reaction") {
        const nonTextReply =
          state.preferred_language === "roman_urdu"
            ? "Please text message bhej dein, main menu aur order mein help kar deta hoon."
            : "Please send a text message and I'll help you with the menu or your order.";
        const nonTextFlow = buildFlowMessageForAgentReply({
          context: "menu",
          conversationId: conversation.id,
          prefersRomanUrdu: state.preferred_language === "roman_urdu",
          workflowStep: state.workflow_step,
          body: nonTextReply,
        });
        await sendAndPersistAssistantMessage(
          conversation.id,
          message.from,
          nonTextReply,
          null,
          nonTextFlow,
        );
      }
      await markMessageProcessed(state, message.id, toIsoTimestamp(message.timestamp), null);
      continue;
    }

    const content = incomingContent;
    const createdAt = toIsoTimestamp(message.timestamp);
    const persistedMessage = await persistUserMessage(conversation.id, content, message.id, createdAt);

    if (isBranchChangeRequest(content)) {
      const prefersRomanUrduForFlow = state.preferred_language === "roman_urdu";
      const availableCities = cityGroups.map((group) => group.city);
      const cityInteractiveList = buildInteractiveListForCities(availableCities, prefersRomanUrduForFlow);
      const cityPrompt = getCitySelectionPrompt(availableCities, prefersRomanUrduForFlow);
      await updateConversationState(state, {
        ...getDefaultConversationState(conversation.id),
        workflow_step: "awaiting_branch_selection",
        preferred_language: inferLanguagePreference(content, state.preferred_language),
      });
      await setActiveBranch(contact.id, null);
      const branchFlow = buildFlowMessageForAgentReply({
        context: "branch",
        conversationId: conversation.id,
        prefersRomanUrdu: prefersRomanUrduForFlow,
        workflowStep: "awaiting_branch_selection",
        branches,
        body: cityInteractiveList ? cityInteractiveList.body : cityPrompt,
      });
      await sendAndPersistAssistantMessage(
        conversation.id,
        message.from,
        cityInteractiveList ? cityInteractiveList.body : cityPrompt,
        cityInteractiveList,
        branchFlow,
      );
      await markMessageProcessed(state, message.id, createdAt, persistedMessage.message?.ingest_seq ?? null);
      const session = await getOrCreateUserSession(conversation.id);
      await updateUserSession(
        conversation.id,
        buildSessionUpdate({
          session,
          stateBefore: state,
          stateAfter: parseConversationState({
            ...getDefaultConversationState(conversation.id),
            workflow_step: "awaiting_branch_selection",
            preferred_language: inferLanguagePreference(content, state.preferred_language),
            conversation_id: conversation.id,
          }),
          mode: "agent",
          intent: null,
          lastUserMessage: content,
          lastAssistantReply: cityPrompt,
          forceNode: "branch_selection",
        }),
      );
      continue;
    }

    if (conversation.mode === "human") {
      await markMessageProcessed(state, message.id, createdAt, persistedMessage.message?.ingest_seq ?? null);
      const humanSession = await getOrCreateUserSession(conversation.id, {
        active_node: "human_handoff",
        status: "human_handoff",
        is_bot_active: false,
      });
      await updateUserSession(conversation.id, {
        ...buildSessionUpdate({
          session: humanSession,
          stateBefore: state,
          stateAfter: state,
          mode: "human",
          intent: null,
          lastUserMessage: content,
          lastAssistantReply: null,
          forceNode: "human_handoff",
        }),
        status: "human_handoff",
        is_bot_active: false,
      });
      continue;
    }

    agentConversations.set(conversation.id, conversation);
  }

  for (const conversation of agentConversations.values()) {
    await drainConversationQueue(conversation);
  }
}

function extractIncomingMessages(body: unknown): IncomingMessageEvent[] {
  const payload = body as IncomingEnvelope;
  const events: IncomingMessageEvent[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const contactName = change.value?.contacts?.[0]?.profile?.name;
      for (const message of change.value?.messages ?? []) {
        if (!message.id || !message.from || !message.timestamp || !message.type) {
          continue;
        }

        events.push({
          message,
          contactName: contactName ?? message.from,
        });
      }
    }
  }

  events.sort((left, right) => {
    const timeDelta = compareMessageTimestamps(left.message.timestamp, right.message.timestamp);
    if (timeDelta !== 0) return timeDelta;
    return left.message.id.localeCompare(right.message.id);
  });

  return events;
}

function extractIncomingContent(message: IncomingWhatsAppMessage): string | null {
  if (message.type === "text") {
    const text = message.text?.body?.trim() ?? "";
    return text || null;
  }

  if (message.type === "interactive") {
    const flowReply = message.interactive?.nfm_reply;
    if (flowReply?.response_json) {
      const extracted = extractFlowResponseCommand(flowReply.response_json);
      if (extracted) return extracted.trim();

      const compact = flowReply.response_json.trim();
      if (compact) return compact;
    }

    const listReply = message.interactive?.list_reply;
    if (listReply?.id) return listReply.id.trim();
    if (listReply?.title) return listReply.title.trim();

    const buttonReply = message.interactive?.button_reply;
    if (buttonReply?.id) return buttonReply.id.trim();
    if (buttonReply?.title) return buttonReply.title.trim();
  }

  return null;
}

async function upsertContact(phone: string, name: string): Promise<ContactRow> {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("contacts")
    .select("id, phone, name, active_branch_id")
    .eq("phone", phone)
    .maybeSingle();

  if (fetchError) {
    console.error("[webhook] Error fetching contact:", fetchError);
  }

  if (existing) {
    // If name has changed, update it. Otherwise keep the existing record (and its active_branch_id)
    if (existing.name !== name) {
      const { data: updated, error: updateError } = await supabaseAdmin
        .from("contacts")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select("id, phone, name, active_branch_id")
        .single();
      
      if (updateError) {
        console.error("[webhook] Error updating contact name:", updateError);
        return existing;
      }
      return updated;
    }
    return existing;
  }

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .insert({ phone, name })
    .select("id, phone, name, active_branch_id")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to insert contact.");
  }

  return data;
}

async function setActiveBranch(contactId: string, branchId: string | null) {
  const { error } = await supabaseAdmin
    .from("contacts")
    .update({
      active_branch_id: branchId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contactId);

  if (error) {
    throw error;
  }
}

async function upsertConversation(contact: ContactRow, branchId: string, name: string): Promise<ConversationRow> {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .upsert(
      {
        contact_id: contact.id,
        branch_id: branchId,
        phone: contact.phone,
        name,
        has_unread: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "contact_id,branch_id" },
    )
    .select("id, contact_id, branch_id, phone, name, mode")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to upsert conversation.");
  }

  return data;
}

async function getOrCreateConversationState(conversationId: string): Promise<ConversationState> {
  const { data, error } = await supabaseAdmin
    .from("conversation_states")
    .select("*")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return parseConversationState(data as ConversationState);
  }

  const defaults = getDefaultConversationState(conversationId);
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("conversation_states")
    .insert(defaults)
    .select("*")
    .single();

  if (insertError || !inserted) {
    throw insertError ?? new Error("Failed to create conversation state.");
  }

  return parseConversationState(inserted as ConversationState);
}

async function persistUserMessage(
  conversationId: string,
  content: string,
  whatsappMessageId: string,
  createdAt: string,
): Promise<PersistedUserMessage> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "user",
      sender_kind: "user",
      content,
      whatsapp_msg_id: whatsappMessageId,
      created_at: createdAt,
    })
    .select("id, ingest_seq, content, created_at, whatsapp_msg_id")
    .maybeSingle();

  if (!error) {
    return {
      message: data
        ? {
            id: data.id,
            ingest_seq: data.ingest_seq,
            content: data.content,
            created_at: data.created_at,
            whatsapp_msg_id: data.whatsapp_msg_id,
          }
        : null,
    };
  }

  if (String(error.code) !== "23505") {
    throw error;
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("messages")
    .select("id, ingest_seq, content, created_at, whatsapp_msg_id")
    .eq("conversation_id", conversationId)
    .eq("whatsapp_msg_id", whatsappMessageId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  return {
    message: existing
      ? {
          id: existing.id,
          ingest_seq: existing.ingest_seq,
          content: existing.content,
          created_at: existing.created_at,
          whatsapp_msg_id: existing.whatsapp_msg_id,
        }
      : null,
  };
}

async function drainConversationQueue(conversation: ConversationRow) {
  const token = await acquireConversationLock(conversation.id);
  if (!token) {
    console.warn(`[webhook] Skipping queue drain because lock is busy for conversation ${conversation.id}`);
    return;
  }

  try {
    const branch = await getBranchById(conversation.branch_id);
    if (!branch) {
      throw new Error(`Missing branch ${conversation.branch_id} for conversation ${conversation.id}`);
    }
    let settings = await getRestaurantSettings(conversation.branch_id);
    let settingsLoadedAt = Date.now();
    let isOpenNow = settings.is_accepting_orders && isWithinOperatingHours(settings.opening_time, settings.closing_time);
    let cachedMenuItems: MenuCatalogItem[] | null = null;
    let menuLoadedAt = 0;

    while (true) {
      const state = await getOrCreateConversationState(conversation.id);
      const nextMessage = await getNextPendingUserMessage(
        conversation.id,
        state.last_processed_message_seq,
      );
      if (!nextMessage) break;

      // Check if we should resume bot mode from human handoff
      if (conversation.mode === "human" && shouldResumeBotFromHumanMessage(nextMessage.content)) {
        await resumeBotForConversation(conversation.id);
        await supabaseAdmin
          .from("conversations")
          .update({
            mode: "bot",
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversation.id);
        // Skip processing this message as it's a control command
        await updateConversationState(state, {
          last_processed_user_message_id: nextMessage.whatsapp_msg_id,
          last_processed_message_seq: nextMessage.ingest_seq,
          last_processed_user_message_at: nextMessage.created_at,
          last_user_whatsapp_msg_id: nextMessage.whatsapp_msg_id,
          last_error: null,
        });
        continue;
      }

      if (isStaleMessage(nextMessage, state)) {
        await updateConversationState(state, {
          last_processed_message_seq: nextMessage.ingest_seq,
          last_error: null,
        });
        continue;
      }

      if (Date.now() - settingsLoadedAt > 60_000) {
        settings = await getRestaurantSettings(conversation.branch_id);
        settingsLoadedAt = Date.now();
        isOpenNow = settings.is_accepting_orders && isWithinOperatingHours(settings.opening_time, settings.closing_time);
      }
      // Detect message type for optimization
      const messageType = detectMessageType(nextMessage.content.toLowerCase().trim());

      // Only load expensive resources for complex/menu messages
      const needsFullProcessing = messageType === "complex" || messageType === "menu_related";
      if (needsFullProcessing && (!cachedMenuItems || Date.now() - menuLoadedAt > 5 * 60_000)) {
        cachedMenuItems = await getMenuCatalog(conversation.branch_id);
        menuLoadedAt = Date.now();
      }
      const shouldHydrateSession = !(messageType === "greeting" || messageType === "acknowledgment");
      const [
        menuItems,
        semanticMatches,
        session,
      ] = await Promise.all([
        needsFullProcessing ? Promise.resolve(cachedMenuItems ?? []) : Promise.resolve([]),
        messageType === "complex" && shouldRunSemanticLookup(nextMessage.content)
          ? getSemanticMenuMatches(conversation.branch_id, nextMessage.content, 5)
          : Promise.resolve([]),
        shouldHydrateSession
          ? getOrCreateUserSession(conversation.id, {
              active_node: conversation.mode === "human" ? "human_handoff" : "cart_builder",
              status: conversation.mode === "human" ? "human_handoff" : "active",
              is_bot_active: conversation.mode !== "human",
            })
          : Promise.resolve(getDefaultUserSession(conversation.id)),
      ]);

      const decision = await decideTurn({
        messageText: nextMessage.content,
        state,
        menuItems,
        semanticMatches,
        branch: {
          id: branch.id,
          name: branch.name,
          address: branch.address ?? null,
        },
        settings,
        isOpenNow,
        recentOrder: null,
        session,
      });

      const updatedState: Partial<ConversationState> = decision.statePatch ?? {};
      const nextStateSnapshot = parseConversationState({
        ...state,
        ...updatedState,
        conversation_id: state.conversation_id,
      });

      try {
        let reply = "";

        if (decision.kind === "escalate_to_human") {
          reply = decision.reply;
          await escalateToHuman({
            conversationId: conversation.id,
            branchId: conversation.branch_id,
            phone: conversation.phone,
            reason: decision.reason,
            prefersRomanUrdu: (updatedState.preferred_language ?? state.preferred_language) === "roman_urdu",
          });
          await updateConversationState(state, {
            ...updatedState,
            last_processed_user_message_id: nextMessage.whatsapp_msg_id,
            last_processed_message_seq: nextMessage.ingest_seq,
            last_processed_user_message_at: nextMessage.created_at,
            last_user_whatsapp_msg_id: nextMessage.whatsapp_msg_id,
            last_error: null,
          });
          await updateUserSession(
            conversation.id,
            buildSessionUpdate({
              session,
              stateBefore: state,
              stateAfter: nextStateSnapshot,
              mode: "human",
              intent: (decision.trace?.intent as OrderTurnIntent | undefined) ?? null,
              lastUserMessage: nextMessage.content,
              lastAssistantReply: reply,
              semanticCandidates: semanticMatches.map((item) => ({
                id: item.id,
                name: item.name,
                price: item.price,
                category: item.category,
                similarity: item.similarity,
              })),
              forceNode: "human_handoff",
              escalationReason: decision.reason,
            }),
          );
          await recordOrderAgentTurn({
            conversationId: conversation.id,
            messageId: nextMessage.id,
            whatsappMessageId: nextMessage.whatsapp_msg_id,
            workflowBefore: state.workflow_step,
            workflowAfter:
              (updatedState.workflow_step as ConversationState["workflow_step"] | undefined) ?? state.workflow_step,
            decisionKind: decision.kind,
            trace: decision.trace,
            result: "success",
            reply,
          });
          break;
        }

        if (decision.kind === "fallback") {
          // For fallback, we need conversation history and menu data
          const history = await getConversationHistoryUpTo(conversation.id, nextMessage.ingest_seq);
          const fallbackMenuForAI = await getMenuForAI(conversation.branch_id);
          reply = await getCustomerSupportReply(
            history,
            fallbackMenuForAI,
            isOpenNow,
            history.some((entry) => entry.role === "assistant"),
            settings,
            (decision.statePatch?.preferred_language ?? state.preferred_language) || "english",
            {
              id: branch.id,
              slug: branch.slug,
              name: branch.name,
              city: branch.city,
              address: branch.address,
            },
          );
        } else {
          reply = decision.reply;
        }

        if (decision.kind === "place_order") {
          await createOrderFromPayload(
            conversation.id,
            conversation.branch_id,
            nextMessage.whatsapp_msg_id,
            decision.order,
            settings,
          );
        }

        const optionsFromState = Array.isArray(updatedState.last_presented_options)
          ? updatedState.last_presented_options
          : null;
        const interactiveList =
          ("interactiveList" in decision ? decision.interactiveList : null) ??
          (optionsFromState && optionsFromState.length > 0
            ? buildInteractiveListForPresentedOptions(
              optionsFromState,
              (updatedState.preferred_language ?? state.preferred_language) === "roman_urdu",
            )
            : null);

        const flowMessage =
          decision.kind === "place_order"
            ? null
            : buildFlowMessageForAgentReply({
                conversationId: conversation.id,
                prefersRomanUrdu: (updatedState.preferred_language ?? state.preferred_language) === "roman_urdu",
                workflowStep: nextStateSnapshot.workflow_step,
                branch: {
                  id: branch.id,
                  slug: branch.slug,
                  name: branch.name,
                  address: branch.address,
                },
                menuItems,
                cart: nextStateSnapshot.cart,
                orderType: nextStateSnapshot.order_type,
                address: nextStateSnapshot.address,
                guests: nextStateSnapshot.guests,
                reservationTime: nextStateSnapshot.reservation_time,
                settings,
                suggestedUpsell:
                  typeof nextStateSnapshot.upsell_item_name === "string" &&
                  nextStateSnapshot.upsell_item_name.trim() &&
                  typeof nextStateSnapshot.upsell_item_price === "number"
                    ? {
                        name: nextStateSnapshot.upsell_item_name,
                        price: nextStateSnapshot.upsell_item_price,
                      }
                    : null,
                body: reply,
              });

        await sendAndPersistAssistantMessage(conversation.id, conversation.phone, reply, interactiveList, flowMessage);
        await updateConversationState(state, {
          ...updatedState,
          last_processed_user_message_id: nextMessage.whatsapp_msg_id,
          last_processed_message_seq: nextMessage.ingest_seq,
          last_processed_user_message_at: nextMessage.created_at,
          last_user_whatsapp_msg_id: nextMessage.whatsapp_msg_id,
          last_error: null,
        });
        if (shouldHydrateSession) {
          await updateUserSession(
            conversation.id,
            buildSessionUpdate({
              session,
              stateBefore: state,
              stateAfter: nextStateSnapshot,
              mode: conversation.mode,
              intent: (decision.trace?.intent as OrderTurnIntent | undefined) ?? null,
              lastUserMessage: nextMessage.content,
              lastAssistantReply: reply,
              semanticCandidates: semanticMatches.map((item) => ({
                id: item.id,
                name: item.name,
                price: item.price,
                category: item.category,
                similarity: item.similarity,
              })),
            }),
          );
        }
        await recordOrderAgentTurn({
          conversationId: conversation.id,
          messageId: nextMessage.id,
          whatsappMessageId: nextMessage.whatsapp_msg_id,
          workflowBefore: state.workflow_step,
          workflowAfter:
            (updatedState.workflow_step as ConversationState["workflow_step"] | undefined) ?? state.workflow_step,
          decisionKind: decision.kind,
          trace: decision.trace,
          result: "success",
          reply,
        });
      } catch (error) {
        if (error instanceof OutboundMessageError) {
          if (error.messageSent) {
            await updateConversationState(state, {
              ...updatedState,
              last_processed_user_message_id: nextMessage.whatsapp_msg_id,
              last_processed_message_seq: nextMessage.ingest_seq,
              last_processed_user_message_at: nextMessage.created_at,
              last_user_whatsapp_msg_id: nextMessage.whatsapp_msg_id,
              last_error: error.message,
            });
            await recordOrderAgentTurn({
              conversationId: conversation.id,
              messageId: nextMessage.id,
              whatsappMessageId: nextMessage.whatsapp_msg_id,
              workflowBefore: state.workflow_step,
              workflowAfter:
                (updatedState.workflow_step as ConversationState["workflow_step"] | undefined) ?? state.workflow_step,
              decisionKind: decision.kind,
              trace: decision.trace,
              result: "partial",
              reply: null,
              error: error.message,
            });
            continue;
          }

          await updateConversationState(state, {
            last_error: error.message,
          });
          await recordOrderAgentTurn({
            conversationId: conversation.id,
            messageId: nextMessage.id,
            whatsappMessageId: nextMessage.whatsapp_msg_id,
            workflowBefore: state.workflow_step,
            workflowAfter: state.workflow_step,
            decisionKind: decision.kind,
            trace: decision.trace,
            result: "failed",
            reply: null,
            error: error.message,
          });
          throw error;
        }

        const replyLanguage =
          (updatedState.preferred_language ?? state.preferred_language) === "roman_urdu" ? "roman_urdu" : "english";
        const fallback =
          replyLanguage === "roman_urdu"
            ? "Maazrat, system is waqt thora busy hai. Thori dair mein dubara message bhej dein ya urgent help ke liye call karein."
            : "I'm sorry, the system is a little busy right now. Please send your message again in a moment or call us for urgent help.";
        try {
          await sendAndPersistAssistantMessage(conversation.id, conversation.phone, fallback);
          await updateConversationState(state, {
            last_processed_user_message_id: nextMessage.whatsapp_msg_id,
            last_processed_message_seq: nextMessage.ingest_seq,
            last_processed_user_message_at: nextMessage.created_at,
            last_user_whatsapp_msg_id: nextMessage.whatsapp_msg_id,
            last_error: error instanceof Error ? error.message : "Unknown processing error",
          });
          await recordOrderAgentTurn({
            conversationId: conversation.id,
            messageId: nextMessage.id,
            whatsappMessageId: nextMessage.whatsapp_msg_id,
            workflowBefore: state.workflow_step,
            workflowAfter: state.workflow_step,
            decisionKind: decision.kind,
            trace: decision.trace,
            result: "recovered",
            reply: fallback,
            error: error instanceof Error ? error.message : "Unknown processing error",
          });
        } catch (fallbackError) {
          if (fallbackError instanceof OutboundMessageError && fallbackError.messageSent) {
            await updateConversationState(state, {
              last_processed_user_message_id: nextMessage.whatsapp_msg_id,
              last_processed_message_seq: nextMessage.ingest_seq,
              last_processed_user_message_at: nextMessage.created_at,
              last_user_whatsapp_msg_id: nextMessage.whatsapp_msg_id,
              last_error: fallbackError.message,
            });
            await recordOrderAgentTurn({
              conversationId: conversation.id,
              messageId: nextMessage.id,
              whatsappMessageId: nextMessage.whatsapp_msg_id,
              workflowBefore: state.workflow_step,
              workflowAfter: state.workflow_step,
              decisionKind: decision.kind,
              trace: decision.trace,
              result: "partial",
              reply: null,
              error: fallbackError.message,
            });
            continue;
          }

          await updateConversationState(state, {
            last_error:
              error instanceof Error
                ? `${error.message} | Fallback failed: ${fallbackError instanceof Error ? fallbackError.message : "Unknown error"}`
                : "Unknown processing error",
          });
          await recordOrderAgentTurn({
            conversationId: conversation.id,
            messageId: nextMessage.id,
            whatsappMessageId: nextMessage.whatsapp_msg_id,
            workflowBefore: state.workflow_step,
            workflowAfter: state.workflow_step,
            decisionKind: decision.kind,
            trace: decision.trace,
            result: "failed",
            reply: null,
            error:
              fallbackError instanceof Error
                ? fallbackError.message
                : "Fallback failed with unknown error",
          });
          throw fallbackError;
        }
      }
    }
  } finally {
    await releaseConversationLock(conversation.id, token);
  }
}

async function getNextPendingUserMessage(
  conversationId: string,
  lastProcessedMessageSeq: number | null,
): Promise<MessageRow | null> {
  let query = supabaseAdmin
    .from("messages")
    .select("id, ingest_seq, content, created_at, whatsapp_msg_id")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .order("ingest_seq", { ascending: true })
    .limit(1);

  if (lastProcessedMessageSeq != null) {
    query = query.gt("ingest_seq", lastProcessedMessageSeq);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    ingest_seq: data.ingest_seq,
    content: data.content,
    created_at: data.created_at,
    whatsapp_msg_id: data.whatsapp_msg_id,
  };
}

async function getConversationHistoryUpTo(conversationId: string, ingestSeq: number) {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("role, content, ingest_seq")
    .eq("conversation_id", conversationId)
    .lte("ingest_seq", ingestSeq)
    .order("ingest_seq", { ascending: false })
    .limit(20);

  if (error) throw error;
  return (data ?? []).reverse().map((row) => ({
    role: row.role,
    content: row.content,
  }));
}

async function sendAndPersistAssistantMessage(
  conversationId: string,
  phone: string,
  content: string,
  interactiveList?: {
    body: string;
    buttonText: string;
    sectionTitle?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  } | null,
  flowMessage?: WhatsAppInteractiveFlowPayload | null,
) {
  if (flowMessage) {
    try {
      await sendAndPersistOutboundFlowMessage({
        conversationId,
        phone,
        content,
        senderKind: "ai",
        flow: flowMessage,
      });
      return;
    } catch (error) {
      if (!(error instanceof OutboundMessageError && !error.messageSent)) {
        throw error;
      }
    }
  }

  if (interactiveList && interactiveList.rows.length > 0) {
    try {
      await sendAndPersistOutboundInteractiveMessage({
        conversationId,
        phone,
        content,
        senderKind: "ai",
        interactive: interactiveList,
      });
      return;
    } catch (error) {
      if (error instanceof OutboundMessageError && !error.messageSent) {
        await sendAndPersistOutboundMessage({
          conversationId,
          phone,
          content: `${content}\n\n${buildInteractiveFallbackText(interactiveList)}`,
          senderKind: "ai",
        });
        return;
      }

      throw error;
    }
  }

  await sendAndPersistOutboundMessage({
    conversationId,
    phone,
    content,
    senderKind: "ai",
  });
}

async function markMessageProcessed(
  state: ConversationState,
  whatsappMessageId: string,
  createdAt: string,
  ingestSeq: number | null,
  extraPatch?: Partial<ConversationState>,
) {
  await updateConversationState(state, {
    ...extraPatch,
    last_processed_user_message_id: whatsappMessageId,
    ...(ingestSeq != null ? { last_processed_message_seq: ingestSeq } : {}),
    last_processed_user_message_at: createdAt,
    last_user_whatsapp_msg_id: whatsappMessageId,
    last_error: null,
  });
}

async function updateConversationState(state: ConversationState, patch: Partial<ConversationState>) {
  const nextState = {
    ...state,
    ...patch,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("conversation_states")
    .update(nextState)
    .eq("conversation_id", state.conversation_id);

  if (error) {
    throw error;
  }
}

async function acquireConversationLock(conversationId: string): Promise<string | null> {
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 90 * 1000).toISOString();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data: unlockedRow, error: unlockedError } = await supabaseAdmin
      .from("conversation_states")
      .update({
        processing_token: token,
        processing_started_at: now,
      })
      .eq("conversation_id", conversationId)
      .is("processing_token", null)
      .select("conversation_id")
      .maybeSingle();

    if (unlockedError) throw unlockedError;
    if (unlockedRow) return token;

    const { data: staleRow, error: staleError } = await supabaseAdmin
      .from("conversation_states")
      .update({
        processing_token: token,
        processing_started_at: now,
      })
      .eq("conversation_id", conversationId)
      .lt("processing_started_at", staleBefore)
      .select("conversation_id")
      .maybeSingle();

    if (staleError) throw staleError;
    if (staleRow) return token;

    await sleep(150 * (attempt + 1));
  }

  return null;
}

async function releaseConversationLock(conversationId: string, token: string) {
  const { error } = await supabaseAdmin
    .from("conversation_states")
    .update({
      processing_token: null,
      processing_started_at: null,
    })
    .eq("conversation_id", conversationId)
    .eq("processing_token", token);

  if (error) {
    console.error("[webhook] Failed to release lock:", error);
  }
}

async function createOrderFromPayload(
  conversationId: string,
  branchId: string,
  sourceUserMessageId: string | null,
  payload: PlaceableOrderPayload,
  settings: Awaited<ReturnType<typeof getRestaurantSettings>>,
) {
  if (!sourceUserMessageId) {
    throw new Error("Missing source user message id for order placement.");
  }

  const { data: existingOrder } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("source_user_message_id", sourceUserMessageId)
    .maybeSingle();

  if (existingOrder) return existingOrder;

  const { data: menuRows, error: menuError } = await supabaseAdmin
    .from("menu_items")
    .select("name, price, category")
    .eq("branch_id", branchId)
    .eq("is_available", true);

  if (menuError) throw menuError;

  const validatedItems = payload.items.map((item) => {
    const match = (menuRows ?? []).find((row) => row.name.toLowerCase() === item.name.toLowerCase());
    if (!match) {
      throw new Error(`Menu item no longer exists: ${item.name}`);
    }

    return {
      name: match.name,
      qty: item.qty,
      price: Number(match.price),
      category: match.category ?? null,
    };
  });

  const subtotal = validatedItems.reduce((total, item) => total + item.price * item.qty, 0);
  const deliveryFee =
    payload.type === "delivery" && settings.delivery_enabled && settings.delivery_fee > 0
      ? Number(settings.delivery_fee)
      : 0;

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .insert({
      branch_id: branchId,
      conversation_id: conversationId,
      source_user_message_id: sourceUserMessageId,
      type: payload.type,
      subtotal,
      delivery_fee: deliveryFee,
      address: payload.type === "delivery" ? payload.address : null,
      guests: payload.type === "dine-in" ? payload.guests : null,
      reservation_time: payload.type === "dine-in" ? payload.reservation_time : null,
      status: "received",
    })
    .select("id")
    .single();

  if (orderError || !order) {
    throw orderError ?? new Error("Failed to create order.");
  }

  const { error: itemsError } = await supabaseAdmin.from("order_items").insert(
    validatedItems.map((item) => ({
      order_id: order.id,
      name: item.name,
      qty: item.qty,
      price: item.price,
    })),
  );

  if (itemsError) {
    await supabaseAdmin.from("orders").delete().eq("id", order.id);
    throw itemsError;
  }

  return order;
}

function buildInteractiveListForPresentedOptions(
  options: MenuCatalogItem[],
  prefersRomanUrdu: boolean,
):
  | {
    body: string;
    buttonText: string;
    sectionTitle?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }
  | null {
  if (!Array.isArray(options) || options.length < 1) {
    return null;
  }

  const rows = options.slice(0, 10).map((item) => ({
    id: item.id,
    title: item.name,
    description: `Rs. ${item.price}${item.category ? ` • ${item.category}` : ""}`,
  }));

  return {
    body: prefersRomanUrdu
      ? "Apni pasand ka item list se select karein."
      : "Please choose your item from the list.",
    buttonText: prefersRomanUrdu ? "Select Item" : "Select Item",
    sectionTitle: prefersRomanUrdu ? "Menu Options" : "Menu Options",
    rows,
  };
}

function buildInteractiveListForBranches(
  branches: BranchSummary[],
  prefersRomanUrdu: boolean,
  selectedCity?: string,
):
  | {
    body: string;
    buttonText: string;
    sectionTitle?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }
  | null {
  if (!Array.isArray(branches) || branches.length < 1) {
    return null;
  }

  const rows = branches.slice(0, 10).map((branch) => ({
    id: branch.id,
    title: branch.name,
    description: branch.address || undefined,
  }));

  return {
    body: prefersRomanUrdu
      ? selectedCity
        ? `*${selectedCity}* mein apni branch select karein.`
        : "Order shuru karne se pehle apni branch select karein."
      : selectedCity
        ? `Please choose your branch in *${selectedCity}*.`
        : "Before we start your order, please choose your branch.",
    buttonText: prefersRomanUrdu ? "Select Branch" : "Select Branch",
    sectionTitle: prefersRomanUrdu ? "Branches" : "Branches",
    rows,
  };
}

function buildBranchSelectionFlowMessage(
  phone: string,
  branches: BranchSummary[],
  prefersRomanUrdu: boolean,
): WhatsAppInteractiveFlowPayload | null {
  return buildWhatsAppFlowPayload({
    context: "branch",
    body: prefersRomanUrdu
      ? "Branch choose karne ke liye rich menu khol dein."
      : "Open the rich branch picker to continue.",
    preferredLanguage: prefersRomanUrdu ? "roman_urdu" : "english",
    branches,
    workflowStep: "awaiting_branch_selection",
    conversationId: phone,
  });
}

function buildFlowMessageForAgentReply(input: {
  context?: WhatsAppFlowContext;
  conversationId: string;
  prefersRomanUrdu: boolean;
  workflowStep: ConversationState["workflow_step"];
  branch?: { id: string; slug?: string | null; name: string; address?: string | null } | null;
  branches?: BranchSummary[];
  menuItems?: MenuCatalogItem[];
  cart?: ConversationState["cart"];
  orderType?: ConversationState["order_type"];
  address?: ConversationState["address"];
  guests?: ConversationState["guests"];
  reservationTime?: ConversationState["reservation_time"];
  settings?: Awaited<ReturnType<typeof getRestaurantSettings>>;
  suggestedUpsell?: { name: string; price: number } | null;
  body: string;
}): WhatsAppInteractiveFlowPayload | null {
  const context = input.context ?? inferFlowContext(input.workflowStep);
  if (!context) return null;

  return buildWhatsAppFlowPayload({
    context,
    conversationId: input.conversationId,
    body: input.body,
    preferredLanguage: input.prefersRomanUrdu ? "roman_urdu" : "english",
    workflowStep: input.workflowStep,
    branch: input.branch ?? undefined,
    branches: input.branches,
    menuItems: input.menuItems,
    cart: input.cart,
    orderType: input.orderType,
    address: input.address,
    guests: input.guests,
    reservationTime: input.reservationTime,
    settings: input.settings,
    suggestedUpsell: input.suggestedUpsell,
  });
}

function inferFlowContext(workflowStep: ConversationState["workflow_step"]): WhatsAppFlowContext | null {
  if (workflowStep === "awaiting_branch_selection") return "branch";
  if (workflowStep === "awaiting_upsell_reply") return "upsell";
  if (
    workflowStep === "awaiting_order_type" ||
    workflowStep === "awaiting_delivery_address" ||
    workflowStep === "awaiting_dine_in_details" ||
    workflowStep === "awaiting_confirmation"
  ) {
    return "checkout";
  }

  if (
    workflowStep === "idle" ||
    workflowStep === "collecting_items" ||
    workflowStep === "awaiting_resume_decision"
  ) {
    return "menu";
  }

  return null;
}

async function sendBranchSelectionMessage(
  phone: string,
  branches: BranchSummary[],
  prefersRomanUrdu: boolean,
  selectedCity?: string,
) {
  const interactiveList = buildInteractiveListForBranches(branches, prefersRomanUrdu, selectedCity);
  if (interactiveList) {
    try {
      await sendWhatsAppInteractiveList(phone, interactiveList);
      return;
    } catch (error) {
      console.warn("[webhook] Interactive branch list failed, falling back to text:", error);
    }
  }

  const flowMessage = buildBranchSelectionFlowMessage(phone, branches, prefersRomanUrdu);
  if (flowMessage) {
    try {
      await sendWhatsAppInteractiveFlow(phone, flowMessage);
      return;
    } catch (error) {
      console.warn("[webhook] Flow branch selector failed, falling back to text:", error);
    }
  }

  await sendWhatsAppMessage(phone, getBranchSelectionPromptForCity(branches, prefersRomanUrdu, selectedCity));
}

async function sendCitySelectionMessage(
  phone: string,
  cityGroups: CityBranchGroup[],
  prefersRomanUrdu: boolean,
) {
  const cities = cityGroups.map((group) => group.city);
  const interactiveList = buildInteractiveListForCities(cities, prefersRomanUrdu);
  if (interactiveList) {
    try {
      await sendWhatsAppInteractiveList(phone, interactiveList);
      return;
    } catch (error) {
      console.warn("[webhook] Interactive city list failed, falling back to text:", error);
    }
  }

  await sendWhatsAppMessage(phone, getCitySelectionPrompt(cities, prefersRomanUrdu));
}

function getBranchSelectionPromptForCity(
  branches: BranchSummary[],
  prefersRomanUrdu: boolean,
  selectedCity?: string,
): string {
  if (!selectedCity) {
    return getBranchSelectionPrompt(branches, prefersRomanUrdu);
  }

  if (branches.length === 0) {
    return prefersRomanUrdu
      ? `Maazrat, ${selectedCity} mein koi branch available nahi hai.`
      : `Sorry, no branches are available in ${selectedCity}.`;
  }

  const intro = prefersRomanUrdu
    ? `${selectedCity} mein apni branch select karein:`
    : `Please choose your branch in ${selectedCity}:`;
  const closing = prefersRomanUrdu
    ? "Reply mein branch ka naam bhej dein."
    : "Reply with your branch name.";

  return [
    intro,
    ...branches.map((branch, index) => `${index + 1}. ${branch.name}${branch.address ? ` - ${branch.address}` : ""}`),
    closing,
  ].join("\n");
}

function buildInteractiveListForCities(
  cities: string[],
  prefersRomanUrdu: boolean,
):
  | {
    body: string;
    buttonText: string;
    sectionTitle?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }
  | null {
  const uniqueCities = dedupeCities(cities);
  if (uniqueCities.length < 1) {
    return null;
  }

  const rows = uniqueCities.slice(0, 10).map((city, index) => ({
    id: `city_option_${index + 1}`,
    title: city,
  }));

  return {
    body: prefersRomanUrdu
      ? "Welcome! Sab se pehle apna city select karein."
      : "Welcome! First, please choose your city.",
    buttonText: prefersRomanUrdu ? "Select City" : "Select City",
    sectionTitle: prefersRomanUrdu ? "Cities" : "Cities",
    rows,
  };
}

function getUniqueMenuCategories(menuItems: MenuCatalogItem[]): string[] {
  return [...new Set(menuItems.map((item) => item.category?.trim() || "General"))];
}

function buildInteractiveCategoryList(
  menuItems: MenuCatalogItem[],
  prefersRomanUrdu: boolean,
  page: number,
):
  | {
    body: string;
    buttonText: string;
    sectionTitle?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }
  | null {
  const categories = getUniqueMenuCategories(menuItems);
  if (categories.length < 2) return null;

  const pageSize = 9;
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  if (start >= categories.length) return null;

  const pageCategories = categories.slice(start, start + pageSize);
  const rows = pageCategories.map((category, index) => {
    const absoluteIndex = start + index + 1;
    const title = category.length > 24 ? `${category.slice(0, 21)}...` : category;
    return {
      id: `category_option_${absoluteIndex}`,
      title,
    };
  });

  const hasMore = start + pageSize < categories.length;
  if (hasMore) {
    rows.push({
      id: `category_more_${safePage + 1}`,
      title: prefersRomanUrdu ? "More Categories" : "More Categories",
    });
  }

  return {
    body: prefersRomanUrdu
      ? "Menu categories se ek select karein."
      : "Choose a category from the menu.",
    buttonText: prefersRomanUrdu ? "Select Category" : "Select Category",
    sectionTitle: prefersRomanUrdu ? "Categories" : "Categories",
    rows,
  };
}

function getCitySelectionPrompt(cities: string[], prefersRomanUrdu: boolean): string {
  const uniqueCities = dedupeCities(cities);
  if (uniqueCities.length === 0) {
    return prefersRomanUrdu
      ? "Maazrat, abhi city list available nahi hai. Thori dair baad try karein."
      : "Sorry, city options are not available right now. Please try again shortly.";
  }

  const intro = prefersRomanUrdu
    ? "Welcome! Sab se pehle apna city select karein:"
    : "Welcome! First, please choose your city:";
  const closing = prefersRomanUrdu
    ? "Reply mein city ka naam bhej dein."
    : "Reply with your city name.";

  return [intro, ...uniqueCities.map((city, index) => `${index + 1}. ${city}`), closing].join("\n");
}

function findCitySelection(input: string, cities: string[]): string | null {
  const uniqueCities = dedupeCities(cities);
  const raw = input.trim();
  const normalizedInput = normalizeCityValue(raw);
  if (!normalizedInput || uniqueCities.length === 0) return null;

  const optionMatch = raw.match(/^city[_\s-]?option[_\s-]?(\d+)$/i);
  if (optionMatch) {
    const index = Number.parseInt(optionMatch[1], 10) - 1;
    if (index >= 0 && index < uniqueCities.length) {
      return uniqueCities[index];
    }
  }

  const numberMatch = normalizedInput.match(/\b(\d{1,2})\b/);
  if (numberMatch) {
    const index = Number.parseInt(numberMatch[1], 10) - 1;
    if (index >= 0 && index < uniqueCities.length) {
      return uniqueCities[index];
    }
  }

  const exact = uniqueCities.find((city) => normalizeCityValue(city) === normalizedInput);
  if (exact) return exact;

  const fuzzy = uniqueCities.find((city) => {
    const normalizedCity = normalizeCityValue(city);
    return normalizedCity.includes(normalizedInput) || normalizedInput.includes(normalizedCity);
  });

  return fuzzy ?? null;
}

function normalizeCityValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeCities(cities: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const city of cities) {
    const normalized = normalizeCityValue(city);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(city.trim());
  }

  return deduped;
}

async function buildCityBranchGroups(branches: BranchSummary[]): Promise<CityBranchGroup[]> {
  if (branches.length === 0) return [];

  const grouped = new Map<string, CityBranchGroup>();
  for (const branch of branches) {
    const rawCity = branch.city?.trim() || deriveCityFromAddress(branch.address);
    const normalizedCity = normalizeCityValue(rawCity);
    if (!normalizedCity) continue;

    const existing = grouped.get(normalizedCity);
    if (existing) {
      existing.branches.push(branch);
      continue;
    }

    grouped.set(normalizedCity, {
      city: rawCity.trim(),
      branches: [branch],
    });
  }

  return Array.from(grouped.values()).sort((left, right) => left.city.localeCompare(right.city));
}

function deriveCityFromAddress(address: string | null | undefined): string {
  const fallbackCity = process.env.NEXT_PUBLIC_APP_CITY?.trim() || "Wah Cantt";
  if (!address) return fallbackCity;

  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts[parts.length - 1] : fallbackCity;
}

function buildInteractiveFallbackText(payload: {
  body: string;
  rows: Array<{ title: string; description?: string }>;
}) {
  const options = payload.rows
    .slice(0, 10)
    .map((row, index) => `${index + 1}. ${row.title}${row.description ? ` - ${row.description}` : ""}`)
    .join("\n");

  return [payload.body, options].filter(Boolean).join("\n");
}

function toIsoTimestamp(timestamp: string): string {
  const parsed = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return new Date().toISOString();
  }

  const date = new Date(parsed * 1000);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function compareMessageTimestamps(left: string, right: string): number {
  const leftValue = Number.parseInt(left, 10);
  const rightValue = Number.parseInt(right, 10);

  const leftValid = Number.isFinite(leftValue);
  const rightValid = Number.isFinite(rightValue);
  if (leftValid && rightValid) return leftValue - rightValue;
  if (leftValid) return -1;
  if (rightValid) return 1;
  return 0;
}

function isStaleMessage(message: MessageRow, state: ConversationState): boolean {
  if (!state.last_processed_user_message_at) {
    return false;
  }

  const nextTime = new Date(message.created_at).getTime();
  const lastProcessedTime = new Date(state.last_processed_user_message_at).getTime();

  if (Number.isNaN(nextTime) || Number.isNaN(lastProcessedTime)) {
    return false;
  }

  return nextTime < lastProcessedTime;
}

function isValidWhatsAppSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error("[webhook] Missing WHATSAPP_APP_SECRET for signature validation.");
    return false;
  }

  if (!signatureHeader?.startsWith("sha256=")) {
    console.error("[webhook] Missing x-hub-signature-256 header.");
    return false;
  }

  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const received = signatureHeader.trim();
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function recordOrderAgentTurn(input: {
  conversationId: string;
  messageId: string;
  whatsappMessageId: string | null;
  workflowBefore: ConversationState["workflow_step"];
  workflowAfter: ConversationState["workflow_step"];
  decisionKind: TurnDecision["kind"];
  trace?: TurnDecision["trace"];
  result: "success" | "partial" | "recovered" | "failed";
  reply: string | null;
  error?: string;
}) {
  try {
    await supabaseAdmin.from("order_agent_turns").insert({
      conversation_id: input.conversationId,
      message_id: input.messageId,
      whatsapp_message_id: input.whatsappMessageId,
      workflow_before: input.workflowBefore,
      workflow_after: input.workflowAfter,
      decision_kind: input.decisionKind,
      nlu_intent: input.trace?.intent ?? null,
      nlu_confidence: input.trace?.confidence ?? null,
      nlu_unknown_items: input.trace?.unknownItems ?? [],
      nlu_notes: input.trace?.notes ?? null,
      processing_result: input.result,
      assistant_reply: input.reply,
      error_message: input.error ?? null,
    });
  } catch (error) {
    console.error("[webhook] Failed to record order agent turn:", error);
  }
}
