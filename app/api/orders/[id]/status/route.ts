import { NextRequest, NextResponse } from "next/server";
import { sendAndPersistOutboundMessage } from "@/lib/messages";
import { supabaseAdmin } from "@/lib/supabase-admin";

const VALID_STATUSES = [
  "received",
  "preparing",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;

type OrderStatus = (typeof VALID_STATUSES)[number];
type StatusPatchBody = { status?: OrderStatus; assigned_to?: string | null };
type OrderWithConversation = {
  status: OrderStatus;
  type: "delivery" | "dine-in";
  conversation_id: string;
  assigned_to?: string | null;
  conversations?: { phone?: string | null; name?: string | null } | null;
};

const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  received: ["preparing", "cancelled"],
  preparing: ["out_for_delivery", "delivered", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

const STATUS_MESSAGES: Record<Exclude<OrderStatus, "received">, string> = {
  preparing: "Your order is being prepared. It will be ready soon.",
  out_for_delivery: "Your order is on the way and should reach you shortly.",
  delivered: `Your order has been delivered. Thank you for choosing ${process.env.NEXT_PUBLIC_APP_NAME || "us"}.`,
  cancelled: `Your order has been cancelled. For help, please call ${process.env.NEXT_PUBLIC_APP_PHONE_DELIVERY || "our support line"}.`,
};

function normalizeAssignee(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

// PATCH /api/orders/[id]/status
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as StatusPatchBody;
  const { status } = body;
  const assignedTo = normalizeAssignee(body.assigned_to);

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  if (status === undefined && body.assigned_to === undefined) {
    return NextResponse.json({ error: "No changes requested" }, { status: 400 });
  }

  const { data: existingOrder, error: existingError } = await supabaseAdmin
    .from("orders")
    .select(`status, type, conversation_id, assigned_to, conversations (phone, name)`)
    .eq("id", id)
    .single();

  if (existingError || !existingOrder) {
    return NextResponse.json({ error: existingError?.message ?? "Order not found" }, { status: 404 });
  }

  const typedExistingOrder = existingOrder as OrderWithConversation;
  if (status && typedExistingOrder.status !== status && !STATUS_TRANSITIONS[typedExistingOrder.status].includes(status)) {
    return NextResponse.json(
      { error: `Cannot move an order from ${typedExistingOrder.status} to ${status}.` },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (status !== undefined) updates.status = status;
  if (body.assigned_to !== undefined) updates.assigned_to = assignedTo;

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .update(updates)
    .eq("id", id)
    .select(`*, conversations (phone, name)`)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 500 });
  }

  const typedOrder = order as OrderWithConversation;
  const phone = typedOrder.conversations?.phone ?? null;
  const conversationId = typedOrder.conversation_id;
  const statusChanged = status !== undefined && status !== typedExistingOrder.status;
  if (statusChanged && status && status in STATUS_MESSAGES) {
    const notificationMessage = STATUS_MESSAGES[status as keyof typeof STATUS_MESSAGES];
    if (phone) {
      try {
        await sendAndPersistOutboundMessage({
          conversationId,
          phone,
          content: notificationMessage,
          senderKind: "system",
        });

        await supabaseAdmin
          .from("orders")
          .update({
            status_notified_at: new Date().toISOString(),
            status_notification_status: "sent",
            status_notification_error: null,
          })
          .eq("id", id);
      } catch (notifyError) {
        await supabaseAdmin
          .from("orders")
          .update({
            status_notification_status: "failed",
            status_notification_error: notifyError instanceof Error ? notifyError.message : "Unknown notification error",
          })
          .eq("id", id);
      }
    } else {
      await supabaseAdmin
        .from("orders")
        .update({
          status_notification_status: "skipped",
          status_notification_error: "Customer phone was unavailable for notification.",
        })
        .eq("id", id);
    }
  }

  return NextResponse.json(order);
}
