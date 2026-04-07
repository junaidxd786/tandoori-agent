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
  preparing: "👨‍🍳 Aapka order prepare ho raha hai! Thoda wait karein.",
  out_for_delivery:
    "🛵 Aapka order raste mein hai! Thodi der mein pahunch jaye ga.",
  delivered:
    "✅ Aapka order deliver ho gaya! Shukriya Tandoori choose karne ka 🍗❤️",
  cancelled:
    "❌ Aapka order cancel ho gaya. Kisi masle ke liye call karein: 0341-1007722",
};

export async function notifyCustomer(phone: string, status: string) {
  const message = STATUS_MESSAGES[status];
  if (message) {
    await sendWhatsAppMessage(phone, message);
  }
}
