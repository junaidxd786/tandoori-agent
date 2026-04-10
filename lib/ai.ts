import OpenAI from "openai";
import type { BranchSummary } from "./branches";
import type { LanguagePreference } from "./order-engine";
import type { RestaurantSettings } from "./settings";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "dummy_key_to_prevent_build_crash",
});

function buildSupportPrompt(
  branch: BranchSummary,
  settings: RestaurantSettings,
  isOpenNow: boolean,
  hasHistory: boolean,
  preferredLanguage: LanguagePreference,
): string {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "Restaurant";
  const city = settings.city?.trim() || "";
  const phone = settings.phone_delivery?.trim() || "our support line";
  const aiPersonality = settings.ai_personality?.trim() || "Warm & Professional";
  const languageInstruction =
    preferredLanguage === "roman_urdu"
      ? "Reply only in natural Roman Urdu written in English letters. Do not switch to formal Urdu script or English unless the menu item name itself is English."
      : "Reply only in natural English. Do not switch to Roman Urdu.";

  return [
    `You are the official WhatsApp assistant for ${appName}${city ? ` in ${city}` : ""}.`,
    `Selected branch: ${branch.name}.`,
    `Brand voice: ${aiPersonality}.`,
    `Restaurant status: ${isOpenNow ? "OPEN" : "CLOSED"}.`,
    `Hours: ${settings.opening_time} to ${settings.closing_time}.`,
    `Branch address: ${branch.address}.`,
    `Support phone: ${phone}.`,
    "Keep replies short, warm, and plain-text WhatsApp friendly.",
    languageInstruction,
    "You may help with menu questions, item descriptions, restaurant info, delivery ETA, and payment questions.",
    "If the customer is vague, such as saying only 'chicken' or 'soup', ask a short clarifying question instead of guessing.",
    "Never place an order, never claim an order was placed, and never skip required order steps. The backend owns order state.",
    "Never ask for the customer's name or phone number.",
    "Do not collect delivery address details unless the immediately previous assistant message explicitly asked for the address and the customer is clearly replying with an address.",
    "If the customer sounds like they want to place or modify an order but the item is unclear, ask only a short item clarification. Do not simulate checkout or order confirmation.",
    "If the restaurant status is CLOSED, or orders are disabled, say that orders cannot be taken right now and do not advance any order flow.",
    "Never invent items or prices that are not in the injected live menu.",
    hasHistory
      ? "Do not greet again unless the customer greets first."
      : "If the message is only a greeting, greet briefly and ask how you can help.",
  ].join("\n");
}

export async function getCustomerSupportReply(
  history: Array<{ role: string; content: string }>,
  currentMenu: string | null,
  isOpenNow: boolean,
  hasHistory: boolean,
  settings: RestaurantSettings,
  preferredLanguage: LanguagePreference,
  branch: BranchSummary,
): Promise<string> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: buildSupportPrompt(branch, settings, isOpenNow, hasHistory, preferredLanguage),
    },
  ];

  if (currentMenu) {
    messages.push({
      role: "system",
      content: `LIVE MENU\n${currentMenu}\nUse only these items and prices.`,
    });
  }

  for (const message of history.slice(-20)) {
    if (message.role === "user" || message.role === "assistant") {
      messages.push({
        role: message.role,
        content: message.content,
      });
    }
  }

  const completion = await client.chat.completions.create({
    model: "openrouter/auto",
    max_tokens: 400,
    messages,
  });

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    if (preferredLanguage === "roman_urdu") {
      return isOpenNow
        ? "Main menu, prices aur order mein help kar sakta hoon. Batayein aap ko kya chahiye."
        : "Hum is waqt closed hain, lekin main menu ke bare mein help kar sakta hoon.";
    }

    return isOpenNow
      ? "I can help with the menu, prices, and your order. Tell me what you'd like."
      : "We are currently closed, but I can still help with menu questions.";
  }

  return content;
}

export async function processMenuImage(imageUrl: string) {
  const completion = await client.chat.completions.create({
    model: "google/gemini-2.0-flash-001",
    max_tokens: 8000,
    messages: [
      {
        role: "system",
        content: `You are a professional menu digitizer for ${process.env.NEXT_PUBLIC_APP_NAME || "the restaurant"}.

Extract every menu item visible in this image.

Rules:
1. Strip numbering from the item name.
2. Keep portion or size details when present.
3. Preserve the visible category heading when possible.
4. Return price as a plain number with no currency symbol.
5. If price is unreadable, return null. Never guess.
6. Return JSON only in this shape: { "items": [ { "name": "...", "price": 850, "category": "..." } ] }`,
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Parse this menu image into JSON." },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { items?: unknown[] } | unknown[];
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.items)) return parsed.items;

  const fallbackArray = Object.values(parsed).find((value) => Array.isArray(value));
  if (Array.isArray(fallbackArray)) return fallbackArray;

  throw new Error("The AI returned an unexpected menu format.");
}
