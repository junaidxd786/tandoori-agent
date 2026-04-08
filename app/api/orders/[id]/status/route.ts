import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { notifyCustomer } from "@/lib/whatsapp";

const VALID_STATUSES = [
  "received",
  "preparing",
  "out_for_delivery",
  "delivered",
  "cancelled",
];

// PATCH /api/orders/[id]/status
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { status } = body;

  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  // Update order status
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(`*, conversations (phone, name)`)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 500 });
  }

  // Notify customer via WhatsApp and persist to conversation history
  const phone = (order as any).conversations?.phone;
  const conversationId = (order as any).conversation_id;
  if (phone) {
    await notifyCustomer(phone, status, conversationId).catch((e) =>
      console.error("Notify customer error:", e)
    );
  }

  return NextResponse.json(order);
}
