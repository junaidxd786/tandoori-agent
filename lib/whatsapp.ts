type WhatsAppSendResult = {
  messageId: string | null;
  raw: unknown;
};

const STATUS_MESSAGES: Record<string, string> = {
  preparing: "Your order is being prepared. It will be ready soon.",
  out_for_delivery: "Your order is on the way and should reach you shortly.",
  delivered: `Your order has been delivered. Thank you for choosing ${process.env.NEXT_PUBLIC_APP_NAME || "us"}.`,
  cancelled: `Your order has been cancelled. For help, please call ${process.env.NEXT_PUBLIC_APP_PHONE_DELIVERY || "our support line"}.`,
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function sendWhatsAppMessage(to: string, body: string): Promise<WhatsAppSendResult> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneId || !token) {
    throw new Error("WhatsApp credentials are missing.");
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`https://graph.facebook.com/v22.0/${phoneId}/messages`, {
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
      });

      const data = (await response.json()) as {
        error?: { code?: number; message?: string };
        messages?: Array<{ id?: string }>;
      };

      if (!response.ok) {
        const errorMessage = data.error?.message || `WhatsApp send failed with status ${response.status}`;
        const error = new Error(errorMessage);
        if (data.error?.code === 131030) {
          console.warn("WhatsApp recipient is not in the allowed list.");
        }

        if (attempt < 3 && isRetriableStatus(response.status)) {
          lastError = error;
          await sleep(attempt * 400);
          continue;
        }

        throw error;
      }

      return {
        messageId: data.messages?.[0]?.id ?? null,
        raw: data,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown WhatsApp send failure");
      if (attempt < 3) {
        await sleep(attempt * 400);
        continue;
      }
    }
  }

  throw lastError ?? new Error("WhatsApp send failed.");
}

export async function notifyCustomer(phone: string, status: string, conversationId?: string) {
  const message = STATUS_MESSAGES[status];
  if (!message) return;

  await sendWhatsAppMessage(phone, message);

  if (conversationId) {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    const { error } = await supabaseAdmin.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: message,
    });

    if (error) {
      console.error("[notifyCustomer] Failed to persist status message:", error);
    }
  }
}
