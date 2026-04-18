import { OutboundMessageError, sendAndPersistOutboundFlowMessage, sendAndPersistOutboundInteractiveMessage, sendAndPersistOutboundMessage } from "./messages";
import type { WhatsAppInteractiveFlowPayload, WhatsAppInteractiveListPayload } from "./whatsapp";

export async function sendAndPersistAssistantMessage({
  conversationId,
  phone,
  content,
  interactiveList,
  flowMessage,
}: {
  conversationId: string;
  phone: string;
  content: string;
  interactiveList?: WhatsAppInteractiveListPayload | null;
  flowMessage?: WhatsAppInteractiveFlowPayload | null;
}) {
  if (flowMessage) {
    const flowVisibleBody = flowMessage.body?.trim();
    const flowPersistedContent = flowVisibleBody && flowVisibleBody.length > 0 ? flowVisibleBody : content;
    try {
      await sendAndPersistOutboundFlowMessage({
        conversationId,
        phone,
        content: flowPersistedContent,
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
    const interactiveVisibleBody = interactiveList.body?.trim();
    const interactivePersistedContent =
      interactiveVisibleBody && interactiveVisibleBody.length > 0 ? interactiveVisibleBody : content;
    try {
      await sendAndPersistOutboundInteractiveMessage({
        conversationId,
        phone,
        content: interactivePersistedContent,
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
