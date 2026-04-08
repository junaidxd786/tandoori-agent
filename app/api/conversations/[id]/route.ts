import { NextRequest, NextResponse } from "next/server";
import { persistSystemMessage, sendAndPersistOutboundMessage } from "@/lib/messages";
import { supabaseAdmin } from "@/lib/supabase-admin";

type ConversationPatchBody = {
  mode?: "agent" | "human";
  has_unread?: boolean;
};

function buildModeChangeNote(mode: "agent" | "human") {
  return mode === "agent"
    ? "AI agent was re-enabled for this conversation."
    : "Conversation was handed over to a human operator.";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      phone,
      name,
      mode,
      has_unread,
      updated_at,
      created_at,
      conversation_states (
        workflow_step,
        order_type,
        address,
        guests,
        reservation_time,
        cart,
        last_error
      )
    `)
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

// PATCH /api/conversations/[id] — update mode or has_unread
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as ConversationPatchBody;
  const { mode, has_unread } = body;
  let previousMode: "agent" | "human" | null = null;

  const updates: Record<string, boolean | "agent" | "human"> = {};
  if (mode !== undefined) {
    if (!["agent", "human"].includes(mode)) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
    const { data: existingConversation } = await supabaseAdmin
      .from("conversations")
      .select("mode")
      .eq("id", id)
      .maybeSingle();
    previousMode = existingConversation?.mode ?? null;
    updates.mode = mode;
  }
  
  if (has_unread !== undefined) {
    updates.has_unread = has_unread;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (mode !== undefined && previousMode && previousMode !== mode) {
    await persistSystemMessage(id, buildModeChangeNote(mode)).catch((persistError) => {
      console.error("[conversation PATCH] Failed to persist mode change note:", persistError);
    });
  }

  return NextResponse.json(data);
}

// POST /api/conversations/[id]/send — manual message from dashboard
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { message } = body;

  if (!message?.trim()) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  // Get conversation phone
  const { data: conversation, error: convError } = await supabaseAdmin
    .from("conversations")
    .select("phone")
    .eq("id", id)
    .single();

  if (convError || !conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  try {
    const sent = await sendAndPersistOutboundMessage({
      conversationId: id,
      phone: conversation.phone,
      content: message.trim(),
      senderKind: "human",
    });

    const { data: msg, error: msgError } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("id", sent.id)
      .single();

    if (msgError || !msg) {
      return NextResponse.json({ error: msgError?.message ?? "Message sent but could not be loaded." }, { status: 500 });
    }

    return NextResponse.json(msg);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Failed to send message";
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
