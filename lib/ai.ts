import OpenAI from "openai";
import type { BranchSummary } from "./branches";
import type { LanguagePreference, MenuCatalogItem, OrderType, WorkflowStep } from "./order-engine";
import type { RestaurantSettings } from "./settings";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "dummy_key_to_prevent_build_crash",
});

export type OrderTurnIntent =
  | "greeting"
  | "add_items"
  | "remove_items"
  | "set_order_type"
  | "provide_address"
  | "provide_dine_in_details"
  | "confirm_order"
  | "modify_order"
  | "browse_menu"
  | "category_question"
  | "payment_question"
  | "eta_question"
  | "order_status_question"
  | "cancel_order"
  | "restart_order"
  | "continue_order"
  | "chitchat"
  | "unknown";

export interface ParsedTurnItem {
  name: string;
  qty: number;
}

export interface ParsedTurnRemoval {
  name: string;
  qty: number | "all";
}

export interface OrderTurnInterpretation {
  intent: OrderTurnIntent;
  confidence: number;
  language: LanguagePreference;
  add_items: ParsedTurnItem[];
  remove_items: ParsedTurnRemoval[];
  unknown_items: string[];
  order_type: OrderType | null;
  address: string | null;
  guests: number | null;
  reservation_time: string | null;
  category_query: string | null;
  asks_menu: boolean;
  asks_payment: boolean;
  asks_eta: boolean;
  asks_status: boolean;
  wants_confirmation: boolean | null;
  wants_restart: boolean;
  wants_continue: boolean;
  notes: string | null;
}

export interface OrderTurnInterpretationInput {
  messageText: string;
  workflowStep: WorkflowStep;
  preferredLanguage: LanguagePreference;
  cart: Array<{ name: string; qty: number }>;
  menuItems: MenuCatalogItem[];
  isOpenNow: boolean;
}

const DEFAULT_INTERPRETATION: OrderTurnInterpretation = {
  intent: "unknown",
  confidence: 0,
  language: "english",
  add_items: [],
  remove_items: [],
  unknown_items: [],
  order_type: null,
  address: null,
  guests: null,
  reservation_time: null,
  category_query: null,
  asks_menu: false,
  asks_payment: false,
  asks_eta: false,
  asks_status: false,
  wants_confirmation: null,
  wants_restart: false,
  wants_continue: false,
  notes: null,
};

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
    "You are a support fallback only. The backend owns checkout state and order placement.",
    "Keep replies short, warm, and plain-text WhatsApp friendly (1-4 lines).",
    languageInstruction,
    "You may help with menu questions, item descriptions, restaurant info, delivery ETA, and payment questions.",
    "When LIVE MENU is provided, treat it as the single source of truth for item availability and prices.",
    "Handle spelling mistakes and partial item names by matching approximately to LIVE MENU items before responding.",
    "Never say an item is unavailable unless it is clearly absent from LIVE MENU after checking close spellings and spacing variants.",
    "If unsure about an item, ask a short clarification with up to 3 closest LIVE MENU options.",
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

function buildOrderInterpreterPrompt(input: OrderTurnInterpretationInput): string {
  const menuLines = input.menuItems
    .filter((item) => item.is_available)
    .slice(0, 250)
    .map((item) => `${item.name} | ${item.category ?? "General"} | ${item.price}`)
    .join("\n");
  const cartLines = input.cart.length > 0 ? input.cart.map((item) => `${item.name} x${item.qty}`).join(", ") : "empty";

  return [
    "You are an order intent parser for a WhatsApp restaurant assistant.",
    "Return strict JSON only. Never return markdown or prose.",
    "You must not hallucinate menu item names. Use only menu names from MENU_CATALOG for add_items/remove_items.",
    "If customer asks for an item not confidently in menu, put it in unknown_items and keep add_items empty for that item.",
    "Do not infer delivery address unless the message clearly includes one.",
    "Do not set guests/reservation_time unless clearly provided.",
    "intent must be one of:",
    "greeting,add_items,remove_items,set_order_type,provide_address,provide_dine_in_details,confirm_order,modify_order,browse_menu,category_question,payment_question,eta_question,order_status_question,cancel_order,restart_order,continue_order,chitchat,unknown",
    "Schema:",
    "{",
    '  "intent": "unknown",',
    '  "confidence": 0.0,',
    '  "language": "english|roman_urdu",',
    '  "add_items": [{"name":"", "qty":1}],',
    '  "remove_items": [{"name":"", "qty":1|"all"}],',
    '  "unknown_items": [""],',
    '  "order_type": "delivery|dine-in|null",',
    '  "address": "string|null",',
    '  "guests": 1,',
    '  "reservation_time": "string|null",',
    '  "category_query": "string|null",',
    '  "asks_menu": true,',
    '  "asks_payment": true,',
    '  "asks_eta": true,',
    '  "asks_status": true,',
    '  "wants_confirmation": true|false|null,',
    '  "wants_restart": true|false,',
    '  "wants_continue": true|false,',
    '  "notes": "brief reasoning" ',
    "}",
    `CONTEXT_WORKFLOW_STEP: ${input.workflowStep}`,
    `CONTEXT_LANGUAGE: ${input.preferredLanguage}`,
    `CONTEXT_CART: ${cartLines}`,
    `CONTEXT_OPEN_NOW: ${input.isOpenNow ? "true" : "false"}`,
    "MENU_CATALOG:",
    menuLines || "(no items)",
  ].join("\n");
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function clampConfidence(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

function normalizeLanguage(value: unknown, fallback: LanguagePreference): LanguagePreference {
  if (value === "roman_urdu") return "roman_urdu";
  if (value === "english") return "english";
  return fallback;
}

function normalizeIntent(value: unknown): OrderTurnIntent {
  const allowed: OrderTurnIntent[] = [
    "greeting",
    "add_items",
    "remove_items",
    "set_order_type",
    "provide_address",
    "provide_dine_in_details",
    "confirm_order",
    "modify_order",
    "browse_menu",
    "category_question",
    "payment_question",
    "eta_question",
    "order_status_question",
    "cancel_order",
    "restart_order",
    "continue_order",
    "chitchat",
    "unknown",
  ];
  return allowed.includes(value as OrderTurnIntent) ? (value as OrderTurnIntent) : "unknown";
}

function normalizeItems(value: unknown): ParsedTurnItem[] {
  if (!Array.isArray(value)) return [];
  const items: ParsedTurnItem[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const name = String((entry as Record<string, unknown>).name ?? "").trim();
    const qtyValue = Number((entry as Record<string, unknown>).qty ?? 1);
    const qty = Number.isFinite(qtyValue) && qtyValue > 0 ? Math.min(Math.floor(qtyValue), 50) : 1;
    if (!name) continue;
    items.push({ name, qty });
  }

  return items;
}

function normalizeRemovals(value: unknown): ParsedTurnRemoval[] {
  if (!Array.isArray(value)) return [];
  const removals: ParsedTurnRemoval[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const name = String((entry as Record<string, unknown>).name ?? "").trim();
    const rawQty = (entry as Record<string, unknown>).qty;
    const qty =
      rawQty === "all"
        ? "all"
        : Number.isFinite(Number(rawQty)) && Number(rawQty) > 0
          ? Math.min(Math.floor(Number(rawQty)), 50)
          : 1;
    if (!name) continue;
    removals.push({ name, qty });
  }

  return removals;
}

function normalizeUnknownItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 5);
}

function normalizeOrderType(value: unknown): OrderType | null {
  if (value === "delivery" || value === "dine-in") return value;
  return null;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.min(Math.floor(numeric), 50);
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeBooleanOrNull(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function toInterpretation(raw: Record<string, unknown>, fallbackLanguage: LanguagePreference): OrderTurnInterpretation {
  return {
    intent: normalizeIntent(raw.intent),
    confidence: clampConfidence(raw.confidence),
    language: normalizeLanguage(raw.language, fallbackLanguage),
    add_items: normalizeItems(raw.add_items),
    remove_items: normalizeRemovals(raw.remove_items),
    unknown_items: normalizeUnknownItems(raw.unknown_items),
    order_type: normalizeOrderType(raw.order_type),
    address: normalizeOptionalString(raw.address),
    guests: normalizeOptionalNumber(raw.guests),
    reservation_time: normalizeOptionalString(raw.reservation_time),
    category_query: normalizeOptionalString(raw.category_query),
    asks_menu: normalizeBoolean(raw.asks_menu),
    asks_payment: normalizeBoolean(raw.asks_payment),
    asks_eta: normalizeBoolean(raw.asks_eta),
    asks_status: normalizeBoolean(raw.asks_status),
    wants_confirmation: normalizeBooleanOrNull(raw.wants_confirmation),
    wants_restart: normalizeBoolean(raw.wants_restart),
    wants_continue: normalizeBoolean(raw.wants_continue),
    notes: normalizeOptionalString(raw.notes),
  };
}

export async function getOrderTurnInterpretation(
  input: OrderTurnInterpretationInput,
): Promise<OrderTurnInterpretation> {
  try {
    const completion = await client.chat.completions.create({
      model: process.env.ORDER_AGENT_NLU_MODEL || "openrouter/auto",
      temperature: 0.1,
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildOrderInterpreterPrompt(input),
        },
        {
          role: "user",
          content: input.messageText,
        },
      ],
    });

    const rawContent = completion.choices[0]?.message?.content ?? "{}";
    const parsed = parseJsonObject(rawContent);
    if (!parsed) {
      return {
        ...DEFAULT_INTERPRETATION,
        language: input.preferredLanguage,
      };
    }

    return toInterpretation(parsed, input.preferredLanguage);
  } catch (error) {
    console.error("[ai] NLU parser failed:", error);
    return {
      ...DEFAULT_INTERPRETATION,
      language: input.preferredLanguage,
    };
  }
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
