import { supabaseAdmin } from "./supabase-admin";
import {
  sendWhatsAppInteractiveList,
  sendWhatsAppMessage,
  type WhatsAppInteractiveListPayload,
} from "./whatsapp";

export type MessageSenderKind = "user" | "ai" | "human" | "system";
export type MessageDeliveryStatus = "pending" | "sent" | "failed";

export class OutboundMessageError extends Error {
  constructor(
    message: string,
    public readonly messageSent: boolean,
    public readonly persistedMessageId: string | null = null,
  ) {
    super(message);
    this.name = "OutboundMessageError";
  }
}

type OutboundMessageParams = {
  conversationId: string;
  phone: string;
  content: string;
  senderKind: Exclude<MessageSenderKind, "user">;
};

type OutboundInteractiveMessageParams = OutboundMessageParams & {
  interactive: WhatsAppInteractiveListPayload;
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown outbound message error";
}

export async function persistSystemMessage(conversationId: string, content: string) {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      sender_kind: "system",
      content,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

export async function sendAndPersistOutboundMessage({
  conversationId,
  phone,
  content,
  senderKind,
}: OutboundMessageParams) {
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      sender_kind: senderKind,
      content,
      delivery_status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw insertError ?? new Error("Failed to persist outbound message before send.");
  }

  try {
    const result = await sendWhatsAppMessage(phone, content);
    const { error: updateError } = await supabaseAdmin
      .from("messages")
      .update({
        whatsapp_msg_id: result.messageId,
        delivery_status: "sent",
        delivery_error: null,
      })
      .eq("id", inserted.id);

    if (updateError) {
      throw new OutboundMessageError(updateError.message, true, inserted.id);
    }

    return {
      id: inserted.id,
      whatsappMessageId: result.messageId,
    };
  } catch (error) {
    const message = toErrorMessage(error);

    await supabaseAdmin
      .from("messages")
      .update({
        delivery_status: error instanceof OutboundMessageError && error.messageSent ? "sent" : "failed",
        delivery_error: error instanceof OutboundMessageError && error.messageSent ? message : message,
      })
      .eq("id", inserted.id);

    if (error instanceof OutboundMessageError) {
      throw error;
    }

    throw new OutboundMessageError(message, false, inserted.id);
  }
}

export async function sendAndPersistOutboundInteractiveMessage({
  conversationId,
  phone,
  content,
  senderKind,
  interactive,
}: OutboundInteractiveMessageParams) {
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      sender_kind: senderKind,
      content,
      delivery_status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw insertError ?? new Error("Failed to persist outbound interactive message before send.");
  }

  try {
    const result = await sendWhatsAppInteractiveList(phone, interactive);
    const { error: updateError } = await supabaseAdmin
      .from("messages")
      .update({
        whatsapp_msg_id: result.messageId,
        delivery_status: "sent",
        delivery_error: null,
      })
      .eq("id", inserted.id);

    if (updateError) {
      throw new OutboundMessageError(updateError.message, true, inserted.id);
    }

    return {
      id: inserted.id,
      whatsappMessageId: result.messageId,
    };
  } catch (error) {
    const message = toErrorMessage(error);

    await supabaseAdmin
      .from("messages")
      .update({
        delivery_status: error instanceof OutboundMessageError && error.messageSent ? "sent" : "failed",
        delivery_error: message,
      })
      .eq("id", inserted.id);

    if (error instanceof OutboundMessageError) {
      throw error;
    }

    throw new OutboundMessageError(message, false, inserted.id);
  }
}
