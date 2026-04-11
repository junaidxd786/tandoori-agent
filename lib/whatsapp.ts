type WhatsAppSendResult = {
  messageId: string | null;
  raw: unknown;
};

export type WhatsAppInteractiveListRow = {
  id: string;
  title: string;
  description?: string;
};

export type WhatsAppInteractiveListPayload = {
  body: string;
  buttonText: string;
  sectionTitle?: string;
  rows: WhatsAppInteractiveListRow[];
};

export type WhatsAppFlowAction = "navigate" | "data_exchange";

export type WhatsAppInteractiveFlowPayload = {
  body: string;
  ctaText: string;
  flowId?: string;
  flowName?: string;
  flowToken?: string;
  mode?: "draft" | "published";
  action?: WhatsAppFlowAction;
  actionPayload?: {
    screen?: string;
    data?: Record<string, unknown>;
  };
  headerText?: string;
  footerText?: string;
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

export async function sendWhatsAppInteractiveList(
  to: string,
  payload: WhatsAppInteractiveListPayload,
): Promise<WhatsAppSendResult> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneId || !token) {
    throw new Error("WhatsApp credentials are missing.");
  }

  if (!payload.rows || payload.rows.length === 0) {
    throw new Error("Interactive list requires at least one row.");
  }

  const rows = payload.rows.slice(0, 10).map((row) => ({
    id: String(row.id).slice(0, 200),
    title: String(row.title).slice(0, 24),
    ...(row.description ? { description: String(row.description).slice(0, 72) } : {}),
  }));

  const body = payload.body.slice(0, 1024);
  const buttonText = payload.buttonText.slice(0, 20);
  const sectionTitle = (payload.sectionTitle || "Options").slice(0, 24);

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
          type: "interactive",
          interactive: {
            type: "list",
            body: { text: body },
            action: {
              button: buttonText,
              sections: [
                {
                  title: sectionTitle,
                  rows,
                },
              ],
            },
          },
        }),
      });

      const data = (await response.json()) as {
        error?: { code?: number; message?: string };
        messages?: Array<{ id?: string }>;
      };

      if (!response.ok) {
        const errorMessage = data.error?.message || `WhatsApp interactive send failed with status ${response.status}`;
        const error = new Error(errorMessage);
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
      lastError = error instanceof Error ? error : new Error("Unknown WhatsApp interactive send failure");
      if (attempt < 3) {
        await sleep(attempt * 400);
        continue;
      }
    }
  }

  throw lastError ?? new Error("WhatsApp interactive send failed.");
}

export async function sendWhatsAppInteractiveFlow(
  to: string,
  payload: WhatsAppInteractiveFlowPayload,
): Promise<WhatsAppSendResult> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneId || !token) {
    throw new Error("WhatsApp credentials are missing.");
  }

  if (!payload.flowId && !payload.flowName) {
    throw new Error("Flow message requires flowId or flowName.");
  }

  const resolvedAction: WhatsAppFlowAction =
    payload.action ?? (payload.actionPayload ? "navigate" : "navigate");
  const flowToken = payload.flowToken?.trim() || "unused";
  const bodyText = payload.body.slice(0, 1024);
  const ctaText = payload.ctaText.slice(0, 30);
  const mode = payload.mode ?? "published";
  const headerText = payload.headerText?.trim().slice(0, 60);
  const footerText = payload.footerText?.trim().slice(0, 60);

  const flowActionPayload =
    resolvedAction === "navigate"
      ? {
          ...(payload.actionPayload?.screen ? { screen: payload.actionPayload.screen } : {}),
          ...(payload.actionPayload?.data ? { data: payload.actionPayload.data } : {}),
        }
      : undefined;

  const actionParameters: Record<string, unknown> = {
    flow_message_version: "3",
    flow_token: flowToken,
    flow_cta: ctaText,
    mode,
    flow_action: resolvedAction,
    ...(payload.flowId ? { flow_id: payload.flowId } : {}),
    ...(payload.flowId ? {} : payload.flowName ? { flow_name: payload.flowName } : {}),
    ...(flowActionPayload &&
    ((flowActionPayload.screen && flowActionPayload.screen.trim()) || flowActionPayload.data)
      ? { flow_action_payload: flowActionPayload }
      : {}),
  };

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
          type: "interactive",
          interactive: {
            type: "flow",
            ...(headerText ? { header: { type: "text", text: headerText } } : {}),
            body: { text: bodyText },
            ...(footerText ? { footer: { text: footerText } } : {}),
            action: {
              name: "flow",
              parameters: actionParameters,
            },
          },
        }),
      });

      const data = (await response.json()) as {
        error?: { code?: number; message?: string };
        messages?: Array<{ id?: string }>;
      };

      if (!response.ok) {
        const errorMessage = data.error?.message || `WhatsApp Flow send failed with status ${response.status}`;
        const error = new Error(errorMessage);
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
      lastError = error instanceof Error ? error : new Error("Unknown WhatsApp Flow send failure");
      if (attempt < 3) {
        await sleep(attempt * 400);
        continue;
      }
    }
  }

  throw lastError ?? new Error("WhatsApp Flow send failed.");
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
