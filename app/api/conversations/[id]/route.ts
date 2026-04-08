import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

type ConversationPatchBody = {
  mode?: "agent" | "human";
  has_unread?: boolean;
};

// PATCH /api/conversations/[id] — update mode or has_unread
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as ConversationPatchBody;
  const { mode, has_unread } = body;

  const updates: Record<string, boolean | "agent" | "human"> = {};
  if (mode !== undefined) {
    if (!["agent", "human"].includes(mode)) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
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

  // Send via WhatsApp
  await sendWhatsAppMessage(conversation.phone, message);

  // Store in messages
  const { data: msg, error: msgError } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: id,
      role: "assistant",
      content: message,
    })
    .select()
    .single();

  if (msgError) {
    return NextResponse.json({ error: msgError.message }, { status: 500 });
  }

  return NextResponse.json(msg);
}
