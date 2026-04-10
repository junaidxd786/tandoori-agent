import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { getCustomerSupportReply } from "@/lib/ai";
import {
  findBranchSelection,
  getActiveBranches,
  getBranchById,
  getBranchSelectionPrompt,
  isBranchChangeRequest,
} from "@/lib/branches";
import { OutboundMessageError, sendAndPersistOutboundMessage } from "@/lib/messages";
import {
  decideTurn,
  getDefaultConversationState,
  inferLanguagePreference,
  parseConversationState,
  type ConversationState,
  type PlaceableOrderPayload,
  type RecentOrderContext,
} from "@/lib/order-engine";
import { getMenuCatalog, getMenuForAI } from "@/lib/menu";
import { getRestaurantSettings, isWithinOperatingHours } from "@/lib/settings";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

type IncomingWhatsAppMessage = {
  id: string;
  from: string;
  type: string;
  timestamp: string;
  text?: { body?: string };
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
  try {
    rawBody = await req.text();
    if (!isValidWhatsAppSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
      return new Response("Unauthorized", { status: 401 });
    }
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  try {
    await processWebhook(body);
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[webhook] Processing failed:", error);
    return new Response("Retry", { status: 500 });
  }
}

async function processWebhook(body: unknown) {
  const events = extractIncomingMessages(body);
  if (events.length === 0) return;

  const branches = await getActiveBranches();
  const agentConversations = new Map<string, ConversationRow>();

  for (const event of events) {
    const { message, contactName } = event;
    const contact = await upsertContact(message.from, contactName);
    const prefersRomanUrdu = inferLanguagePreference(message.text?.body ?? "", "english") === "roman_urdu";
    const activeBranch = contact.active_branch_id
      ? branches.find((branch) => branch.id === contact.active_branch_id) ?? null
      : null;

    if (!contact.active_branch_id || !activeBranch) {
      if (contact.active_branch_id && !activeBranch) {
        await setActiveBranch(contact.id, null);
      }

      if (message.type !== "text") {
        if (message.type !== "reaction") {
          await sendWhatsAppMessage(message.from, getBranchSelectionPrompt(branches, prefersRomanUrdu));
        }
        continue;
      }

      const selectedBranch = findBranchSelection(message.text?.body ?? "", branches);
      if (!selectedBranch) {
        await sendWhatsAppMessage(message.from, getBranchSelectionPrompt(branches, prefersRomanUrdu));
        continue;
      }

      await setActiveBranch(contact.id, selectedBranch.id);
      const selectedConversation = await upsertConversation(contact, selectedBranch.id, contactName);
      const selectedState = await getOrCreateConversationState(selectedConversation.id);
      if (selectedState.last_processed_user_message_id === message.id) {
        continue;
      }

      const createdAt = toIsoTimestamp(message.timestamp);
      const persistedMessage = await persistUserMessage(
        selectedConversation.id,
        (message.text?.body || "").trim(),
        message.id,
        createdAt,
      );

      await sendAndPersistAssistantMessage(
        selectedConversation.id,
        message.from,
        prefersRomanUrdu
          ? `Theek hai, *${selectedBranch.name}* select ho gayi. Address: ${selectedBranch.address}\n\nAb apna order bhej dein.`
          : `Great, you've selected *${selectedBranch.name}*. Address: ${selectedBranch.address}\n\nSend your order whenever you're ready.`,
      );
      await markMessageProcessed(selectedState, message.id, createdAt, persistedMessage.message?.ingest_seq ?? null);
      continue;
    }

    const conversation = await upsertConversation(contact, activeBranch.id, contactName);
    const state = await getOrCreateConversationState(conversation.id);
    if (state.last_processed_user_message_id === message.id) {
      continue;
    }

    if (message.type !== "text") {
      if (message.type !== "reaction") {
        await sendAndPersistAssistantMessage(
          conversation.id,
          message.from,
          state.preferred_language === "roman_urdu"
            ? "Please text message bhej dein, main menu aur order mein help kar deta hoon."
            : "Please send a text message and I'll help you with the menu or your order.",
        );
      }
      await markMessageProcessed(state, message.id, toIsoTimestamp(message.timestamp), null);
      continue;
    }

    const content = (message.text?.body || "").trim();
    const createdAt = toIsoTimestamp(message.timestamp);
    const persistedMessage = await persistUserMessage(conversation.id, content, message.id, createdAt);

    if (isBranchChangeRequest(content)) {
      await updateConversationState(state, {
        ...getDefaultConversationState(conversation.id),
        workflow_step: "awaiting_branch_selection",
        preferred_language: inferLanguagePreference(content, state.preferred_language),
      });
      await setActiveBranch(contact.id, null);
      await sendAndPersistAssistantMessage(
        conversation.id,
        message.from,
        getBranchSelectionPrompt(branches, state.preferred_language === "roman_urdu"),
      );
      await markMessageProcessed(state, message.id, createdAt, persistedMessage.message?.ingest_seq ?? null);
      continue;
    }

    if (conversation.mode === "human") {
      await markMessageProcessed(state, message.id, createdAt, persistedMessage.message?.ingest_seq ?? null);
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

async function upsertContact(phone: string, name: string): Promise<ContactRow> {
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .upsert(
      {
        phone,
        name,
      },
      { onConflict: "phone" },
    )
    .select("id, phone, name, active_branch_id")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to upsert contact.");
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

    const settings = await getRestaurantSettings(conversation.branch_id);
    const isOpenNow = settings.is_accepting_orders && isWithinOperatingHours(settings.opening_time, settings.closing_time);
    const menuItems = await getMenuCatalog(conversation.branch_id);
    const menuForAI = await getMenuForAI(conversation.branch_id);

    while (true) {
      const state = await getOrCreateConversationState(conversation.id);
      const nextMessage = await getNextPendingUserMessage(
        conversation.id,
        state.last_processed_message_seq,
      );
      if (!nextMessage) break;

      if (isStaleMessage(nextMessage, state)) {
        await updateConversationState(state, {
          last_processed_message_seq: nextMessage.ingest_seq,
          last_error: null,
        });
        continue;
      }

      const recentOrder = await getRecentOrderContext(conversation.id);
      const decision = decideTurn({
        messageText: nextMessage.content,
        state,
        menuItems,
        settings,
        isOpenNow,
        recentOrder,
      });
      const updatedState: Partial<ConversationState> = decision.statePatch ?? {};

      try {
        let reply = "";

        if (decision.kind === "fallback") {
          const history = await getConversationHistoryUpTo(conversation.id, nextMessage.ingest_seq);
          reply = await getCustomerSupportReply(
            history,
            menuForAI,
            isOpenNow,
            history.some((entry) => entry.role === "assistant"),
            settings,
            (decision.statePatch?.preferred_language ?? state.preferred_language) || "english",
            {
              id: branch.id,
              slug: branch.slug,
              name: branch.name,
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

        await sendAndPersistAssistantMessage(conversation.id, conversation.phone, reply);
        await updateConversationState(state, {
          ...updatedState,
          last_processed_user_message_id: nextMessage.whatsapp_msg_id,
          last_processed_message_seq: nextMessage.ingest_seq,
          last_processed_user_message_at: nextMessage.created_at,
          last_user_whatsapp_msg_id: nextMessage.whatsapp_msg_id,
          last_error: null,
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
            continue;
          }

          await updateConversationState(state, {
            last_error: error.message,
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
        } catch (fallbackError) {
          if (fallbackError instanceof OutboundMessageError && fallbackError.messageSent) {
            await updateConversationState(state, {
              last_processed_user_message_id: nextMessage.whatsapp_msg_id,
              last_processed_message_seq: nextMessage.ingest_seq,
              last_processed_user_message_at: nextMessage.created_at,
              last_user_whatsapp_msg_id: nextMessage.whatsapp_msg_id,
              last_error: fallbackError.message,
            });
            continue;
          }

          await updateConversationState(state, {
            last_error:
              error instanceof Error
                ? `${error.message} | Fallback failed: ${fallbackError instanceof Error ? fallbackError.message : "Unknown error"}`
                : "Unknown processing error",
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
    .order("created_at", { ascending: true })
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

async function getRecentOrderContext(conversationId: string): Promise<RecentOrderContext | null> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("order_number, status, type, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    order_number: data.order_number,
    status: data.status,
    type: data.type,
    created_at: data.created_at,
  };
}

async function sendAndPersistAssistantMessage(conversationId: string, phone: string, content: string) {
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
) {
  await updateConversationState(state, {
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
      name: item.name,
      qty: item.qty,
      price: Number(item.price),
      category: item.category ?? null,
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
