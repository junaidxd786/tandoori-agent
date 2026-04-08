export async function sendWhatsAppMessage(to: string, body: string) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  const res = await fetch(
    `https://graph.facebook.com/v22.0/${phoneId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    }
  );

  const data = await res.json();

  if (!res.ok) {
    if (data.error?.code === 131030) {
      console.warn("\n\x1b[33m⚠️  WHATSAPP DEVELOPER TIP:\x1b[0m");
      console.warn("Error 131030: The phone number you are trying to message isn't in your Meta 'Allowed List'.");
      console.warn("Go to your Meta App Dashboard -> WhatsApp -> API Setup -> Add phone number to your recipient list.\n");
    } else {
      console.error("WhatsApp send failed:", JSON.stringify(data));
    }
  }

  return data;
}

export const STATUS_MESSAGES: Record<string, string> = {
  preparing: "👨‍🍳 Your order is being prepared! Sit tight, it won't be long. 😊",
  out_for_delivery:
    "🛵 Your order is on its way! It'll be with you shortly.",
  delivered:
    `✅ Your order has been delivered! Thank you for choosing ${process.env.NEXT_PUBLIC_APP_NAME || "us"} 🍗❤️`,
  cancelled:
    `❌ Your order has been cancelled. For any queries, please call: ${process.env.NEXT_PUBLIC_APP_PHONE_DELIVERY || "our support line"}.`,
};

export async function notifyCustomer(
  phone: string,
  status: string,
  conversationId?: string
) {
  const message = STATUS_MESSAGES[status];
  if (!message) return;

  // 1. Send WhatsApp message
  await sendWhatsAppMessage(phone, message);

  // 2. Persist to messages table so the dashboard conversation tab shows it
  if (conversationId) {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    const { error } = await supabaseAdmin.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: message,
    });
    if (error) console.error("[notifyCustomer] Failed to persist status message:", error);
  }
}
