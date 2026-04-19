import { getOrderTurnInterpretation, type OrderTurnInterpretation } from "./ai";
import { handleAwaitingConfirmationFlow, handleLogisticsAndFallbackFlow } from "./order-flow-handlers";
import { buildCategoryListReply, parseCategoryMorePage } from "./order-menu-categories";
import {
  buildAmbiguousItemReply,
  buildCategoryItemsReply,
  buildItemMatchesReply,
  findCategoryRequest,
} from "./order-menu-replies";
import type { SemanticMenuMatch } from "./semantic-menu";
import {
  extractAnyQuantity,
  extractQuantityNearPhrase,
  getGreetingReply,
  isSimpleAcknowledgmentPattern,
  isSimpleGreetingPattern,
  parseAddress,
  parseGuestCount,
  parseReservationTime,
} from "./order-input-parsers";
import { itemSimilarityScore, normalizeCompact, normalizeText, tokenOverlapScore, tokenizeForMenuMatching } from "./order-text-utils";
import { type RestaurantSettings } from "./settings";
import { supabaseAdmin } from "./supabase-admin";
import type { UserSession } from "./user-session";

export type MessageType =
  | "greeting"
  | "acknowledgment"
  | "status_request"
  | "menu_related"
  | "complex";

export function detectMessageType(normalizedText: string): MessageType {
  // Status requests
  if (/\b(where|status|track|location|ready|prepared|delivered|arrived|time|eta|when)\b.*\b(order|food|delivery)\b/i.test(normalizedText) ||
      /\b(order|food|delivery)\b.*\b(where|status|track|location|ready|prepared|delivered|arrived|time|eta|when)\b/i.test(normalizedText)) {
    return "status_request";
  }

  // Menu related - checked before greetings so mixed messages like "hi menu"
  // still hydrate menu data and don't get downgraded to greeting-only.
  const hasMenuSignal =
      /\b(menu|item|dish|food|drink|beverage|price|cost|available|category|biryani|karahi|bbq|burger|pizza|roll|fries)\b/i.test(normalizedText) ||
      /\d+\s*(piece|pcs|kg|g|liter|l|ml|cup|plate|bowl)/i.test(normalizedText);
  if (hasMenuSignal) {
    return "menu_related";
  }

  // Greetings
  if (/\b(assalam|aoa|salam|hello|hi|hey|good\s+(morning|afternoon|evening)|namaste|namaskar)\b/i.test(normalizedText)) {
    return "greeting";
  }

  // Acknowledgments
  if (/\b(ok|okay|yes|no|thanks|thank\s+you|shukriya|theek|fine|good|alright|sure|haan|na|nahi)\b/i.test(normalizedText) &&
      normalizedText.split(" ").length <= 3) {
    return "acknowledgment";
  }

  return "complex";
}

export async function getRecentOrderContext(conversationId: string): Promise<RecentOrderContext | null> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, status, type, created_at, cancelled_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    order_number: data.order_number,
    status: data.status,
    type: data.type,
    created_at: data.created_at,
    cancelled_at: data.cancelled_at ?? null,
  };
}

function getOrderStatusMessage(order: RecentOrderContext, prefersRomanUrdu: boolean): string {
  const statusMessages: Record<OrderStatus, string> = {
    received: prefersRomanUrdu ? "aap ka order receive ho gaya hai" : "your order has been received",
    preparing: prefersRomanUrdu ? "aap ka order taiyar ho raha hai" : "your order is being prepared",
    out_for_delivery: prefersRomanUrdu ? "aap ka order delivery ke liye nikal gaya hai" : "your order is out for delivery",
    delivered: prefersRomanUrdu ? "aap ka order deliver ho gaya hai" : "your order has been delivered",
    cancelled: prefersRomanUrdu ? "aap ka order cancel ho gaya hai" : "your order has been cancelled",
  };

  const statusMsg = statusMessages[order.status as OrderStatus] || (prefersRomanUrdu ? "order ki status update hai" : "order status has been updated");

  if (prefersRomanUrdu) {
    return `Aap ke order #${order.order_number} ka status: ${statusMsg}.`;
  } else {
    return `Your order #${order.order_number} status: ${statusMsg}.`;
  }
}

export type OrderStatus = "received" | "preparing" | "out_for_delivery" | "delivered" | "cancelled";

export type WorkflowStep =
  | "idle"
  | "awaiting_branch_selection"
  | "collecting_items"
  | "awaiting_upsell_reply"
  | "awaiting_order_type"
  | "awaiting_delivery_address"
  | "awaiting_dine_in_details"
  | "awaiting_confirmation"
  | "awaiting_resume_decision";

export type OrderType = "delivery" | "dine-in";
export type LanguagePreference = "english" | "roman_urdu";

export interface MenuCatalogItem {
  id: string;
  name: string;
  price: number;
  category: string | null;
  is_available: boolean;
}

export interface DraftCartItem {
  name: string;
  price: number;
  qty: number;
  category: string | null;
  size: string | null;
  addons: string[];
  item_instructions: string | null;
}

interface CartRemovalRequest {
  name: string;
  qty: number | "all";
}

interface CartQtyUpdate {
  name: string;
  qty: number;
}

export interface ConversationState {
  conversation_id: string;
  workflow_step: WorkflowStep;
  cart: DraftCartItem[];
  preferred_language: LanguagePreference;
  resume_workflow_step: WorkflowStep | null;
  last_presented_category: string | null;
  last_presented_at: string | null;
  last_presented_options: MenuCatalogItem[] | null;
  last_presented_options_at: string | null;
  order_type: OrderType | null;
  address: string | null;
  guests: number | null;
  reservation_time: string | null;
  customer_instructions: string | null;
  upsell_item_name: string | null;
  upsell_item_price: number | null;
  upsell_offered: boolean;
  declined_upsells: string[];
  summary_sent_at: string | null;
  last_user_whatsapp_msg_id: string | null;
  last_processed_user_message_id: string | null;
  last_processed_message_seq: number | null;
  last_processed_user_message_at: string | null;
  processing_token: string | null;
  processing_started_at: string | null;
  last_error: string | null;
}

export interface RecentOrderContext {
  id: string;
  order_number: number;
  status: string;
  type: OrderType;
  created_at: string;
  cancelled_at: string | null;
}

export interface PlaceableOrderPayload {
  items: DraftCartItem[];
  type: OrderType;
  subtotal: number;
  delivery_fee: number;
  address: string | null;
  guests: number | null;
  reservation_time: string | null;
  customer_instructions: string | null;
}

export interface TurnContext {
  messageText: string;
  state: ConversationState;
  menuItems: MenuCatalogItem[];
  semanticMatches: SemanticMenuMatch[];
  branch: {
    id: string;
    name: string;
    address: string | null;
  };
  settings: RestaurantSettings;
  isOpenNow: boolean;
  recentOrder: RecentOrderContext | null;
  session: UserSession;
}

export interface TurnTrace {
  intent: string;
  confidence: number;
  unknownItems: string[];
  sentiment?: OrderTurnInterpretation["sentiment"];
  notes: string | null;
}

export type TurnDecision =
  | {
    kind: "reply";
    reply: string;
    interactiveList?: {
      body: string;
      buttonText: string;
      sectionTitle?: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    } | null;
    statePatch: Partial<ConversationState>;
    trace?: TurnTrace;
  }
  | {
    kind: "place_order";
    reply: string;
    statePatch: Partial<ConversationState>;
    order: PlaceableOrderPayload;
    trace?: TurnTrace;
  }
  | {
    kind: "fallback";
    statePatch?: Partial<ConversationState>;
    trace?: TurnTrace;
  }
  | {
    kind: "escalate_to_human";
    reply: string;
    reason: string;
    statePatch?: Partial<ConversationState>;
    trace?: TurnTrace;
  };

type MatchedItemsResult = {
  matched: DraftCartItem[];
  unknown: string[];
  ambiguous: Array<{ query: string; options: MenuCatalogItem[] }>;
};

const YES_WORDS = [
  "yes",
  "y",
  "yeah",
  "yep",
  "haan",
  "han",
  "haan ji",
  "confirm",
  "confirmed",
  "place order",
  "done",
];

const NO_WORDS = ["no", "nah", "nahi", "nahin", "skip", "cancel", "stop"];
const RESTART_WORDS = ["restart", "start over", "new order", "fresh order", "naya order", "phir se"];
const CANCEL_WORDS = ["cancel order", "stop order", "rehne do", "forget it", "leave it"];

const MENU_LOOKUP_FILLER_WORDS = new Set([
  "show",
  "list",
  "give",
  "send",
  "tell",
  "find",
  "what",
  "which",
  "any",
  "all",
  "me",
  "us",
  "the",
  "a",
  "an",
  "do",
  "you",
  "have",
  "available",
  "option",
  "options",
  "item",
  "items",
  "menu",
  "please",
  "can",
  "could",
  "would",
  "i",
  "we",
]);
const GENERIC_FOOD_TOKENS = new Set([
  "chicken",
  "beef",
  "mutton",
  "fish",
  "burger",
  "pizza",
  "biryani",
  "karahi",
  "bbq",
  "ice",
  "cream",
  "icecream",
]);

const ORDER_CANCELLATION_WINDOW_MS = 10 * 60 * 1000;
const QUANTITY_PICK_PREFIX = "__qty_pick__:";
const QUANTITY_PICKER_CATEGORY_HINTS = [
  "dessert",
  "beverage",
  "drink",
  "cold beverage",
  "ice cream",
  "icecream",
  "soup",
  "salad",
  "fries",
  "starter",
  "appetizer",
  "sandwich",
  "burger",
  "roll",
];
const QUANTITY_PICKER_NAME_HINTS = [
  "ice cream",
  "icecream",
  "kulfi",
  "coffee",
  "cola",
  "juice",
  "water",
  "soup",
  "fries",
  "burger",
  "sandwich",
  "roll",
  "shake",
];
const QUANTITY_SKIP_NAME_HINTS = [
  "karahi",
  "handi",
  "tikka",
  "boti",
  "chargha",
  "roast",
  "bbq",
  "full",
  "half",
];
const QUANTITY_PICKER_OPTION_COUNT = 5;
const SIZE_WORDS = new Map<string, string>([
  ["small", "Small"],
  ["sm", "Small"],
  ["medium", "Medium"],
  ["med", "Medium"],
  ["md", "Medium"],
  ["large", "Large"],
  ["lg", "Large"],
]);

const PRESENTED_OPTIONS_TTL_MS = 20 * 60 * 1000;

function isShortAcknowledgment(normalizedText: string): boolean {
  const trimmed = normalizedText.trim();
  if (!trimmed) return false;
  if (trimmed.split(/\s+/).length > 3) return false;
  return /\b(ok|okay|k|thanks|thank\s*you|shukriya|theek|fine|good|alright|sure|haan|han|na|nahi)\b/i.test(trimmed);
}

const ROMAN_URDU_SIGNAL_WORDS = [
  "aoa",
  "assalam",
  "walaikum",
  "kya",
  "kia",
  "chahiye",
  "bhej",
  "haan",
  "nahin",
  "nahi",
  "kitna",
  "kitne",
  "kar do",
];

const ENGLISH_SIGNAL_WORDS = [
  "hello",
  "hi",
  "please",
  "price",
  "delivery",
  "address",
  "confirm",
  "order",
  "menu",
];

type QuantityPickerSelection =
  | { kind: "qty"; qty: number }
  | { kind: "custom" }
  | null;

export function getDefaultConversationState(conversationId: string): ConversationState {
  return {
    conversation_id: conversationId,
    workflow_step: "idle",
    cart: [],
    preferred_language: "english",
    resume_workflow_step: null,
    last_presented_category: null,
    last_presented_at: null,
    last_presented_options: null,
    last_presented_options_at: null,
    order_type: null,
    address: null,
    guests: null,
    reservation_time: null,
    customer_instructions: null,
    upsell_item_name: null,
    upsell_item_price: null,
    upsell_offered: false,
    declined_upsells: [],
    summary_sent_at: null,
    last_user_whatsapp_msg_id: null,
    last_processed_user_message_id: null,
    last_processed_message_seq: null,
    last_processed_user_message_at: null,
    processing_token: null,
    processing_started_at: null,
    last_error: null,
  };
}

export function parseConversationState(raw: Partial<ConversationState> & { conversation_id: string }): ConversationState {
  return {
    ...getDefaultConversationState(raw.conversation_id),
    ...raw,
    cart: Array.isArray(raw.cart) ? raw.cart.filter(isDraftCartItemLike) : [],
    declined_upsells: Array.isArray(raw.declined_upsells)
      ? raw.declined_upsells.filter((value): value is string => typeof value === "string")
      : [],
    last_presented_options: Array.isArray(raw.last_presented_options)
      ? raw.last_presented_options.filter(isMenuCatalogItemLike)
      : null,
    last_presented_options_at: typeof raw.last_presented_options_at === "string" ? raw.last_presented_options_at : null,
    customer_instructions: typeof raw.customer_instructions === "string" ? raw.customer_instructions : null,
  };
}

function isQuantityPickerState(state: ConversationState): boolean {
  return (
    typeof state.last_presented_category === "string" &&
    state.last_presented_category.startsWith(QUANTITY_PICK_PREFIX) &&
    Array.isArray(state.last_presented_options) &&
    state.last_presented_options.length === 1
  );
}

function getPendingQuantityPickerItem(state: ConversationState): MenuCatalogItem | null {
  if (!isQuantityPickerState(state)) return null;

  const selected = state.last_presented_options?.[0] ?? null;
  if (!selected) return null;

  const expectedId = state.last_presented_category!.slice(QUANTITY_PICK_PREFIX.length);
  if (!expectedId || expectedId === selected.id) return selected;
  return null;
}

function shouldPromptForQuantityPicker(item: MenuCatalogItem): boolean {
  const normalizedName = normalizeText(item.name);
  const normalizedCategory = normalizeText(item.category ?? "");

  if (!normalizedName) return false;

  if (QUANTITY_SKIP_NAME_HINTS.some((hint) => normalizedName.includes(normalizeText(hint)))) {
    return false;
  }

  if (QUANTITY_PICKER_NAME_HINTS.some((hint) => normalizedName.includes(normalizeText(hint)))) {
    return true;
  }

  if (!normalizedCategory) return false;
  return QUANTITY_PICKER_CATEGORY_HINTS.some((hint) => normalizedCategory.includes(normalizeText(hint)));
}

function buildQuantityPickerInteractiveList(item: MenuCatalogItem, romanUrdu: boolean): {
  body: string;
  buttonText: string;
  sectionTitle?: string;
  rows: Array<{ id: string; title: string; description?: string }>;
} {
  const rows = Array.from({ length: QUANTITY_PICKER_OPTION_COUNT }, (_, index) => {
    const qty = index + 1;
    return {
      id: `${QUANTITY_PICK_PREFIX}${qty}`,
      title: `${qty}`,
      description: `Rs. ${item.price * qty}`,
    };
  });

  rows.push({
    id: `${QUANTITY_PICK_PREFIX}custom`,
    title: romanUrdu ? "Custom quantity" : "Custom quantity",
    description: romanUrdu ? "Khud number type karein" : "Type any number",
  });

  return {
    body: romanUrdu ? `${item.name} ki quantity select karein.` : `Select quantity for ${item.name}.`,
    buttonText: romanUrdu ? "Quantity" : "Quantity",
    sectionTitle: romanUrdu ? "Quantity" : "Quantity",
    rows,
  };
}

function buildQuantityPickerReply(item: MenuCatalogItem, romanUrdu: boolean): {
  text: string;
  interactiveList: {
    body: string;
    buttonText: string;
    sectionTitle?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  };
} {
  return {
    text: romanUrdu
      ? `*${item.name}* select ho gaya. Kitni quantity chahiye?`
      : `*${item.name}* selected. How many would you like?`,
    interactiveList: buildQuantityPickerInteractiveList(item, romanUrdu),
  };
}

function parseQuantityPickerSelection(rawText: string): QuantityPickerSelection {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const prefixed = trimmed.match(/^__qty_pick__:(\d{1,2}|custom)$/i);
  if (prefixed) {
    if (prefixed[1].toLowerCase() === "custom") return { kind: "custom" };
    return { kind: "qty", qty: clampQty(Number.parseInt(prefixed[1], 10)) };
  }

  const optionFormat = trimmed.match(/^qty[_\s-]?(?:option|pick)[_\s-]?(\d{1,2})$/i);
  if (optionFormat) {
    return { kind: "qty", qty: clampQty(Number.parseInt(optionFormat[1], 10)) };
  }

  if (/^(?:qty[_\s-]?custom|custom\s*qty|quantity\s*custom|custom)$/i.test(trimmed)) {
    return { kind: "custom" };
  }

  const normalized = normalizeText(trimmed);
  const wordQuantities: Record<string, number> = {
    one: 1,
    aik: 1,
    ek: 1,
    two: 2,
    do: 2,
    three: 3,
    teen: 3,
    four: 4,
    char: 4,
    five: 5,
    paanch: 5,
  };
  if (wordQuantities[normalized] != null) {
    return { kind: "qty", qty: wordQuantities[normalized] };
  }

  const qtyMatch = normalized.match(/^(?:qty|quantity)?\s*(\d{1,2})\s*(?:x|times|pcs?|pieces?|kar do|kr do|kar dain|kr dain)?$/i);
  if (qtyMatch) {
    return { kind: "qty", qty: clampQty(Number.parseInt(qtyMatch[1], 10)) };
  }

  return null;
}

function isQuantityPickerControlInput(rawText: string): boolean {
  const trimmed = rawText.trim();
  if (!trimmed) return false;
  if (/^__qty_pick__:/i.test(trimmed)) return true;
  if (/^qty[_\s-]?(?:option|pick|custom)/i.test(trimmed)) return true;
  if (/^(?:custom\s*qty|quantity\s*custom)$/i.test(trimmed)) return true;
  if (/^\d{1,2}$/.test(trimmed)) return true;
  return false;
}

export function inferLanguagePreference(
  text: string,
  previous: LanguagePreference = "english",
): LanguagePreference {
  const normalized = normalizeText(text);
  const romanScore = scoreSignals(normalized, ROMAN_URDU_SIGNAL_WORDS);
  const englishScore = scoreSignals(normalized, ENGLISH_SIGNAL_WORDS);

  if (romanScore === 0 && englishScore === 0) return previous;
  if (romanScore >= englishScore + 1) return "roman_urdu";
  if (englishScore >= romanScore + 1) return "english";
  return previous;
}

export async function decideTurn(context: TurnContext): Promise<TurnDecision> {
  const rawText = context.messageText.trim();
  const normalizedText = normalizeText(rawText);
  const preferredLanguage = inferLanguagePreference(rawText, context.state.preferred_language);
  const prefersRomanUrdu = preferredLanguage === "roman_urdu";
  const state = context.state;
  const messageType = detectMessageType(normalizedText);
  const isWorkflowGateStep = expectsStructuredCheckoutInput(state.workflow_step);
  const canOfferFreshMenuOnGreeting =
    state.cart.length === 0 &&
    state.workflow_step === "idle" &&
    context.menuItems.length > 0;

  if (normalizedText.length === 0) {
    return replyDecision(
      prefersRomanUrdu
        ? "Baraye meharbani text message bhejain takay main order place karne mein aapki madad kar sakun."
        : "Please send a text message and I will help with your order.",
      withPreferredLanguage({}, preferredLanguage),
    );
  }

  // ULTRA-FAST PATTERN-BASED EARLY EXIT FOR SIMPLE GREETINGS - No AI call, no DB queries
  if (isSimpleGreetingPattern(rawText) && state.cart.length === 0 && state.workflow_step === "idle") {
    if (canOfferFreshMenuOnGreeting) {
      const categoryReply = buildCategoryListReply(getAvailableMenuItems(context.menuItems), prefersRomanUrdu, 1);
      const welcome = getGreetingReply(rawText, prefersRomanUrdu);
      return replyDecision(
        `${welcome}\n\n${categoryReply.text}`,
        withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            last_presented_category: "__category_list__",
            last_presented_options: null,
            last_presented_options_at: null,
          },
          preferredLanguage,
        ),
        undefined,
        categoryReply.interactiveList,
      );
    }

    return replyDecision(
      getGreetingReply(rawText, prefersRomanUrdu),
      withPreferredLanguage({}, preferredLanguage),
    );
  }

  // ULTRA-FAST PATTERN-BASED EARLY EXIT FOR SIMPLE ACKNOWLEDGMENTS
  if (isSimpleAcknowledgmentPattern(rawText) && !isWorkflowGateStep) {
    return replyDecision(
      prefersRomanUrdu
        ? "Ji theek hai, batayein main aapki mazeed kya madad kar sakta hoon?"
        : "Alright, let me know how else I can help you!",
      withPreferredLanguage({}, preferredLanguage),
    );
  }

  // EARLY EXIT FOR DETECTED GREETINGS (fallback to AI-detected greetings)
  if (messageType === "greeting" && state.cart.length === 0 && state.workflow_step === "idle") {
    if (canOfferFreshMenuOnGreeting) {
      const categoryReply = buildCategoryListReply(getAvailableMenuItems(context.menuItems), prefersRomanUrdu, 1);
      const welcome = getGreetingReply(rawText, prefersRomanUrdu);
      return replyDecision(
        `${welcome}\n\n${categoryReply.text}`,
        withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            last_presented_category: "__category_list__",
            last_presented_options: null,
            last_presented_options_at: null,
          },
          preferredLanguage,
        ),
        undefined,
        categoryReply.interactiveList,
      );
    }

    return replyDecision(
      getGreetingReply(rawText, prefersRomanUrdu),
      withPreferredLanguage({}, preferredLanguage),
    );
  }

  // EARLY EXIT FOR DETECTED ACKNOWLEDGMENTS
  if (messageType === "acknowledgment" && !isWorkflowGateStep) {
    return replyDecision(
      prefersRomanUrdu
        ? "Theek hai, bataiye main kya kar sakta hoon aap ke liye?"
        : "Alright, let me know how I can help you!",
      withPreferredLanguage({}, preferredLanguage),
    );
  }

  // EARLY EXIT FOR STATUS REQUESTS
  if (messageType === "status_request") {
    const recentOrder = context.recentOrder ?? await getRecentOrderContext(context.state.conversation_id);
    if (recentOrder) {
      const statusMessage = getOrderStatusMessage(recentOrder, prefersRomanUrdu);
      return replyDecision(statusMessage, withPreferredLanguage({}, preferredLanguage));
    }

    return replyDecision(
      prefersRomanUrdu
        ? "Aap ka koi recent order nahi mila. Naya order place karna chahenge?"
        : "I couldn't find any recent orders. Would you like to place a new order?",
      withPreferredLanguage({}, preferredLanguage),
    );
  }

  if (state.workflow_step === "awaiting_resume_decision") {
    return replyDecision(
      prefersRomanUrdu
        ? "Purana draft expire ho chuka tha, fresh start kar diya hai. Apna item bhej dein."
        : "The previous draft had expired, so I started fresh. Please send your item.",
      withPreferredLanguage(resetDraftState(), preferredLanguage),
    );
  }

  // FAST CHECKOUT SHORTCUTS: avoid NLU call for explicit structured replies.
  if (state.workflow_step === "awaiting_confirmation" && isExplicitYes(normalizedText)) {
    const validation = validateDraftForPlacement(state, context.settings);
    if (validation.ok === false) {
      return replyDecision(
        validation.reply(prefersRomanUrdu),
        withPreferredLanguage(validation.statePatch, preferredLanguage),
      );
    }

    return {
      kind: "place_order",
      reply: buildOrderPlacedReply(context.settings, prefersRomanUrdu),
      statePatch: withPreferredLanguage(
        {
          ...resetDraftState(),
          summary_sent_at: new Date().toISOString(),
        },
        preferredLanguage,
      ),
      order: validation.order,
      trace: {
        intent: "confirm_order",
        confidence: 0.99,
        unknownItems: [],
        sentiment: "neutral",
        notes: null,
      },
    };
  }

  if (state.workflow_step === "awaiting_order_type") {
    const quickOrderType = parseOrderTypeShortcut(normalizedText);
    if (quickOrderType) {
      return handleOrderTypeSelection(
        context,
        state,
        preferredLanguage,
        quickOrderType,
        {
          intent: "set_order_type",
          confidence: 0.97,
          unknownItems: [],
          sentiment: "neutral",
          notes: null,
        },
      );
    }
  }

  if (state.workflow_step === "awaiting_delivery_address") {
    const quickAddress = parseAddress(rawText);
    if (quickAddress) {
      return buildSummaryReply(
        {
          state: {
            ...state,
            preferred_language: preferredLanguage,
            address: quickAddress,
            order_type: "delivery",
          },
          settings: context.settings,
        },
        {
          intent: "provide_address",
          confidence: 0.95,
          unknownItems: [],
          sentiment: "neutral",
          notes: null,
        },
      );
    }
  }

  const pendingQtyItem = getPendingQuantityPickerItem(state);
  if (pendingQtyItem) {
    if (!isPresentedOptionsFresh(state)) {
      return replyDecision(
        prefersRomanUrdu
          ? "Quantity selection expire ho gayi. Item dubara select karein."
          : "That quantity selection expired. Please select the item again.",
        withPreferredLanguage(
          {
            last_presented_category: null,
            last_presented_options: null,
            last_presented_options_at: null,
          },
          preferredLanguage,
        ),
      );
    }

    const quantitySelection = parseQuantityPickerSelection(rawText);
    if (quantitySelection?.kind === "custom") {
      const quantityPrompt = buildQuantityPickerReply(pendingQtyItem, prefersRomanUrdu);
      return replyDecision(
        prefersRomanUrdu
          ? "Please quantity number bhej dein (1 se 50 tak)."
          : "Please send a quantity number (1 to 50).",
        withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            last_presented_category: `${QUANTITY_PICK_PREFIX}${pendingQtyItem.id}`,
            last_presented_options: [pendingQtyItem],
            last_presented_options_at: new Date().toISOString(),
          },
          preferredLanguage,
        ),
        undefined,
        quantityPrompt.interactiveList,
      );
    }

    if (quantitySelection?.kind === "qty") {
      const selectedItem: DraftCartItem = {
        name: pendingQtyItem.name,
        qty: clampQty(quantitySelection.qty),
        price: pendingQtyItem.price,
        category: pendingQtyItem.category,
        size: null,
        addons: [],
        item_instructions: null,
      };

      const nextState: ConversationState = {
        ...state,
        cart: mergeCartItems(state.cart, [selectedItem]),
        workflow_step: "collecting_items",
        preferred_language: preferredLanguage,
        last_presented_category: null,
        last_presented_options: null,
        last_presented_options_at: null,
      };

      return buildLogisticsOrSummaryReply(
        {
          state: nextState,
          settings: context.settings,
          matchedAdds: {
            matched: [selectedItem],
            unknown: [],
            ambiguous: [],
          },
          removedItemsText: "",
          menuItems: context.menuItems,
        },
        {
          intent: "set_item_quantity",
          confidence: 0.99,
          unknownItems: [],
          sentiment: "neutral",
          notes: null,
        },
      );
    }

    if (isQuantityPickerControlInput(rawText)) {
      const quantityPrompt = buildQuantityPickerReply(pendingQtyItem, prefersRomanUrdu);
      return replyDecision(
        prefersRomanUrdu
          ? "Quantity samajh nahi aayi. 1 se 50 tak number bhej dein."
          : "I couldn't read that quantity. Send a number from 1 to 50.",
        withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            last_presented_category: `${QUANTITY_PICK_PREFIX}${pendingQtyItem.id}`,
            last_presented_options: [pendingQtyItem],
            last_presented_options_at: new Date().toISOString(),
          },
          preferredLanguage,
        ),
        undefined,
        quantityPrompt.interactiveList,
      );
    }
  }

  // For complex messages, we need full AI processing with menu data
  // For menu-related messages, we can optimize by loading menu data
  // For simple messages that reach here, we still need basic processing
  const needsFullMenuData =
    messageType === "complex" ||
    messageType === "menu_related" ||
    isLikelyMenuRequest(normalizedText) ||
    context.menuItems.length > 0;
  const menuItems = needsFullMenuData ? getAvailableMenuItems(context.menuItems) : [];

  const interpretation = await getOrderTurnInterpretation({
    messageText: rawText,
    workflowStep: state.workflow_step,
    preferredLanguage,
    cart: state.cart.map((item) => ({ name: item.name, qty: item.qty })),
    menuItems,
    isOpenNow: context.isOpenNow,
    semanticMatches: messageType === "complex" ? context.semanticMatches : [], // Skip semantic matches for non-complex messages
  });
  const trace: TurnTrace = {
    intent: interpretation.intent,
    confidence: interpretation.confidence,
    unknownItems: interpretation.unknown_items,
    sentiment: interpretation.sentiment,
    notes: interpretation.notes,
  };

  const quickOrderType = parseOrderTypeShortcut(normalizedText);
  if (quickOrderType) {
    interpretation.order_type = quickOrderType;
    interpretation.intent = "set_order_type";
    interpretation.confidence = Math.max(interpretation.confidence, 0.92);
  }

  if (containsAny(normalizedText, RESTART_WORDS)) {
    interpretation.wants_restart = true;
    interpretation.intent = "restart_order";
  }
  if (containsAny(normalizedText, CANCEL_WORDS)) {
    interpretation.intent = "cancel_order";
  }

  if (
    interpretation.wants_human ||
    interpretation.sentiment === "angry" ||
    context.session.invalid_step_count >= 3 ||
    /(human|manager|agent|representative|insaan|banday se baat|staff)/i.test(rawText)
  ) {
    return {
      kind: "escalate_to_human",
      reply:
        preferredLanguage === "roman_urdu"
          ? "Main aap ko human team se connect kar raha hoon."
          : "I'm connecting you with a human team member.",
      reason:
        interpretation.wants_human || /(human|manager|agent|representative|insaan|banday se baat|staff)/i.test(rawText)
          ? "Customer requested a human handoff."
          : interpretation.sentiment === "angry"
            ? "Detected strong customer frustration."
            : "Customer is stuck in the workflow repeatedly.",
      statePatch: withPreferredLanguage({}, preferredLanguage),
      trace,
    };
  }

  if (interpretation.intent === "cancel_order" && state.workflow_step === "idle" && state.cart.length === 0) {
    const cancellation = await tryCancelRecentOrder(state.conversation_id);
    if (cancellation.result === "cancelled") {
      return replyDecision(
        prefersRomanUrdu
          ? `Theek hai, order #${cancellation.orderNumber ?? ""} cancel kar diya gaya hai.`
          : `Done, your order #${cancellation.orderNumber ?? ""} has been cancelled.`,
        withPreferredLanguage({}, preferredLanguage),
        trace,
      );
    }

    if (cancellation.result === "too_late") {
      return replyDecision(
        prefersRomanUrdu
          ? "Cancellation ka 10-minute window complete ho chuka hai. Support se rabta karein."
          : "The 10-minute cancellation window has passed. Please contact support for help.",
        withPreferredLanguage({}, preferredLanguage),
        trace,
      );
    }

    if (cancellation.result === "already_final") {
      return replyDecision(
        prefersRomanUrdu
          ? "Yeh order already final state mein hai, is liye cancel nahi ho sakta."
          : "This order is already in a final state and can no longer be cancelled.",
        withPreferredLanguage({}, preferredLanguage),
        trace,
      );
    }

    if (cancellation.result === "not_found") {
      return replyDecision(
        prefersRomanUrdu
          ? "Aap ka koi recent order nahi mila jise cancel kiya ja sake."
          : "I could not find a recent order to cancel.",
        withPreferredLanguage({}, preferredLanguage),
        trace,
      );
    }
  }

  if (state.workflow_step !== "idle" && interpretation.intent === "cancel_order") {
    return replyDecision(
      prefersRomanUrdu
        ? "Theek hai, maine current draft cancel kar diya. Naya order bhej dein."
        : "No problem, I cancelled the current draft. Send any item to start again.",
      withPreferredLanguage(resetDraftState(), preferredLanguage),
      trace,
    );
  }

  if (!context.isOpenNow && attemptsCheckoutProgression(interpretation, state, normalizedText)) {
    return replyDecision(
      buildClosedReply(context.settings, prefersRomanUrdu, state.cart.length > 0),
      withPreferredLanguage(
        state.cart.length > 0
          ? {
            workflow_step: "collecting_items",
          }
          : {},
        preferredLanguage,
      ),
      trace,
    );
  }

  if ((interpretation.asks_status || interpretation.intent === "order_status_question") && state.cart.length === 0) {
    const recentOrder = context.recentOrder ?? await getRecentOrderContext(context.state.conversation_id);
    if (recentOrder) {
      return replyDecision(
        buildOrderStatusReply(recentOrder, prefersRomanUrdu),
        withPreferredLanguage({}, preferredLanguage),
        trace,
      );
    }

    return replyDecision(
      prefersRomanUrdu
        ? "Aap ka recent order nahi mil raha. Agar naya order dena hai to item ka naam bhej dein."
        : "I could not find a recent order. If you'd like to place one, send an item name.",
      withPreferredLanguage({}, preferredLanguage),
      trace,
    );
  }

  if (interpretation.asks_payment || interpretation.intent === "payment_question") {
    const prompt = buildPaymentReply(context.settings, prefersRomanUrdu);
    return replyDecision(
      maybeAppendCheckoutPrompt(prompt, state, prefersRomanUrdu),
      withPreferredLanguage({}, preferredLanguage),
      trace,
    );
  }

  if (interpretation.asks_eta || interpretation.intent === "eta_question") {
    const prompt = prefersRomanUrdu
      ? `Delivery aam tor par confirmation ke baad 30 se 45 minutes leti hai. Helpline: ${buildHelplineValue(context.settings, state)}.`
      : `Delivery usually takes 30 to 45 minutes after confirmation. Helpline: ${buildHelplineValue(context.settings, state)}.`;
    return replyDecision(
      maybeAppendCheckoutPrompt(prompt, state, prefersRomanUrdu),
      withPreferredLanguage({}, preferredLanguage),
      trace,
    );
  }

  if (asksBranchAddress(normalizedText) && state.workflow_step !== "awaiting_delivery_address" && isLikelyQuestionMessage(rawText)) {
    const prompt = buildBranchAddressReply(context.branch, prefersRomanUrdu);
    return replyDecision(
      maybeAppendCheckoutPrompt(prompt, state, prefersRomanUrdu),
      withPreferredLanguage({}, preferredLanguage),
      trace,
    );
  }

  if (asksOpeningHours(normalizedText)) {
    const prompt = context.isOpenNow
      ? prefersRomanUrdu
        ? `Ji, restaurant abhi open hai. Timings ${context.settings.opening_time} se ${context.settings.closing_time} hain.`
        : `Yes, the restaurant is currently open. Timings are ${context.settings.opening_time} to ${context.settings.closing_time}.`
      : prefersRomanUrdu
        ? `Filhal restaurant closed hai. Timings ${context.settings.opening_time} se ${context.settings.closing_time} hain.`
        : `The restaurant is currently closed. Timings are ${context.settings.opening_time} to ${context.settings.closing_time}.`;
    return replyDecision(
      maybeAppendCheckoutPrompt(prompt, state, prefersRomanUrdu),
      withPreferredLanguage({}, preferredLanguage),
      trace,
    );
  }

  if (asksContactDetails(normalizedText)) {
    const prompt = buildBranchContactReply(context.settings, state, prefersRomanUrdu);
    return replyDecision(
      maybeAppendCheckoutPrompt(prompt, state, prefersRomanUrdu),
      withPreferredLanguage({}, preferredLanguage),
      trace,
    );
  }

  const directLookupQuery =
    interpretation.add_items.length === 0 &&
    interpretation.remove_items.length === 0 &&
    interpretation.intent !== "set_order_type" &&
    interpretation.intent !== "provide_address" &&
    interpretation.intent !== "provide_dine_in_details"
      ? extractStandaloneMenuLookupQuery(rawText, normalizedText)
      : null;
  if (directLookupQuery) {
    const category = findCategoryRequest(directLookupQuery, menuItems);
    if (category) {
      const categoryReply = buildCategoryItemsReply(category, menuItems, prefersRomanUrdu);
      return replyDecision(
        categoryReply.text,
        withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            last_presented_category: category,
            last_presented_options: categoryReply.selectableItems,
            last_presented_options_at: categoryReply.selectableItems.length > 0 ? new Date().toISOString() : null,
          },
          preferredLanguage,
        ),
        trace,
      );
    }

    const matchedMenuItems = pickMenuSuggestionsForQuery(directLookupQuery, menuItems, context.semanticMatches, 10);
    if (matchedMenuItems.length > 0) {
      return replyDecision(
        buildItemMatchesReply(directLookupQuery, matchedMenuItems, prefersRomanUrdu),
        withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            last_presented_options: matchedMenuItems,
            last_presented_options_at: new Date().toISOString(),
          },
          preferredLanguage,
        ),
        trace,
      );
    }
  }

  if (
    interpretation.asks_menu ||
    interpretation.intent === "browse_menu" ||
    isLikelyMenuRequest(normalizedText)
  ) {
    const queryHints = buildMenuQueryHints(rawText, normalizedText);
    if (queryHints.length > 0) {
      const matchedMenuItems = pickMenuSuggestionsForQuery(queryHints[0], menuItems, context.semanticMatches, 10);
      if (matchedMenuItems.length > 0) {
        return replyDecision(
          buildItemMatchesReply(queryHints[0], matchedMenuItems, prefersRomanUrdu),
          withPreferredLanguage(
            {
              workflow_step: "collecting_items",
              last_presented_options: matchedMenuItems,
              last_presented_options_at: new Date().toISOString(),
            },
            preferredLanguage,
          ),
          trace,
        );
      }
    }

    if (state.cart.length > 0 && queryHints.length > 0) {
      const unknownReply = buildUnknownItemReplyData(
        [queryHints[0]],
        context.menuItems,
        prefersRomanUrdu,
        context.semanticMatches,
      );
      if (unknownReply.selectableItems.length > 0) {
        return replyDecision(
          unknownReply.text,
          withPreferredLanguage(
            {
              workflow_step: "collecting_items",
              last_presented_options: unknownReply.selectableItems,
              last_presented_options_at: new Date().toISOString(),
            },
            preferredLanguage,
          ),
          trace,
        );
      }
    }

    const categoryReply = buildCategoryListReply(menuItems, prefersRomanUrdu);
    return replyDecision(
      categoryReply.text,
      withPreferredLanguage(
        {
          workflow_step: state.cart.length > 0 ? "collecting_items" : state.workflow_step,
          last_presented_category: "__category_list__",
          last_presented_options: null,
          last_presented_options_at: null,
        },
        preferredLanguage,
      ),
      trace,
      categoryReply.interactiveList,
    );
  }

  // Handle category interactive commands globally, even if user is currently
  // inside a category item list. This prevents payloads like
  // "category_more_2" from being misread as item option "2".
  const requestedCategoryPage = parseCategoryMorePage(rawText);
  if (requestedCategoryPage) {
    const categoryReply = buildCategoryListReply(menuItems, prefersRomanUrdu, requestedCategoryPage);
    return replyDecision(
      categoryReply.text,
      withPreferredLanguage(
        {
          workflow_step: "collecting_items",
          last_presented_category: "__category_list__",
          last_presented_options: null,
          last_presented_options_at: null,
        },
        preferredLanguage,
      ),
      trace,
      categoryReply.interactiveList,
    );
  }

  const hasCategoryOptionPayload = /^category[_\s-]?option[_\s-]?\d{1,2}$/i.test(rawText.trim());
  if (hasCategoryOptionPayload) {
    const category = findCategoryRequest(rawText, menuItems);
    if (category) {
      const categoryReply = buildCategoryItemsReply(category, menuItems, prefersRomanUrdu);
      return replyDecision(
        categoryReply.text,
        withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            last_presented_category: category,
            last_presented_options: categoryReply.selectableItems,
            last_presented_options_at: categoryReply.selectableItems.length > 0 ? new Date().toISOString() : null,
          },
          preferredLanguage,
        ),
        trace,
      );
    }
  }

  if (state.last_presented_category === "__category_list__") {
    const listRequestedPage = parseCategoryMorePage(rawText);
    if (listRequestedPage) {
      const categoryReply = buildCategoryListReply(menuItems, prefersRomanUrdu, listRequestedPage);
      return replyDecision(
        categoryReply.text,
        withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            last_presented_category: "__category_list__",
            last_presented_options: null,
            last_presented_options_at: null,
          },
          preferredLanguage,
        ),
        trace,
        categoryReply.interactiveList,
      );
    }

    if (/^(more|next|more categories)$/i.test(rawText.trim())) {
      const categoryReply = buildCategoryListReply(menuItems, prefersRomanUrdu, 2);
      return replyDecision(
        categoryReply.text,
        withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            last_presented_category: "__category_list__",
            last_presented_options: null,
            last_presented_options_at: null,
          },
          preferredLanguage,
        ),
        trace,
        categoryReply.interactiveList,
      );
    }

    const category = findCategoryRequest(normalizedText, menuItems);
    if (category) {
      const categoryReply = buildCategoryItemsReply(category, menuItems, prefersRomanUrdu);
      return replyDecision(
        categoryReply.text,
        withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            last_presented_category: category,
            last_presented_options: categoryReply.selectableItems,
            last_presented_options_at: categoryReply.selectableItems.length > 0 ? new Date().toISOString() : null,
          },
          preferredLanguage,
        ),
        trace,
      );
    }
  }

  if (interpretation.intent === "category_question" || interpretation.category_query) {
    const category = findCategoryRequest(interpretation.category_query ?? normalizedText, menuItems);
    if (category) {
      const categoryReply = buildCategoryItemsReply(category, menuItems, prefersRomanUrdu);
      return replyDecision(
        maybeAppendCheckoutPrompt(categoryReply.text, state, prefersRomanUrdu),
        withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            last_presented_category: category,
            last_presented_options: categoryReply.selectableItems,
            last_presented_options_at: categoryReply.selectableItems.length > 0 ? new Date().toISOString() : null,
          },
          preferredLanguage,
        ),
        trace,
      );
    }
  }

  // If the user greets (or sends a short ack) and there's no draft, proactively show categories.
  // Direct order messages still flow through normal parsing earlier in this function.
  if (
    (interpretation.intent === "greeting" || isShortAcknowledgment(normalizedText)) &&
    state.cart.length === 0 &&
    state.workflow_step === "idle"
  ) {
    const categoryReply = buildCategoryListReply(menuItems, prefersRomanUrdu, 1);
    const welcome = getGreetingReply(rawText, prefersRomanUrdu);
    const combined = `${welcome}\n\n${categoryReply.text}`;

    return replyDecision(
      combined,
      withPreferredLanguage(
        {
          workflow_step: "collecting_items",
          last_presented_category: "__category_list__",
          last_presented_options: null,
          last_presented_options_at: null,
        },
        preferredLanguage,
      ),
      trace,
      categoryReply.interactiveList,
    );
  }

  if (
    state.last_presented_options &&
    state.last_presented_options.length > 0 &&
    !isPresentedOptionsFresh(state) &&
    isLikelySelectionCommand(normalizedText)
  ) {
    return replyDecision(
      prefersRomanUrdu
        ? "Pichli options expire ho chuki hain. *menu* likhein, main fresh list bhej deta hoon."
        : "Those previously shown options have expired. Send *menu* and I'll share a fresh list.",
      withPreferredLanguage(
        {
          last_presented_options: null,
          last_presented_options_at: null,
        },
        preferredLanguage,
      ),
      trace,
    );
  }

  if (
    state.last_presented_options &&
    state.last_presented_options.length > 0 &&
    !isLikelySelectionCommand(normalizedText) &&
    !findPresentedOptionByDirectValue(rawText, state.last_presented_options) &&
    isSearchLikeDisambiguationMessage(normalizedText)
  ) {
    const suggestions = findLikelyMenuSuggestions(rawText, menuItems, 6);
    if (suggestions.length > 0) {
      return replyDecision(
        buildAmbiguousItemReply(rawText, suggestions, prefersRomanUrdu),
        withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            last_presented_options: suggestions,
            last_presented_options_at: new Date().toISOString(),
          },
          preferredLanguage,
        ),
        trace,
      );
    }
  }

  // Interactive row IDs are UUIDs. If one arrives after the visible list
  // context changed, guide the user back instead of falling into AI fallback.
  if (isUuidLike(rawText.trim()) && (!state.last_presented_options || state.last_presented_options.length === 0)) {
    if (state.last_presented_category === "__category_list__") {
      const categoryReply = buildCategoryListReply(menuItems, prefersRomanUrdu, 1);
      return replyDecision(
        prefersRomanUrdu
          ? `Woh purana option ab active nahi raha. Fresh category list se dubara select karein.\n\n${categoryReply.text}`
          : `That older option is no longer active. Please choose again from the fresh category list.\n\n${categoryReply.text}`,
        withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            last_presented_category: "__category_list__",
            last_presented_options: null,
            last_presented_options_at: null,
          },
          preferredLanguage,
        ),
        trace,
        categoryReply.interactiveList,
      );
    }

    return replyDecision(
      prefersRomanUrdu
        ? "Woh purana option expire ho chuka hai. *menu* likhein ya item ka naam dobara bhej dein."
        : "That older option has expired. Send *menu* or share the item name again.",
      withPreferredLanguage(
        {
          last_presented_options: null,
          last_presented_options_at: null,
        },
        preferredLanguage,
      ),
      trace,
    );
  }

  const availabilityQuery = extractItemAvailabilityQuery(normalizedText);
  if (availabilityQuery) {
    const itemSuggestions = findLikelyMenuSuggestions(availabilityQuery, menuItems, 12); // Increased limit for availability queries
    if (itemSuggestions.length > 0) {
      return replyDecision(
        buildItemMatchesReply(availabilityQuery, itemSuggestions, prefersRomanUrdu),
        withPreferredLanguage(
          {
            workflow_step: "collecting_items",
            last_presented_options: itemSuggestions,
            last_presented_options_at: new Date().toISOString(),
          },
          preferredLanguage,
        ),
        trace,
      );
    }
  }

  const matchedAdds = resolveRequestedItems(
    interpretation.add_items,
    interpretation.unknown_items,
    menuItems,
    rawText,
    context.semanticMatches,
  );
  const removeRequests = resolveRemovalRequests(interpretation, state.cart, rawText);
  const qtyUpdates = resolveQuantityUpdates(rawText, state.cart);
  if (qtyUpdates.length > 0 && isLikelyQuantityOnlyInstruction(normalizedText)) {
    const qtyTargets = new Set(qtyUpdates.map((entry) => normalizeText(entry.name)));
    matchedAdds.matched = matchedAdds.matched.filter((entry) => !qtyTargets.has(normalizeText(entry.name)));
    matchedAdds.ambiguous = [];
  }

  if (state.workflow_step === "awaiting_confirmation") {
    return handleAwaitingConfirmationFlow({
      context,
      interpretation,
      matchedAdds,
      removeRequests,
      qtyUpdates,
      preferredLanguage,
      trace,
      helpers: {
        extractOrderInstructionCandidate,
        buildSummaryReply,
        isExplicitYes,
        validateDraftForPlacement,
        replyDecision,
        withPreferredLanguage,
        buildOrderPlacedReply,
        resetDraftState,
        isExplicitNo,
        mutateCart,
        applyCartQtyUpdates,
        applyCheckoutSignalsToState,
        buildLogisticsOrSummaryReply,
        buildRemovedItemsMessage,
        buildQtyUpdatedItemsMessage,
        buildUnknownItemReplyData,
        shouldDeferToContextSwitchFallback,
      },
    });
  }

  if (matchedAdds.ambiguous.length > 0 && matchedAdds.matched.length === 0) {
    const first = matchedAdds.ambiguous[0];
    return replyDecision(
      buildAmbiguousItemReply(first.query, first.options, prefersRomanUrdu),
      withPreferredLanguage(
        {
          workflow_step: "collecting_items",
          last_presented_options: first.options,
          last_presented_options_at: new Date().toISOString(),
        },
        preferredLanguage,
      ),
      trace,
    );
  }

  // Handle general quantity overrides before other logic
  const generalQtyOverride = inferGeneralQtyOverride(normalizedText, state);
  if (generalQtyOverride) {
    const updatedCart = applyQtyOverride(state.cart, generalQtyOverride.name, generalQtyOverride.qty);
    const nextState: ConversationState = {
      ...state,
      cart: updatedCart,
      workflow_step: "collecting_items",
      preferred_language: preferredLanguage,
    };

    return replyDecision(
      prefersRomanUrdu
        ? `Theek hai, maine quantity update kar di: ${generalQtyOverride.name} x${generalQtyOverride.qty}.`
        : `Done, quantity updated: ${generalQtyOverride.name} x${generalQtyOverride.qty}.`,
      withPreferredLanguage(
        {
          ...buildPersistedStatePatch(nextState),
          workflow_step: "collecting_items",
        },
        preferredLanguage,
      ),
      trace,
    );
  }

  let pendingQuantitySelection: MenuCatalogItem | null = null;
  if (state.last_presented_options && state.last_presented_options.length > 0 && isPresentedOptionsFresh(state)) {
    const directSelection = findPresentedOptionByDirectValue(rawText, state.last_presented_options);
    if (directSelection) {
      if (shouldPromptForQuantityPicker(directSelection)) {
        pendingQuantitySelection = directSelection;
      } else {
        matchedAdds.matched.push({
          name: directSelection.name,
          qty: 1,
          price: directSelection.price,
          category: directSelection.category,
          size: null,
          addons: [],
          item_instructions: null,
        });
      }
    }

    const selection = parseSelectionWithQty(rawText, state.last_presented_options.length);
    if (selection) {
      const selected = state.last_presented_options[selection.optionIndex];
      if (selection.qty === 1 && shouldPromptForQuantityPicker(selected)) {
        pendingQuantitySelection = selected;
      } else {
        matchedAdds.matched.push({
          name: selected.name,
          qty: selection.qty,
          price: selected.price,
          category: selected.category,
          size: null,
          addons: [],
          item_instructions: null,
        });
      }
    }
  }

  if (
    pendingQuantitySelection &&
    matchedAdds.matched.length === 0 &&
    removeRequests.length === 0 &&
    qtyUpdates.length === 0
  ) {
    const quantityPrompt = buildQuantityPickerReply(pendingQuantitySelection, prefersRomanUrdu);
    return replyDecision(
      quantityPrompt.text,
      withPreferredLanguage(
        {
          workflow_step: "collecting_items",
          last_presented_category: `${QUANTITY_PICK_PREFIX}${pendingQuantitySelection.id}`,
          last_presented_options: [pendingQuantitySelection],
          last_presented_options_at: new Date().toISOString(),
        },
        preferredLanguage,
      ),
      trace,
      quantityPrompt.interactiveList,
    );
  }

  if (removeRequests.length > 0 || matchedAdds.matched.length > 0 || qtyUpdates.length > 0) {
    const mutated = mutateCart(state.cart, matchedAdds.matched, removeRequests);
    const cartWithQtyUpdates = applyCartQtyUpdates(mutated.cart, qtyUpdates);
    const nextStateBase: ConversationState = {
      ...state,
      cart: cartWithQtyUpdates,
      workflow_step: "collecting_items",
      preferred_language: preferredLanguage,
      last_presented_options: null,
      last_presented_options_at: null,
    };
    const nextState = applyCheckoutSignalsToState({
      state: nextStateBase,
      interpretation,
      rawText,
      settings: context.settings,
    });

    if (cartWithQtyUpdates.length === 0) {
      return replyDecision(
        prefersRomanUrdu
          ? "Theek hai, cart empty ho gayi. Naya item bhej dein."
          : "Your cart is now empty. Send any item to continue.",
        withPreferredLanguage(resetDraftState(), preferredLanguage),
        trace,
      );
    }

    return buildLogisticsOrSummaryReply(
      {
        state: nextState,
        settings: context.settings,
        matchedAdds,
        removedItemsText: [buildRemovedItemsMessage(mutated.removed), buildQtyUpdatedItemsMessage(qtyUpdates)]
          .filter(Boolean)
          .join("\n"),
        menuItems: context.menuItems,
      },
      trace,
    );
  }

  if (interpretation.intent === "set_order_type" && interpretation.order_type) {
    return handleOrderTypeSelection(context, state, preferredLanguage, interpretation.order_type, trace);
  }

  return handleLogisticsAndFallbackFlow({
    context,
    interpretation,
    matchedAdds,
    preferredLanguage,
    trace,
    helpers: {
      extractOrderInstructionCandidate,
      replyDecision,
      withPreferredLanguage,
      shouldDeferToContextSwitchFallback,
      buildUnknownItemReplyData,
      isUpsellYes,
      isUpsellNo,
      mergeCartItems,
      buildOrderTypePrompt,
      buildOrderTypeInteractiveList,
      buildUpsellInteractiveList,
      handleOrderTypeSelection,
      inferGeneralQtyOverride,
      applyQtyOverride,
      buildClosedReply,
      inferLastItemQtyOverride,
      applyLastItemQtyOverride,
      parseOrderTypeShortcut,
      buildSummaryReply,
      buildPersistedStatePatch,
      clampQty,
    },
  });
}

function isDraftCartItemLike(value: unknown): value is DraftCartItem {
  if (!value || typeof value !== "object") return false;
  const cast = value as Record<string, unknown>;
  return (
    typeof cast.name === "string" &&
    typeof cast.price === "number" &&
    typeof cast.qty === "number" &&
    (typeof cast.category === "string" || cast.category === null) &&
    (typeof cast.size === "string" || cast.size === null || cast.size === undefined) &&
    (cast.addons === undefined || Array.isArray(cast.addons)) &&
    (typeof cast.item_instructions === "string" || cast.item_instructions === null || cast.item_instructions === undefined)
  );
}

function isMenuCatalogItemLike(value: unknown): value is MenuCatalogItem {
  if (!value || typeof value !== "object") return false;
  const cast = value as Record<string, unknown>;
  return (
    typeof cast.id === "string" &&
    typeof cast.name === "string" &&
    typeof cast.price === "number" &&
    (typeof cast.category === "string" || cast.category === null) &&
    typeof cast.is_available === "boolean"
  );
}

function isPresentedOptionsFresh(state: ConversationState): boolean {
  if (!state.last_presented_options_at) return false;
  const timestamp = new Date(state.last_presented_options_at).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= PRESENTED_OPTIONS_TTL_MS;
}

function expectsStructuredCheckoutInput(step: WorkflowStep): boolean {
  return (
    step === "awaiting_upsell_reply" ||
    step === "awaiting_order_type" ||
    step === "awaiting_delivery_address" ||
    step === "awaiting_dine_in_details" ||
    step === "awaiting_confirmation"
  );
}

function parseOrderTypeShortcut(normalizedText: string): OrderType | null {
  if (/\b(price|fee|charges?|cost|kitna|kitne|kya|how much)\b/.test(normalizedText)) {
    return null;
  }

  if (
    /\b(order_type_delivery|order type delivery|type delivery|home delivery|delivery|deliver)\b/.test(normalizedText) &&
    !/\b(no delivery|without delivery|dont deliver|don't deliver)\b/.test(normalizedText)
  ) {
    return "delivery";
  }

  if (
    /\b(order_type_dine_in|order type dine in|type dine in|dine in|dine-in|dinein)\b/.test(normalizedText)
  ) {
    return "dine-in";
  }

  return null;
}

function extractOrderInstructionCandidate(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const explicit = trimmed.match(/(?:special\s+instructions?|instructions?|order\s+note|note)\s*[:\-]?\s*(.+)$/i);
  if (explicit?.[1]) {
    const value = explicit[1].trim();
    return value.length >= 3 ? value.slice(0, 240) : null;
  }

  const polite = trimmed.match(/(?:please|pls)\s+(.+)/i);
  if (polite?.[1] && /(spicy|mild|crispy|well done|without|no\s+\w+|extra)/i.test(polite[1])) {
    return polite[1].trim().slice(0, 240);
  }

  return null;
}

function parseItemCustomizationFromText(rawText: string): {
  size: string | null;
  addons: string[];
  itemInstructions: string | null;
} {
  const normalized = normalizeText(rawText);
  let size: string | null = null;
  for (const [key, value] of SIZE_WORDS) {
    if (new RegExp(`\\b${key}\\b`, "i").test(normalized)) {
      size = value;
      break;
    }
  }

  const addons: string[] = [];
  const withMatch = normalized.match(/\bwith\s+([a-z0-9\s,]+)$/i);
  if (withMatch?.[1]) {
    const parts = withMatch[1]
      .split(/,| and /i)
      .map((part) => part.trim())
      .filter((part) =>
        part.length >= 2 &&
        !MENU_LOOKUP_FILLER_WORDS.has(part) &&
        !SIZE_WORDS.has(part) &&
        !/\b(qty|quantity|piece|pcs|plate|order|item|items)\b/i.test(part),
      );
    addons.push(...parts.slice(0, 6));
  }

  const instructionSegments: string[] = [];
  const withoutMatch = normalized.match(/\bwithout\s+([a-z0-9\s,]+)/i);
  if (withoutMatch?.[1]) {
    instructionSegments.push(`Without ${withoutMatch[1].trim()}`);
  }
  if (/\bextra\s+spicy\b/i.test(normalized)) instructionSegments.push("Extra spicy");
  if (/\bless\s+spicy\b/i.test(normalized)) instructionSegments.push("Less spicy");
  if (/\bmild\b/i.test(normalized)) instructionSegments.push("Mild");

  const itemInstructions = instructionSegments.length > 0 ? instructionSegments.join("; ").slice(0, 240) : null;

  return {
    size,
    addons: [...new Set(addons.map((entry) => entry.slice(0, 40)))],
    itemInstructions,
  };
}

function formatDraftItemLabel(item: DraftCartItem): string {
  const details: string[] = [];
  if (item.size) details.push(item.size);
  const addons = Array.isArray(item.addons) ? item.addons : [];
  if (addons.length > 0) details.push(`Add-ons: ${addons.join(", ")}`);
  if (item.item_instructions) details.push(item.item_instructions);
  if (details.length === 0) return item.name;
  return `${item.name} (${details.join(" | ")})`;
}

function isSameDraftItem(left: DraftCartItem, right: DraftCartItem): boolean {
  if (normalizeText(left.name) !== normalizeText(right.name)) return false;
  if ((left.size ?? null) !== (right.size ?? null)) return false;
  if ((left.item_instructions ?? null) !== (right.item_instructions ?? null)) return false;
  const leftAddons = [...(Array.isArray(left.addons) ? left.addons : [])].map((entry) => normalizeText(entry)).sort();
  const rightAddons = [...(Array.isArray(right.addons) ? right.addons : [])].map((entry) => normalizeText(entry)).sort();
  if (leftAddons.length !== rightAddons.length) return false;
  return leftAddons.every((entry, index) => entry === rightAddons[index]);
}

function isWithinCancellationWindow(createdAt: string): boolean {
  const createdTime = new Date(createdAt).getTime();
  if (!Number.isFinite(createdTime)) return false;
  return Date.now() - createdTime <= ORDER_CANCELLATION_WINDOW_MS;
}

function canCancelOrderStatus(status: string): boolean {
  return status === "received" || status === "preparing" || status === "out_for_delivery";
}

async function tryCancelRecentOrder(conversationId: string): Promise<{
  result: "cancelled" | "too_late" | "not_found" | "already_final";
  orderNumber?: number;
}> {
  const recentOrder = await getRecentOrderContext(conversationId);
  if (!recentOrder) return { result: "not_found" };
  if (!canCancelOrderStatus(recentOrder.status)) return { result: "already_final", orderNumber: recentOrder.order_number };
  if (!isWithinCancellationWindow(recentOrder.created_at)) return { result: "too_late", orderNumber: recentOrder.order_number };

  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({
      status: "cancelled",
      cancellation_requested_at: new Date().toISOString(),
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", recentOrder.id)
    .eq("status", recentOrder.status)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { result: "already_final", orderNumber: recentOrder.order_number };
  }

  return { result: "cancelled", orderNumber: recentOrder.order_number };
}

function buildMenuQueryHints(rawText: string, normalizedText: string): string[] {
  if (isGenericMenuPrompt(normalizedText)) {
    return [];
  }

  const hints = [extractItemAvailabilityQuery(normalizedText), rawText.trim()].filter(
    (value): value is string => Boolean(value && value.trim()),
  );
  return [...new Set(hints)];
}

function isGenericMenuPrompt(normalizedText: string): boolean {
  return /^(menu|show menu|show me menu|browse menu|categories|category list|menu categories)$/.test(normalizedText);
}

function pickMenuSuggestionsForQuery(
  query: string,
  menuItems: MenuCatalogItem[],
  semanticMatches: SemanticMenuMatch[],
  limit = 10,
): MenuCatalogItem[] {
  const semanticCandidates = semanticMatches
    .filter((item) => (item.similarity ?? 0) >= 0.5)
    .slice(0, Math.max(limit * 2, 20))
    .map((item) => ({
      id: item.id,
      name: item.name,
      price: Number(item.price),
      category: item.category ?? null,
      is_available: item.is_available ?? true,
    }));
  const lexicalCandidates = findLikelyMenuSuggestions(query, menuItems, Math.max(limit * 2, 20))
    .filter((item) => {
      const normalizedQuery = normalizeText(query);
      const normalizedItem = normalizeText(`${item.name} ${item.category ?? ""}`);
      const score = Math.max(
        itemSimilarityScore(normalizedQuery, normalizedItem),
        tokenOverlapScore(normalizedQuery, normalizedItem),
      );
      return score >= 0.22;
    });
  const mergedById = new Map<string, MenuCatalogItem>();
  for (const item of [...semanticCandidates, ...lexicalCandidates]) {
    if (!mergedById.has(item.id)) {
      mergedById.set(item.id, item);
    }
  }
  const merged = [...mergedById.values()];
  if (merged.length > 0) {
    return merged.slice(0, limit);
  }

  return lexicalCandidates.slice(0, limit);
}

function applyCheckoutSignalsToState(params: {
  state: ConversationState;
  interpretation: OrderTurnInterpretation;
  rawText: string;
  settings: RestaurantSettings;
}): ConversationState {
  const { interpretation, rawText, settings } = params;
  const next = { ...params.state };
  const normalizedText = normalizeText(rawText);
  const explicitType = interpretation.order_type ?? parseOrderTypeShortcut(normalizedText);
  const instructionCandidate = extractOrderInstructionCandidate(rawText);

  if (explicitType === "delivery" && settings.delivery_enabled) {
    next.order_type = "delivery";
    next.guests = null;
    next.reservation_time = null;
    const address = interpretation.address ?? parseAddress(rawText);
    if (address) {
      next.address = address;
    }
  } else if (explicitType === "dine-in") {
    next.order_type = "dine-in";
    next.address = null;
    const guests = interpretation.guests ?? parseGuestCount(normalizedText, clampQty) ?? next.guests;
    const reservationTime =
      parseReservationTime(interpretation.reservation_time ?? rawText, {
        opening_time: settings.opening_time,
        closing_time: settings.closing_time,
      }) ?? next.reservation_time;
    next.guests = guests ?? null;
    next.reservation_time = reservationTime ?? null;
  } else if (next.order_type === "delivery") {
    const address = interpretation.address ?? parseAddress(rawText);
    if (address) {
      next.address = address;
    }
  } else if (next.order_type === "dine-in") {
    const guests = interpretation.guests ?? parseGuestCount(normalizedText, clampQty) ?? next.guests;
    const reservationTime =
      parseReservationTime(interpretation.reservation_time ?? rawText, {
        opening_time: settings.opening_time,
        closing_time: settings.closing_time,
      }) ?? next.reservation_time;
    next.guests = guests ?? null;
    next.reservation_time = reservationTime ?? null;
  }

  if (instructionCandidate) {
    next.customer_instructions = instructionCandidate;
  }

  return next;
}

function scoreSignals(text: string, words: string[]): number {
  return words.reduce((total, word) => {
    if (text === word) return total + 2;
    if (text.includes(word)) return total + 1;
    return total;
  }, 0);
}

function getAvailableMenuItems(items: MenuCatalogItem[]): MenuCatalogItem[] {
  return items.filter((item) => item.is_available);
}

function containsAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => hasPhrase(text, phrase));
}

function hasPhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  return (` ${text} `).includes(` ${normalizedPhrase} `);
}

function isExplicitYes(text: string): boolean {
  // Guard: edit/add/remove instructions should never be interpreted as
  // checkout confirmation even if they include words like "done" or "kr do".
  if (
    /\b(add|remove|delete|without|minus|qty|quantity|change|modify|update|replace|aur|bhi|plus|kam kar|kam kr|kar do|kr do)\b/.test(
      text,
    )
  ) {
    return false;
  }

  // For longer texts, require an explicit confirmation phrase.
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 3 && !/\b(confirm|confirmed|place order)\b/.test(text)) {
    return false;
  }

  return YES_WORDS.some((word) => hasPhrase(text, word));
}

function isExplicitNo(text: string): boolean {
  return NO_WORDS.some((word) => hasPhrase(text, word));
}

function isLikelyMenuRequest(text: string): boolean {
  // Keep interactive category controls on their dedicated path.
  // Otherwise commands like "category_option_2" get treated as a generic
  // menu request and the bot keeps re-sending the category list.
  if (/^category\s+option\s+\d{1,2}$/.test(text)) return false;
  if (/^category\s+more\s+\d{1,2}$/.test(text)) return false;

  return /(menu|show.*menu|what.*have|list.*items?|kya.*hai|dikhao|category|categories|price|rates?)/.test(text);
}

function extractStandaloneMenuLookupQuery(rawText: string, normalizedText: string): string | null {
  if (!normalizedText) return null;
  if (isGenericMenuPrompt(normalizedText)) return null;
  if (extractAnyQuantity(normalizedText) != null) return null;
  if (isExplicitYes(normalizedText) || isExplicitNo(normalizedText)) return null;
  if (asksOpeningHours(normalizedText) || asksContactDetails(normalizedText) || asksBranchAddress(normalizedText)) {
    return null;
  }
  if (normalizedText.split(/\s+/).length > 8) return null;
  if (!/[a-z]/.test(normalizedText)) return null;

  const filteredTokens = normalizedText
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !MENU_LOOKUP_FILLER_WORDS.has(token));

  if (filteredTokens.length === 0) return null;

  const candidate = filteredTokens.join(" ").trim();
  if (candidate.length < 3) return null;

  // If the cleaned query is just logistics text, skip lookup and let regular flow handle it.
  if (/(delivery|dine in|dinein|address|confirm|status|track|eta|open|hours)/.test(candidate)) return null;

  const compactRaw = normalizeCompact(rawText);
  if (compactRaw.startsWith("categoryoption") || compactRaw.startsWith("categorymore")) return null;
  return candidate;
}

function isSearchLikeDisambiguationMessage(normalizedText: string): boolean {
  if (!normalizedText || normalizedText.length < 3) return false;
  if (extractAnyQuantity(normalizedText) != null) return false;
  if (/(delivery|dine in|dinein|confirm|yes|no|cancel|remove|qty|quantity)/.test(normalizedText)) return false;
  if (/(add|kar do|kr do|chahiye|order)/.test(normalizedText)) return false;
  return true;
}

function extractItemAvailabilityQuery(normalizedText: string): string | null {
  const cleaned = normalizedText.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  // Match patterns like "ice cream hai", "do you have ice cream", "ice cream available", etc.
  let match = cleaned.match(/^(.+?)\s+(hai|available|milta|milti|milta hai|milti hai)\??$/);
  let query = match ? match[1].trim() : null;

  if (!query) {
    match = cleaned.match(/^(do you have|have you got|is there|got any)\s+(.+?)\??$/i);
    query = match ? match[2].trim() : null;
  }

  if (!query || query.length < 3) return null;
  if (/(menu|category|categories|delivery|dine in|dinein)/.test(query)) return null;
  return query;
}

function isLikelyQuantityOnlyInstruction(normalizedText: string): boolean {
  return (
    /\b(quantity|qty|set|update|change)\b/.test(normalizedText) ||
    /\b(aik aur|ek aur|one more|aur kar|aur kr|barha|barhao|increase)\b/.test(normalizedText)
  );
}

function asksOpeningHours(normalizedText: string): boolean {
  return (
    /\b(open|close|timing|hours?)\b/.test(normalizedText) ||
    /\b(kab open|kab band|open hota|band hota|timings?)\b/.test(normalizedText)
  );
}

function asksContactDetails(normalizedText: string): boolean {
  return /\b(phone|number|contact|call|helpline|help line|support|hotline)\b/.test(normalizedText);
}

function asksBranchAddress(normalizedText: string): boolean {
  return /\b(address|location|kahan|kidhar|where)\b/.test(normalizedText);
}

function buildBranchAddressReply(
  branch: TurnContext["branch"],
  romanUrdu: boolean,
): string {
  if (!branch.address?.trim()) {
    return romanUrdu
      ? `Maazrat, ${branch.name} ka address abhi update nahi hai.`
      : `Sorry, ${branch.name} address is not configured yet.`;
  }

  return romanUrdu
    ? `${branch.name} ka address: ${branch.address}`
    : `${branch.name} address: ${branch.address}`;
}

function buildHelplineValue(settings: RestaurantSettings, state: ConversationState): string {
  if (state.order_type === "delivery") {
    return settings.phone_delivery?.trim() || settings.phone_dine_in?.trim() || "support line";
  }

  if (state.order_type === "dine-in") {
    return settings.phone_dine_in?.trim() || settings.phone_delivery?.trim() || "support line";
  }

  return settings.phone_delivery?.trim() || settings.phone_dine_in?.trim() || "support line";
}

function buildBranchContactReply(
  settings: RestaurantSettings,
  state: ConversationState,
  romanUrdu: boolean,
): string {
  const deliveryPhone = settings.phone_delivery?.trim() || null;
  const dineInPhone = settings.phone_dine_in?.trim() || null;

  if (state.order_type === "delivery" && deliveryPhone) {
    return romanUrdu ? `Delivery helpline: ${deliveryPhone}` : `Delivery helpline: ${deliveryPhone}`;
  }

  if (state.order_type === "dine-in" && dineInPhone) {
    return romanUrdu ? `Dine-in helpline: ${dineInPhone}` : `Dine-in helpline: ${dineInPhone}`;
  }

  if (deliveryPhone && dineInPhone && deliveryPhone !== dineInPhone) {
    return romanUrdu
      ? `Delivery helpline: ${deliveryPhone}. Dine-in helpline: ${dineInPhone}.`
      : `Delivery helpline: ${deliveryPhone}. Dine-in helpline: ${dineInPhone}.`;
  }

  const contact = deliveryPhone || dineInPhone || "support line";
  return romanUrdu ? `Contact number: ${contact}.` : `Contact number: ${contact}.`;
}

function attemptsCheckoutProgression(
  interpretation: OrderTurnInterpretation,
  state: ConversationState,
  normalizedText: string,
): boolean {
  if (interpretation.intent === "confirm_order" || interpretation.wants_confirmation === true) {
    return true;
  }

  if (state.workflow_step === "awaiting_confirmation" && isExplicitYes(normalizedText)) {
    return true;
  }

  if (
    interpretation.intent === "set_order_type" ||
    interpretation.intent === "provide_address" ||
    interpretation.intent === "provide_dine_in_details"
  ) {
    return true;
  }

  if (state.workflow_step === "awaiting_order_type" && interpretation.order_type != null) {
    return true;
  }

  if (state.workflow_step === "awaiting_delivery_address" && interpretation.address != null) {
    return true;
  }

  if (
    state.workflow_step === "awaiting_dine_in_details" &&
    (interpretation.guests != null || interpretation.reservation_time != null)
  ) {
    return true;
  }

  return false;
}

function withPreferredLanguage(
  patch: Partial<ConversationState>,
  preferredLanguage: LanguagePreference,
): Partial<ConversationState> {
  return {
    ...patch,
    preferred_language: preferredLanguage,
  };
}

function replyDecision(
  reply: string,
  statePatch: Partial<ConversationState>,
  trace?: TurnTrace,
  interactiveList?: {
    body: string;
    buttonText: string;
    sectionTitle?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  } | null,
): TurnDecision {
  return {
    kind: "reply",
    reply,
    interactiveList,
    statePatch,
    trace,
  };
}

function resetDraftState(): Partial<ConversationState> {
  return {
    workflow_step: "idle",
    cart: [],
    order_type: null,
    address: null,
    guests: null,
    reservation_time: null,
    customer_instructions: null,
    resume_workflow_step: null,
    summary_sent_at: null,
    upsell_item_name: null,
    upsell_item_price: null,
    upsell_offered: false,
    last_presented_category: null,
    last_presented_at: null,
    last_presented_options: null,
    last_presented_options_at: null,
    declined_upsells: [],
  };
}

function buildClosedReply(settings: RestaurantSettings, romanUrdu: boolean, hasDraft: boolean): string {
  if (!settings.is_accepting_orders) {
    return romanUrdu
      ? "Filhal orders manually pause hain. Aap ka draft save hai aur reopen par continue kar sakte hain."
      : "Orders are currently paused by the restaurant. Your draft is saved and can continue when reopened.";
  }

  if (hasDraft) {
    return romanUrdu
      ? `Hum abhi closed hain (timings ${settings.opening_time} se ${settings.closing_time}). Aap ka draft save hai, continue kal kar sakte hain.`
      : `We are currently closed (${settings.opening_time} to ${settings.closing_time}). Your draft is saved and you can continue when we reopen.`;
  }

  return romanUrdu
    ? `Maazrat, hum abhi orders accept nahi kar rahe. Timings ${settings.opening_time} se ${settings.closing_time} hain.`
    : `Sorry, we are not accepting orders right now. Our timing is ${settings.opening_time} to ${settings.closing_time}.`;
}

function buildOrderStatusReply(order: RecentOrderContext, romanUrdu: boolean): string {
  const label = order.status.replace(/_/g, " ");
  return romanUrdu
    ? `Aap ka recent order #${order.order_number} ka status *${label}* hai.`
    : `Your recent order #${order.order_number} is currently *${label}*.`;
}

function buildPaymentReply(settings: RestaurantSettings, romanUrdu: boolean): string {
  return romanUrdu
    ? `Cash on delivery available hai. Mazeed payment options ke liye call karein: ${settings.phone_delivery || "support line"}.`
    : `Cash on delivery is available. For other payment options, call ${settings.phone_delivery || "our support line"}.`;
}

function maybeAppendCheckoutPrompt(reply: string, state: ConversationState, romanUrdu: boolean): string {
  if (state.cart.length === 0) return reply;

  if (state.order_type == null) {
    const prompt = buildOrderTypePrompt(true, romanUrdu);
    return `${reply}\n\n${prompt}`;
  }

  if (state.order_type === "delivery" && !state.address) {
    const prompt = romanUrdu ? "Apna full delivery address bhej dein." : "Please send your full delivery address.";
    return `${reply}\n\n${prompt}`;
  }

  if (state.order_type === "dine-in" && (!state.guests || !state.reservation_time)) {
    const prompt = romanUrdu ? "Guests aur time batayein." : "Please share guest count and time.";
    return `${reply}\n\n${prompt}`;
  }

  return reply;
}

function buildOrderTypePrompt(deliveryEnabled: boolean, romanUrdu: boolean): string {
  if (!deliveryEnabled) {
    return romanUrdu
      ? "Order type batayein: *Dine-in*."
      : "Please choose order type: *Dine-in*.";
  }

  return romanUrdu
    ? "Order type batayein: *Delivery* ya *Dine-in*."
    : "Please choose order type: *Delivery* or *Dine-in*.";
}

function buildAddedItemsMessage(items: DraftCartItem[]): string {
  if (items.length === 0) return "";
  const summary = items.map((item) => `${formatDraftItemLabel(item)} x${item.qty}`).join(", ");
  return `Added: ${summary}`;
}

function buildRemovedItemsMessage(
  removed: Array<{ name: string; removedQty: number }>,
): string {
  if (removed.length === 0) return "";
  const summary = removed.map((item) => `${item.name} x${item.removedQty}`).join(", ");
  return `Removed: ${summary}`;
}

function buildQtyUpdatedItemsMessage(updates: CartQtyUpdate[]): string {
  if (updates.length === 0) return "";
  const summary = updates.map((item) => `${item.name} x${item.qty}`).join(", ");
  return `Quantity updated: ${summary}`;
}

function buildUnknownItemReply(
  unknown: string[],
  menuItems: MenuCatalogItem[],
  romanUrdu: boolean,
  semanticMatches: SemanticMenuMatch[] = [],
): string {
  return buildUnknownItemReplyData(unknown, menuItems, romanUrdu, semanticMatches).text;
}

function buildUnknownItemReplyData(
  unknown: string[],
  menuItems: MenuCatalogItem[],
  romanUrdu: boolean,
  semanticMatches: SemanticMenuMatch[] = [],
): { text: string; selectableItems: MenuCatalogItem[] } {
  const unknownQuery = unknown.join(" ").trim();
  const normalizedUnknown = normalizeText(unknownQuery);
  const availableMenuItems = menuItems.filter((item) => item.is_available);
  const semanticCandidatePool = semanticMatches
    .filter((item) => (item.similarity ?? 0) >= 0.52 && (item.is_available ?? true))
    .slice(0, 20)
    .map((item) => ({
      id: item.id,
      name: item.name,
      price: Number(item.price),
      category: item.category ?? null,
      is_available: item.is_available ?? true,
    }));
  const lexicalCandidatePool = findLikelyMenuSuggestions(unknownQuery, availableMenuItems, 20).filter((item) => {
    const mergedLabel = normalizeText(`${item.name} ${item.category ?? ""}`);
    const score = Math.max(itemSimilarityScore(normalizedUnknown, mergedLabel), tokenOverlapScore(normalizedUnknown, mergedLabel));
    return score >= 0.22;
  });
  const fallbackNearestPool =
    semanticCandidatePool.length === 0 && lexicalCandidatePool.length === 0
      ? rankNearestMenuAlternatives(unknownQuery, availableMenuItems, 10)
      : [];
  const selectableItems = [...semanticCandidatePool, ...lexicalCandidatePool, ...fallbackNearestPool]
    .slice(0, 20)
    .reduce<MenuCatalogItem[]>((acc, item) => {
      if (!acc.some((entry) => entry.id === item.id)) acc.push(item);
      return acc;
    }, [])
    .slice(0, 10);

  if (selectableItems.length > 0) {
    const options = selectableItems
      .map((item, index) => `${index + 1}. ${item.name} - Rs. ${item.price}`)
      .join("\n");
    return {
      text: romanUrdu
        ? `Mujhe exact item nahi mila: ${unknown.join(", ")}.\nClosest available options ye hain:\n${options}\nNumber bhej dein.`
        : `I couldn't find an exact match for: ${unknown.join(", ")}.\nHere are the closest available options:\n${options}\nReply with a number.`,
      selectableItems,
    };
  }

  return {
    text: romanUrdu
      ? `Maazrat, *${unknown.join(", ")}* menu mein available nahi lag raha. Aap menu ya category dekhna chahen to *menu* likh dein.`
      : `Sorry, *${unknown.join(", ")}* does not seem available on the menu right now. Send *menu* to browse categories.`,
    selectableItems: [],
  };
}

function rankNearestMenuAlternatives(
  query: string,
  menuItems: MenuCatalogItem[],
  limit = 10,
): MenuCatalogItem[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery || menuItems.length === 0) return [];

  return menuItems
    .map((item) => {
      const normalizedCandidate = normalizeText(`${item.name} ${item.category ?? ""}`);
      const score = Math.max(
        itemSimilarityScore(normalizedQuery, normalizedCandidate),
        tokenOverlapScore(normalizedQuery, normalizedCandidate),
      );
      return { item, score };
    })
    .filter((entry) => entry.score >= 0.08)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

function isUpsellYes(normalizedText: string): boolean {
  return (
    normalizedText === "upsell_yes" ||
    normalizedText === "upsell yes" ||
    normalizedText === "upsell-yes" ||
    hasPhrase(normalizedText, "add it") ||
    isExplicitYes(normalizedText)
  );
}

function isUpsellNo(normalizedText: string): boolean {
  return (
    normalizedText === "upsell_no" ||
    normalizedText === "upsell no" ||
    normalizedText === "upsell-no" ||
    hasPhrase(normalizedText, "skip") ||
    isExplicitNo(normalizedText)
  );
}

function buildUpsellInteractiveList(romanUrdu: boolean, itemName?: string, itemPrice?: number): {
  body: string;
  buttonText: string;
  sectionTitle?: string;
  rows: Array<{ id: string; title: string; description?: string }>;
} {
  const itemText = itemName && itemPrice != null ? 
    (romanUrdu ? `${itemName} (Rs. ${itemPrice})` : `${itemName} (Rs. ${itemPrice})`) : 
    (romanUrdu ? "Suggested item" : "Suggested item");

  return {
    body: romanUrdu ? `${itemText} add karna chahenge?` : `Would you like to add ${itemText}?`,
    buttonText: romanUrdu ? "Choose" : "Choose",
    sectionTitle: romanUrdu ? "Upsell" : "Upsell",
    rows: [
      {
        id: "upsell_yes",
        title: romanUrdu ? "Haan, Add Kar Do" : "Yes, Add It",
      },
      {
        id: "upsell_no",
        title: romanUrdu ? "Nahi, Skip" : "No, Skip",
      },
    ],
  };
}

function buildOrderTypeInteractiveList(
  romanUrdu: boolean,
  deliveryEnabled: boolean,
): {
  body: string;
  buttonText: string;
  sectionTitle?: string;
  rows: Array<{ id: string; title: string; description?: string }>;
} | null {
  const rows: Array<{ id: string; title: string; description?: string }> = [];

  if (deliveryEnabled) {
    rows.push({
      id: "order_type_delivery",
      title: romanUrdu ? "Delivery" : "Delivery",
      description: romanUrdu ? "Address par bhejna hai" : "Send to my address",
    });
  }

  rows.push({
    id: "order_type_dine_in",
    title: romanUrdu ? "Dine-in" : "Dine-in",
    description: romanUrdu ? "Restaurant mein khaana hai" : "I will eat at restaurant",
  });

  if (rows.length === 0) {
    return null;
  }

  return {
    body: romanUrdu
      ? "Apna order type select karein."
      : "Please choose your order type.",
    buttonText: romanUrdu ? "Choose Type" : "Choose Type",
    sectionTitle: romanUrdu ? "Order Type" : "Order Type",
    rows,
  };
}

function pickUpsellSuggestion(menuItems: MenuCatalogItem[], state: ConversationState): MenuCatalogItem | null {
  const existingNames = new Set(state.cart.map((item) => normalizeText(item.name)));
  const declined = new Set(state.declined_upsells.map((item) => normalizeText(item)));
  const candidates = menuItems.filter((item) => {
    if (!item.is_available) return false;
    const normalizedName = normalizeText(item.name);
    if (existingNames.has(normalizedName)) return false;
    if (declined.has(normalizedName)) return false;
    // Check for semantic similarity with cart items
    const isSimilar = state.cart.some((cartItem) => {
      const cartNormalized = normalizeText(cartItem.name);
      const itemNormalized = normalizedName;
      // Simple similarity check: if they share significant words
      const cartWords = cartNormalized.split(/\s+/);
      const itemWords = itemNormalized.split(/\s+/);
      const commonWords = cartWords.filter(word => itemWords.includes(word) && word.length > 2);
      return commonWords.length >= 2; // If 2+ significant words match, consider similar
    });
    if (isSimilar) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  const priorityCategoryWords = [
    "drink",
    "beverage",
    "dessert",
    "starter",
    "fries",
    "side",
    "salad",
  ];

  const prioritized = candidates
    .filter((item) => {
      const normalizedCategory = normalizeText(item.category ?? "");
      return priorityCategoryWords.some((word) => normalizedCategory.includes(word));
    })
    .sort((left, right) => left.price - right.price);

  if (prioritized.length > 0) {
    return prioritized[0];
  }

  const sortedByPrice = [...candidates].sort((left, right) => left.price - right.price);
  return sortedByPrice[0] ?? null;
}

function handleOrderTypeSelection(
  context: TurnContext,
  state: ConversationState,
  preferredLanguage: LanguagePreference,
  orderType: OrderType,
  trace?: TurnTrace,
): TurnDecision {
  const romanUrdu = preferredLanguage === "roman_urdu";

  if (state.cart.length === 0) {
    return replyDecision(
      romanUrdu
        ? "Cart empty hai. Pehle item add karein, phir order type choose karein."
        : "Your cart is empty. Add an item first, then choose order type.",
      withPreferredLanguage(
        {
          workflow_step: "collecting_items",
          order_type: null,
          address: null,
          guests: null,
          reservation_time: null,
        },
        preferredLanguage,
      ),
      trace,
    );
  }

  if (orderType === "delivery") {
    if (!context.settings.delivery_enabled) {
      return replyDecision(
        romanUrdu
          ? "Maazrat, delivery is branch mein available nahi hai. Aap dine-in select karein."
          : "Sorry, delivery is not available for this branch. Please choose dine-in.",
        withPreferredLanguage({ workflow_step: "awaiting_order_type" }, preferredLanguage),
        trace,
      );
    }

    // Clear dine-in specific fields when switching to delivery
    const clearedState = {
      ...state,
      order_type: "delivery" as OrderType,
      guests: null,
      reservation_time: null,
    };

    if (state.address) {
      return buildSummaryReply(
        {
          state: {
            ...clearedState,
            preferred_language: preferredLanguage,
          },
          settings: context.settings,
        },
        trace,
      );
    }

    return replyDecision(
      romanUrdu ? "Theek hai, apna full delivery address bhej dein." : "Great, please share your full delivery address.",
      withPreferredLanguage(
        {
          ...buildPersistedStatePatch(clearedState),
          workflow_step: "awaiting_delivery_address",
          order_type: "delivery",
          guests: null,
          reservation_time: null,
          last_presented_category: null,
          last_presented_options: null,
          last_presented_options_at: null,
        },
        preferredLanguage,
      ),
      trace,
    );
  }

  // Clear delivery specific fields when switching to dine-in
  const clearedState = {
    ...state,
    order_type: "dine-in" as OrderType,
    address: null,
  };

  if (state.guests && state.reservation_time) {
    return buildSummaryReply(
      {
        state: {
          ...clearedState,
          preferred_language: preferredLanguage,
        },
        settings: context.settings,
      },
      trace,
    );
  }

  return replyDecision(
    romanUrdu
      ? "Theek hai, dine-in selected. Kitne guests honge aur kis time aana hai?"
      : "Great, dine-in selected. How many guests and what time?",
    withPreferredLanguage(
      {
        ...buildPersistedStatePatch(clearedState),
        workflow_step: "awaiting_dine_in_details",
        order_type: "dine-in",
        address: null,
        last_presented_category: null,
        last_presented_options: null,
        last_presented_options_at: null,
      },
      preferredLanguage,
    ),
    trace,
  );
}

function buildLogisticsOrSummaryReply(
  params: {
    state: ConversationState;
    settings: RestaurantSettings;
    matchedAdds: MatchedItemsResult;
    removedItemsText: string;
    menuItems?: MenuCatalogItem[];
  },
  trace?: TurnTrace,
): TurnDecision {
  const romanUrdu = params.state.preferred_language === "roman_urdu";
  const parts: string[] = [];

  const addedText = buildAddedItemsMessage(params.matchedAdds.matched);
  if (addedText) parts.push(addedText);
  if (params.removedItemsText) parts.push(params.removedItemsText);

  if (params.matchedAdds.unknown.length > 0) {
    parts.push(buildUnknownItemReply(params.matchedAdds.unknown, [], romanUrdu));
  }

  if (
    params.state.order_type == null &&
    params.matchedAdds.matched.length > 0 &&
    params.state.cart.length >= 2 &&
    !params.state.upsell_offered &&
    Array.isArray(params.menuItems)
  ) {
    const upsell = pickUpsellSuggestion(params.menuItems, params.state);
    if (upsell) {
      parts.push(
        romanUrdu
          ? `Aap *${upsell.name}* (Rs. ${upsell.price}) add karna chahenge?`
          : `Would you like to add *${upsell.name}* (Rs. ${upsell.price})?`,
      );

      return replyDecision(
        parts.join("\n\n"),
        withPreferredLanguage(
          {
            ...buildPersistedStatePatch(params.state),
            workflow_step: "awaiting_upsell_reply",
            upsell_item_name: upsell.name,
            upsell_item_price: upsell.price,
            upsell_offered: true,
          },
          params.state.preferred_language,
        ),
        trace,
        buildUpsellInteractiveList(romanUrdu, upsell.name, upsell.price),
      );
    }
  }

  if (params.state.order_type == null) {
    parts.push(
      romanUrdu
        ? `${buildOrderTypePrompt(params.settings.delivery_enabled, romanUrdu)} Agar quantity ya item remove karna ho to bhi likh dein.`
        : `${buildOrderTypePrompt(params.settings.delivery_enabled, romanUrdu)} You can also ask to remove items or change quantity.`,
    );
    return replyDecision(
      parts.join("\n\n"),
      withPreferredLanguage(
        {
          ...buildPersistedStatePatch(params.state),
          workflow_step: "awaiting_order_type",
        },
        params.state.preferred_language,
      ),
      trace,
      buildOrderTypeInteractiveList(romanUrdu, params.settings.delivery_enabled),
    );
  }

  if (params.state.order_type === "delivery" && !params.state.address) {
    parts.push(
      romanUrdu ? "Apna full delivery address bhej dein." : "Please send your full delivery address.",
    );
    return replyDecision(
      parts.join("\n\n"),
      withPreferredLanguage(
        {
          ...buildPersistedStatePatch(params.state),
          workflow_step: "awaiting_delivery_address",
        },
        params.state.preferred_language,
      ),
      trace,
    );
  }

  if (params.state.order_type === "dine-in" && (!params.state.guests || !params.state.reservation_time)) {
    parts.push(
      romanUrdu
        ? "Kitne guests aur kis time aana hai?"
        : "Please share guest count and reservation time.",
    );
    return replyDecision(
      parts.join("\n\n"),
      withPreferredLanguage(
        {
          ...buildPersistedStatePatch(params.state),
          workflow_step: "awaiting_dine_in_details",
        },
        params.state.preferred_language,
      ),
      trace,
    );
  }

  return buildSummaryReply(
    {
      settings: params.settings,
      state: params.state,
    },
    trace,
  );
}

function buildPersistedStatePatch(state: ConversationState): Partial<ConversationState> {
  return {
    cart: state.cart,
    order_type: state.order_type,
    address: state.address,
    guests: state.guests,
    reservation_time: state.reservation_time,
    customer_instructions: state.customer_instructions,
    upsell_item_name: state.upsell_item_name,
    upsell_item_price: state.upsell_item_price,
    upsell_offered: state.upsell_offered,
    declined_upsells: state.declined_upsells,
    last_presented_category: state.last_presented_category,
    last_presented_at: state.last_presented_at,
    last_presented_options: state.last_presented_options,
    last_presented_options_at: state.last_presented_options_at,
    resume_workflow_step: state.resume_workflow_step,
    summary_sent_at: state.summary_sent_at,
  };
}

function buildSummaryReply(
  params: {
    state: ConversationState;
    settings: RestaurantSettings;
  },
  trace?: TurnTrace,
): TurnDecision {
  const state = params.state;
  const romanUrdu = state.preferred_language === "roman_urdu";

  if (state.cart.length === 0) {
    return replyDecision(
      romanUrdu
        ? "Cart empty hai. Please pehle item add karein."
        : "Your cart is empty. Please add items first.",
      withPreferredLanguage(
        {
          workflow_step: "collecting_items",
          order_type: null,
          address: null,
          guests: null,
          reservation_time: null,
          summary_sent_at: null,
        },
        state.preferred_language,
      ),
      trace,
    );
  }

  const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const deliveryFee =
    state.order_type === "delivery" && params.settings.delivery_enabled && params.settings.delivery_fee > 0
      ? Number(params.settings.delivery_fee)
      : 0;
  const total = subtotal + deliveryFee;

  const lines: string[] = [
    "Order summary:",
    ...state.cart.map((item) => `- ${formatDraftItemLabel(item)} x${item.qty} = Rs. ${item.price * item.qty}`),
    `Subtotal: Rs. ${subtotal}`,
  ];

  if (deliveryFee > 0) {
    lines.push(`Delivery fee: Rs. ${deliveryFee}`);
  }

  lines.push(`Total: Rs. ${total}`);

  if (state.order_type === "delivery" && state.address) {
    lines.push(`Address: ${state.address}`);
  } else if (state.order_type === "dine-in") {
    lines.push(`Guests: ${state.guests ?? "-"}`);
    lines.push(`Time: ${formatReservationTime(state.reservation_time)}`);
  }

  if (state.customer_instructions) {
    lines.push(`Instructions: ${state.customer_instructions}`);
  }

  lines.push(
    romanUrdu
      ? "Confirm karne ke liye *Haan* likhein. Change ke liye item add/remove message bhej dein."
      : "Reply *Yes* to confirm. To make changes, send add/remove instructions.",
  );

  return replyDecision(
    lines.join("\n"),
    withPreferredLanguage(
      {
        ...buildPersistedStatePatch(state),
        workflow_step: "awaiting_confirmation",
        summary_sent_at: new Date().toISOString(),
      },
      state.preferred_language,
    ),
    trace,
  );
}

function formatReservationTime(iso: string | null): string {
  if (!iso) return "-";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

function buildOrderPlacedReply(settings: RestaurantSettings, romanUrdu: boolean): string {
  const estimated = romanUrdu
    ? "Estimated delivery/prep time 30-45 minutes."
    : "Estimated delivery/prep time is 30-45 minutes.";
  const contact = settings.phone_delivery?.trim() || settings.phone_dine_in?.trim() || "support line";

  return romanUrdu
    ? `Shukriya! Aap ka order place ho gaya hai.\n${estimated}\nUrgent help: ${contact}`
    : `Thank you! Your order has been placed.\n${estimated}\nFor urgent help: ${contact}`;
}

function validateDraftForPlacement(
  state: ConversationState,
  settings: RestaurantSettings,
):
  | { ok: true; order: PlaceableOrderPayload }
  | { ok: false; statePatch: Partial<ConversationState>; reply: (romanUrdu: boolean) => string } {
  if (state.cart.length === 0) {
    return {
      ok: false,
      statePatch: { workflow_step: "collecting_items" },
      reply: (romanUrdu) =>
        romanUrdu ? "Cart empty hai. Pehle items add karein." : "Your cart is empty. Please add items first.",
    };
  }

  if (!state.order_type) {
    return {
      ok: false,
      statePatch: { workflow_step: "awaiting_order_type" },
      reply: (romanUrdu) =>
        romanUrdu ? "Order type choose karein: Delivery ya Dine-in." : "Please choose order type: Delivery or Dine-in.",
    };
  }

  const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const deliveryFee =
    state.order_type === "delivery" && settings.delivery_enabled && settings.delivery_fee > 0
      ? Number(settings.delivery_fee)
      : 0;

  if (state.order_type === "delivery") {
    if (!settings.delivery_enabled) {
      return {
        ok: false,
        statePatch: { workflow_step: "awaiting_order_type", order_type: null },
        reply: (romanUrdu) =>
          romanUrdu
            ? "Delivery available nahi hai. Dine-in select karein."
            : "Delivery is not available right now. Please choose dine-in.",
      };
    }

    if (!state.address || state.address.trim().length < 8) {
      return {
        ok: false,
        statePatch: { workflow_step: "awaiting_delivery_address" },
        reply: (romanUrdu) =>
          romanUrdu ? "Please full delivery address bhej dein." : "Please provide your full delivery address.",
      };
    }

    if (Number(settings.min_delivery_amount) > 0 && subtotal < Number(settings.min_delivery_amount)) {
      const minAmount = Number(settings.min_delivery_amount);
      return {
        ok: false,
        statePatch: { workflow_step: "collecting_items" },
        reply: (romanUrdu) =>
          romanUrdu
            ? `Minimum delivery order Rs. ${minAmount} hai. Aap ka current subtotal Rs. ${subtotal} hai.`
            : `Minimum delivery order is Rs. ${minAmount}. Your current subtotal is Rs. ${subtotal}.`,
      };
    }

    return {
      ok: true,
      order: {
        items: state.cart,
        type: "delivery",
        subtotal,
        delivery_fee: deliveryFee,
        address: state.address,
        guests: null,
        reservation_time: null,
        customer_instructions: state.customer_instructions,
      },
    };
  }

  if (!state.guests || state.guests <= 0 || !state.reservation_time) {
    return {
      ok: false,
      statePatch: { workflow_step: "awaiting_dine_in_details" },
      reply: (romanUrdu) =>
        romanUrdu
          ? "Dine-in ke liye guests aur time required hain."
          : "Guest count and reservation time are required for dine-in.",
    };
  }

  return {
    ok: true,
    order: {
      items: state.cart,
      type: "dine-in",
      subtotal,
      delivery_fee: 0,
      address: null,
      guests: state.guests,
      reservation_time: state.reservation_time,
      customer_instructions: state.customer_instructions,
    },
  };
}

function resolveRequestedItems(
  requested: Array<{ name: string; qty: number }>,
  modelUnknown: string[],
  menuItems: MenuCatalogItem[],
  rawText: string,
  semanticMatches: SemanticMenuMatch[] = [],
): MatchedItemsResult {
  const matched: DraftCartItem[] = [];
  const unknown: string[] = [...modelUnknown];
  const ambiguous: Array<{ query: string; options: MenuCatalogItem[] }> = [];
  const customization = parseItemCustomizationFromText(rawText);

  const shouldSkipInlineAddExtraction = isLikelyRemovalOrEditMessage(rawText);
  const requests =
    requested.length > 0
      ? requested
      : shouldSkipInlineAddExtraction
        ? []
        : findInlineItems(rawText, menuItems);

  for (const request of requests) {
    if (requested.length > 0 && !isGroundedItemRequest(rawText, request.name, semanticMatches)) {
      continue;
    }

    if (requested.length > 0) {
      const disambiguationCandidates = findDisambiguationCandidatesFromRaw(rawText, request.name, menuItems);
      if (disambiguationCandidates.length > 0) {
        ambiguous.push({
          query: request.name,
          options: disambiguationCandidates,
        });
        continue;
      }
    }

    const normalizedRequest = normalizeText(request.name);
    if (!normalizedRequest) continue;

    const exact = menuItems.find((item) => normalizeText(item.name) === normalizedRequest);
    if (exact) {
      matched.push({
        name: exact.name,
        price: exact.price,
        qty: clampQty(request.qty),
        category: exact.category,
        size: customization.size,
        addons: customization.addons,
        item_instructions: customization.itemInstructions,
      });
      continue;
    }

    const candidates = menuItems
      .map((item) => {
        const normalizedItem = normalizeText(item.name);
        const lexicalScore = itemSimilarityScore(normalizedRequest, normalizedItem);
        const overlap = tokenOverlapScore(normalizedRequest, normalizedItem);
        return {
          item,
          score: Math.max(lexicalScore, overlap),
        };
      })
      .filter((entry) => entry.score >= 0.45)
      .sort((left, right) => right.score - left.score);

    if (candidates.length === 0) {
      const semanticCandidates = semanticMatches
        .filter((item) => itemSimilarityScore(normalizedRequest, normalizeText(item.name)) >= 0.3)
        .slice(0, 3);
      if (semanticCandidates.length > 0) {
        ambiguous.push({
          query: request.name,
          options: semanticCandidates.map((item) => ({
            id: item.id,
            name: item.name,
            price: item.price,
            category: item.category,
            is_available: item.is_available,
          })),
        });
        continue;
      }

      unknown.push(request.name);
      continue;
    }

    const [best] = candidates;
    const second = candidates[1];
    const similarityThreshold = 0.7; // Explicit threshold for semantic/lexical match
    if (best.score >= similarityThreshold && (!second || best.score - second.score >= 0.12)) {
      matched.push({
        name: best.item.name,
        price: best.item.price,
        qty: clampQty(request.qty),
        category: best.item.category,
        size: customization.size,
        addons: customization.addons,
        item_instructions: customization.itemInstructions,
      });
      continue;
    }

    ambiguous.push({
      query: request.name,
      options: candidates.slice(0, 3).map((entry) => entry.item),
    });
  }

  return {
    matched: mergeCartItems([], matched),
    unknown: [...new Set(unknown)].slice(0, 5),
    ambiguous,
  };
}

function isLikelyRemovalOrEditMessage(rawText: string): boolean {
  const normalized = normalizeText(rawText);
  if (!normalized) return false;

  return (
    /(remove|delete|without|minus|cancel|kam kar|kam kr|nikaal|nikal)/.test(normalized) ||
    /(qty|quantity|set|update|change|replace|instead)/.test(normalized)
  );
}

function findDisambiguationCandidatesFromRaw(
  rawText: string,
  requestName: string,
  menuItems: MenuCatalogItem[],
): MenuCatalogItem[] {
  const normalizedRaw = normalizeText(rawText);
  const normalizedRequest = normalizeText(requestName);
  if (!normalizedRaw || !normalizedRequest) return [];
  if (isLikelySelectionCommand(normalizedRaw)) return [];
  if (extractAnyQuantity(normalizedRaw) != null) return [];

  const rawTokens = normalizedRaw.split(/\s+/).filter(Boolean);
  const requestTokens = normalizedRequest.split(/\s+/).filter(Boolean);
  const hasQualifierNotInRaw = requestTokens.some(
    (token) => token.length >= 4 && !rawTokens.includes(token),
  );

  const rankedByRaw = menuItems
    .map((item) => ({
      item,
      score: itemSimilarityScore(normalizedRaw, normalizeText(item.name)),
    }))
    .filter((entry) => entry.score >= 0.45)
    .sort((left, right) => right.score - left.score);

  if (rankedByRaw.length < 2) return [];

  const best = rankedByRaw[0];
  const second = rankedByRaw[1];
  const exactTypedMatch = normalizeText(best.item.name) === normalizedRaw;
  if (exactTypedMatch && !hasQualifierNotInRaw) return [];

  const broadText = rawTokens.length <= 3;
  const weakLead = best.score < 0.82;
  const closeAlternatives = Boolean(second && best.score - second.score < 0.12);
  const shouldDisambiguate = hasQualifierNotInRaw || broadText || weakLead || closeAlternatives;

  if (!shouldDisambiguate) return [];

  return rankedByRaw.slice(0, 3).map((entry) => entry.item);
}

function findInlineItems(rawText: string, menuItems: MenuCatalogItem[]): Array<{ name: string; qty: number }> {
  const normalized = normalizeText(rawText);
  if (!normalized) return [];

  const normalizedCompact = normalizeCompact(rawText);
  const queryTokens = tokenizeForMenuMatching(rawText);
  const broadQuery =
    queryTokens.length <= 1 || (queryTokens.length === 2 && queryTokens.every((token) => GENERIC_FOOD_TOKENS.has(token)));

  const ranked = menuItems
    .map((item) => {
      const normalizedName = normalizeText(item.name);
      if (!normalizedName) return null;

      const normalizedComposite = normalizeText(`${item.name} ${item.category ?? ""}`);
      const itemCompact = normalizeCompact(item.name);
      const exactScore = normalized === normalizedName ? 1 : 0;
      const phraseScore = normalized.includes(normalizedName) ? 0.98 : 0;
      const compactScore =
        itemCompact.length >= 6 && normalizedCompact.includes(itemCompact)
          ? 0.9
          : 0;
      const score = Math.max(
        exactScore,
        phraseScore,
        compactScore,
        itemSimilarityScore(normalized, normalizedComposite),
        tokenOverlapScore(normalized, normalizedComposite),
      );

      return {
        item,
        normalizedName,
        score,
      };
    })
    .filter((entry): entry is { item: MenuCatalogItem; normalizedName: string; score: number } => Boolean(entry))
    .filter((entry) => entry.score >= 0.62)
    .sort((left, right) => right.score - left.score);

  if (ranked.length === 0) return [];

  const best = ranked[0];
  const second = ranked[1];
  if (best.score < 0.74) return [];
  if (broadQuery && best.score < 0.9) return [];
  if (second && best.score - second.score < 0.08 && best.score < 0.9) return [];

  return [
    {
      name: best.item.name,
      qty: extractQuantityNearPhrase(normalized, best.normalizedName) ?? extractAnyQuantity(normalized) ?? 1,
    },
  ];
}

function isGroundedItemRequest(rawText: string, requestName: string, semanticMatches: SemanticMenuMatch[]): boolean {
  const normalizedRaw = normalizeText(rawText);
  const normalizedRequest = normalizeText(requestName);
  if (!normalizedRaw || !normalizedRequest) return false;

  if (normalizedRaw.includes(normalizedRequest)) return true;
  const compactRaw = normalizeCompact(rawText);
  const compactRequest = normalizeCompact(requestName);
  if (compactRaw && compactRequest && compactRaw.includes(compactRequest)) return true;

  const requestTokens = normalizedRequest.split(" ").filter((token) => token.length >= 4);
  const nonGenericRequestTokens = requestTokens.filter((token) => !GENERIC_FOOD_TOKENS.has(token));
  if (nonGenericRequestTokens.some((token) => normalizedRaw.includes(token))) return true;
  if (requestTokens.length > 0 && nonGenericRequestTokens.length === 0) {
    // Query only contains generic tokens like "chicken"; do not auto-ground to a
    // specific item unless the entire phrase matches (handled above).
    return false;
  }
  if (tokenOverlapScore(normalizedRaw, normalizedRequest) >= 0.6) return true;

  return semanticMatches.some(
    (match) =>
      normalizeText(match.name) === normalizedRequest &&
      (match.similarity ?? 0) >= 0.72,
  );
}

function findLikelyMenuSuggestions(text: string, menuItems: MenuCatalogItem[], limit = 3): MenuCatalogItem[] {
  const normalized = normalizeText(text);
  const queryTokens = normalized
    .split(/\s+/)
    .filter((token) => token.length > 1 && !MENU_LOOKUP_FILLER_WORDS.has(token));
  if (queryTokens.length === 0) return [];
  const queryTokenCompacts = queryTokens.map((token) => token.replace(/\s+/g, ""));

  // First, find items that contain all the query terms
  const containingItems = menuItems.filter((item) => {
    const normalizedItem = normalizeText(`${item.name} ${item.category ?? ""}`);
    const normalizedItemCompact = normalizeCompact(`${item.name} ${item.category ?? ""}`);
    return queryTokens.every((token, index) =>
      normalizedItem.includes(token) ||
      (queryTokenCompacts[index].length >= 4 && normalizedItemCompact.includes(queryTokenCompacts[index])),
    );
  });

  if (containingItems.length > 0) {
    // Return all containing items, up to the limit
    return containingItems.slice(0, limit);
  }

  // Fallback: find items that contain any of the query terms
  const partialMatches = menuItems.filter((item) => {
    const normalizedItem = normalizeText(`${item.name} ${item.category ?? ""}`);
    const normalizedItemCompact = normalizeCompact(`${item.name} ${item.category ?? ""}`);
    return queryTokens.some((token, index) =>
      (normalizedItem.includes(token) || normalizedItemCompact.includes(queryTokenCompacts[index])) && token.length > 2,
    );
  });

  if (partialMatches.length > 0) {
    return partialMatches
      .map((item) => ({
        item,
        score: queryTokens.filter((token, index) =>
          normalizeText(`${item.name} ${item.category ?? ""}`).includes(token) ||
          normalizeCompact(`${item.name} ${item.category ?? ""}`).includes(queryTokenCompacts[index]),
        ).length,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.item);
  }

  // Fallback to similarity scoring
  return menuItems
    .map((item) => {
      const normalizedItem = normalizeText(`${item.name} ${item.category ?? ""}`);
      return {
        item,
        score: Math.max(
          itemSimilarityScore(normalized, normalizedItem),
          tokenOverlapScore(normalized, normalizedItem),
        ),
      };
    })
    .filter((entry) => entry.score >= 0.25) // Lowered threshold for better matching
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

function resolveRemovalRequests(
  interpretation: OrderTurnInterpretation,
  cart: DraftCartItem[],
  rawText: string,
): CartRemovalRequest[] {
  const interpretedRequests: CartRemovalRequest[] = [];
  if (cart.length === 0) return interpretedRequests;

  for (const removal of interpretation.remove_items) {
    const matched = findCartMatch(removal.name, cart);
    if (!matched) continue;
    interpretedRequests.push({
      name: matched.name,
      qty: removal.qty === "all" ? "all" : clampQty(removal.qty),
    });
  }

  const directRequests = extractDirectRemovalRequests(rawText, cart);
  if (directRequests.length === 0) {
    return mergeRemovalRequests(interpretedRequests);
  }

  // User-typed direct removals should override AI-interpreted removals
  // for the same item, especially for explicit quantities like "remove 2 kheer".
  const directKeys = new Set(directRequests.map((request) => normalizeText(request.name)));
  const filteredInterpreted = interpretedRequests.filter(
    (request) => !directKeys.has(normalizeText(request.name)),
  );

  return mergeRemovalRequests([...filteredInterpreted, ...directRequests]);
}

function resolveQuantityUpdates(rawText: string, cart: DraftCartItem[]): CartQtyUpdate[] {
  if (cart.length === 0) return [];

  const normalized = normalizeText(rawText);
  const updates: CartQtyUpdate[] = [];
  const explicitMatch = rawText.match(/(?:set|update|change|qty|quantity)\s+(.+?)\s*(?:to|x|=)\s*(\d{1,2})/i);
  if (explicitMatch) {
    const match = findCartMatch(explicitMatch[1], cart);
    const qty = clampQty(Number.parseInt(explicitMatch[2], 10));
    if (match) {
      updates.push({ name: match.name, qty });
    }
  }

  const quantityOnlyMatch = normalized.match(/(?:quantity|qty)\s*(?:to|is|=)?\s*(\d{1,2})/);
  if (quantityOnlyMatch && cart.length > 0) {
    const qty = clampQty(Number.parseInt(quantityOnlyMatch[1], 10));
    updates.push({ name: cart[cart.length - 1].name, qty });
  }

  const increment = inferQuantityIncrement(normalized);
  if (increment != null) {
    const target = findCartItemMentionedInText(normalized, cart) ?? cart[cart.length - 1];
    if (target) {
      updates.push({
        name: target.name,
        qty: clampQty(target.qty + increment),
      });
    }
  }

  const byName = new Map<string, CartQtyUpdate>();
  for (const update of updates) {
    byName.set(normalizeText(update.name), update);
  }
  return [...byName.values()];
}

function inferQuantityIncrement(normalizedText: string): number | null {
  const hasIncrementSignal =
    /\b(aik aur|ek aur|one more|aur kar|aur kr|aur kar do|increase|barha|barhao)\b/.test(normalizedText);
  if (!hasIncrementSignal) return null;

  const qty = extractAnyQuantity(normalizedText);
  if (qty != null && qty > 0) {
    return clampQty(qty);
  }

  return 1;
}

function findCartItemMentionedInText(normalizedText: string, cart: DraftCartItem[]): DraftCartItem | null {
  for (const item of cart) {
    const itemName = normalizeText(item.name);
    if (!itemName) continue;
    if (normalizedText.includes(itemName)) return item;
  }
  return null;
}

function extractDirectRemovalRequests(rawText: string, cart: DraftCartItem[]): CartRemovalRequest[] {
  if (cart.length === 0) return [];
  const normalized = normalizeText(rawText);
  if (!/(remove|delete|without|minus|cancel|kam kar|kam kr)/.test(normalized)) {
    return [];
  }

  const requests: CartRemovalRequest[] = [];

  // Handle specific quantity removals like "remove 2 biryanis" or "kulfi 2 kam kar do"
  const specificQtyPattern = /(?:remove|delete|cancel|kam kar|kam kr)\s+(\d{1,2})\s+(.+?)(?:\s|$)/i;
  const specificMatch = rawText.match(specificQtyPattern);
  if (specificMatch) {
    const qty = Number.parseInt(specificMatch[1], 10);
    const itemText = specificMatch[2];
    const matched = findCartMatch(itemText, cart);
    if (matched) {
      requests.push({
        name: matched.name,
        qty: clampQty(qty),
      });
    }
    return requests; // Return early if we found a specific match
  }

  // Handle general removals
  const qty = extractAnyQuantity(normalized);
  const removeAll = /\b(all|saara|sara|poora|whole|saare|sare)\b/.test(normalized);

  for (const item of cart) {
    const itemName = normalizeText(item.name);
    if (!itemName) continue;
    if (!normalized.includes(itemName)) continue;
    requests.push({
      name: item.name,
      qty: removeAll ? "all" : qty != null ? clampQty(qty) : "all",
    });
  }

  return requests;
}

function findCartMatch(name: string, cart: DraftCartItem[]): DraftCartItem | null {
  const normalized = normalizeText(name);
  const exact = cart.find((item) => normalizeText(item.name) === normalized);
  if (exact) return exact;

  const candidates = cart
    .map((item) => ({
      item,
      score: itemSimilarityScore(normalized, normalizeText(item.name)),
    }))
    .filter((entry) => entry.score >= 0.45)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.item ?? null;
}

function mergeRemovalRequests(requests: CartRemovalRequest[]): CartRemovalRequest[] {
  const byName = new Map<string, CartRemovalRequest>();

  for (const request of requests) {
    const key = normalizeText(request.name);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, request);
      continue;
    }

    if (existing.qty === "all" || request.qty === "all") {
      byName.set(key, { name: request.name, qty: "all" });
      continue;
    }

    byName.set(key, {
      name: request.name,
      qty: existing.qty + request.qty,
    });
  }

  return [...byName.values()];
}

function mutateCart(
  currentCart: DraftCartItem[],
  additions: DraftCartItem[],
  removals: CartRemovalRequest[],
): {
  cart: DraftCartItem[];
  removed: Array<{ name: string; removedQty: number }>;
} {
  const cart = mergeCartItems(currentCart, additions);
  const removed: Array<{ name: string; removedQty: number }> = [];

  for (const removal of removals) {
    const index = cart.findIndex((item) => normalizeText(item.name) === normalizeText(removal.name));
    if (index < 0) continue;

    const item = cart[index];
    if (removal.qty === "all" || removal.qty >= item.qty) {
      removed.push({ name: item.name, removedQty: item.qty });
      cart.splice(index, 1);
      continue;
    }

    item.qty -= removal.qty;
    removed.push({ name: item.name, removedQty: removal.qty });
  }

  return { cart, removed };
}

function applyCartQtyUpdates(
  currentCart: DraftCartItem[],
  updates: CartQtyUpdate[],
): DraftCartItem[] {
  if (updates.length === 0) return currentCart;

  const updated = currentCart.map((item) => ({ ...item }));
  for (const change of updates) {
    const target = updated.find((item) => normalizeText(item.name) === normalizeText(change.name));
    if (!target) continue;
    target.qty = clampQty(change.qty);
  }

  return updated;
}

function mergeCartItems(current: DraftCartItem[], additions: DraftCartItem[]): DraftCartItem[] {
  const merged = current.map((item) => ({ ...item }));
  for (const addition of additions) {
    const existing = merged.find((item) => isSameDraftItem(item, addition));
    if (existing) {
      existing.qty += addition.qty;
    } else {
      merged.push({ ...addition });
    }
  }
  return merged;
}

function clampQty(qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 1;
  return Math.max(1, Math.min(Math.floor(qty), 50));
}

function findPresentedOptionByDirectValue(rawText: string, options: MenuCatalogItem[]): MenuCatalogItem | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const byId = options.find((item) => item.id === trimmed);
  if (byId) return byId;

  const normalized = normalizeText(trimmed);
  if (!normalized) return null;
  const exactByName = options.find((item) => normalizeText(item.name) === normalized);
  if (exactByName) return exactByName;

  const ranked = options
    .map((item) => {
      const normalizedName = normalizeText(item.name);
      return {
        item,
        score: Math.max(
          itemSimilarityScore(normalized, normalizedName),
          tokenOverlapScore(normalized, normalizedName),
        ),
      };
    })
    .filter((entry) => entry.score >= 0.72)
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  const second = ranked[1];
  if (!best) return null;
  if (!second || best.score - second.score >= 0.08) {
    return best.item;
  }
  return null;
}

function shouldDeferToContextSwitchFallback(
  rawText: string,
  normalizedText: string,
  interpretation: OrderTurnInterpretation,
): boolean {
  if (isExplicitYes(normalizedText) || isExplicitNo(normalizedText)) {
    return false;
  }

  if (
    interpretation.order_type != null ||
    interpretation.wants_confirmation != null ||
    interpretation.add_items.length > 0 ||
    interpretation.remove_items.length > 0 ||
    interpretation.address != null ||
    interpretation.guests != null ||
    interpretation.reservation_time != null
  ) {
    return false;
  }

  if (
    interpretation.intent === "set_order_type" ||
    interpretation.intent === "provide_address" ||
    interpretation.intent === "provide_dine_in_details" ||
    interpretation.intent === "modify_order" ||
    interpretation.intent === "confirm_order" ||
    interpretation.intent === "cancel_order"
  ) {
    return false;
  }

  if (!isLikelyQuestionMessage(rawText)) {
    return false;
  }

  return interpretation.intent === "unknown" || interpretation.intent === "chitchat";
}

function isLikelyQuestionMessage(rawText: string): boolean {
  const normalized = normalizeText(rawText);
  if (!normalized) return false;

  if (/[?\u061F]/.test(rawText)) return true;

  if (
    /^(what|how|when|where|why|which|who|can|could|would|do|does|is|are|kya|kaise|kab|kahan|kitna|kitne)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  return /\b(price|timing|open|close|location|address|phone|contact|charges|fee|minimum)\b/.test(normalized);
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isLikelySelectionCommand(normalizedText: string): boolean {
  if (!normalizedText) return false;

  if (/^(?:\d{1,2})$/.test(normalizedText)) return true;
  if (/^(?:\d{1,2})\s*(?:x|qty|quantity|times)\s*\d{1,2}$/.test(normalizedText)) return true;
  if (/^(?:option|item|no|number)\s*\d{1,2}$/.test(normalizedText)) return true;
  if (/^(?:option|item|no|number)\s*\d{1,2}\s*(?:x|qty|quantity|times)\s*\d{1,2}$/.test(normalizedText)) return true;
  if (/^category[_\s-]?option[_\s-]?\d{1,2}$/i.test(normalizedText)) return true;

  return false;
}

function parseSelectionWithQty(
  text: string,
  optionCount: number,
): { optionIndex: number; qty: number } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // These are control payloads from interactive lists/flows, not item picks.
  // Let dedicated handlers route them instead of turning them into option numbers.
  if (
    /^(?:category[_\s-]?(?:option|more)[_\s-]?\d{1,2}|city[_\s-]?option[_\s-]?\d{1,2}|branch[_\s-]?option[_\s-]?\d{1,2}|order[_\s-]?type[_\s-]?(?:delivery|dine[_\s-]?in)|qty[_\s-]?(?:option|pick)[_\s-]?\d{1,2}|qty[_\s-]?custom|__qty_pick__:(?:\d{1,2}|custom))$/i.test(
      trimmed,
    )
  ) {
    return null;
  }

  const normalized = normalizeText(trimmed);

  if (isLikelyQuestionMessage(trimmed) && !isLikelySelectionCommand(normalized)) {
    return null;
  }

  const explicitPair = normalized.match(
    /(?:^|\b)(?:option|item|no|number)?\s*(\d{1,2})(?:\s*(?:x|qty|quantity|times)\s*|[\s,]+)(\d{1,2})(?:\b|$)/i,
  );
  if (explicitPair) {
    const option = Number.parseInt(explicitPair[1], 10);
    const qty = Number.parseInt(explicitPair[2], 10);
    if (option >= 1 && option <= optionCount && qty >= 1) {
      return { optionIndex: option - 1, qty: clampQty(qty) };
    }
  }

  const numbers = [...normalized.matchAll(/\b(\d{1,2})\b/g)].map((match) => Number.parseInt(match[1], 10));
  if (numbers.length === 0) {
    const ordinalMap: Record<string, number> = {
      first: 1,
      second: 2,
      third: 3,
      fourth: 4,
      fifth: 5,
      pehla: 1,
      pehli: 1,
      pehle: 1,
      doosra: 2,
      dosra: 2,
      dusra: 2,
      teesra: 3,
    };
    for (const [token, option] of Object.entries(ordinalMap)) {
      if (new RegExp(`\\b${token}\\b`).test(normalized) && option <= optionCount) {
        return { optionIndex: option - 1, qty: 1 };
      }
    }
  }
  if (numbers.length === 1) {
    const option = numbers[0];
    if (option >= 1 && option <= optionCount) {
      return { optionIndex: option - 1, qty: 1 };
    }
    return null;
  }

  if (numbers.length >= 2) {
    const option = numbers[0];
    const qty = numbers[1];
    if (option >= 1 && option <= optionCount && qty >= 1) {
      return { optionIndex: option - 1, qty: clampQty(qty) };
    }
  }

  return null;
}

function inferLastItemQtyOverride(normalizedText: string, state: ConversationState): number | null {
  if (state.cart.length === 0) return null;
  const qty = extractAnyQuantity(normalizedText);
  if (qty == null) return null;

  const hasOnlySignal =
    /(sirf|sirf aik|only|just|bas|chahiye|chahye|chaheye|i need|need only|quantity|qty|itni|itna)/.test(normalizedText) ||
    normalizedText === String(qty);

  if (!hasOnlySignal) return null;
  return clampQty(qty);
}

function inferGeneralQtyOverride(normalizedText: string, state: ConversationState): { name: string; qty: number } | null {
  if (state.cart.length === 0) return null;

  // Check for explicit "item X qty" patterns
  const explicitMatch = normalizedText.match(/(.+?)\s*(?:qty|quantity|qnt|qnty|qt)\s*(\d{1,2})\b/i) ||
                       normalizedText.match(/(.+?)\s*x\s*(\d{1,2})\b/i) ||
                       normalizedText.match(/(\d{1,2})\s*(.+?)\b/i);
  if (explicitMatch) {
    const itemPart = explicitMatch[1].trim();
    const qtyPart = explicitMatch[2];
    const qty = clampQty(Number.parseInt(qtyPart, 10));
    const matched = findCartMatch(itemPart, state.cart);
    if (matched) {
      return { name: matched.name, qty };
    }
  }

  // Check for increment/decrement patterns like "kulfi 4 kr dain" or "aik kulfi kam kr dain"
  const incrementMatch = normalizedText.match(/(.+?)\s+(\d{1,2})\s+(kr dain|kar dain|kar do|kr do)/i);
  if (incrementMatch) {
    const itemPart = incrementMatch[1].trim();
    const qty = clampQty(Number.parseInt(incrementMatch[2], 10));
    const matched = findCartMatch(itemPart, state.cart);
    if (matched) {
      return { name: matched.name, qty };
    }
  }

  const decrementMatch = normalizedText.match(/(.+?)\s+(aik|ek|one)\s+(kam kr dain|kam kar dain|kam kr do|kam kar do|minus|ghatana)/i);
  if (decrementMatch) {
    const itemPart = decrementMatch[1].trim();
    const matched = findCartMatch(itemPart, state.cart);
    if (matched) {
      return { name: matched.name, qty: Math.max(1, matched.qty - 1) };
    }
  }

  // Check for "X more" or "X less" patterns
  const moreMatch = normalizedText.match(/(.+?)\s+(\d{1,2})\s+(aur|more|zyada)/i);
  if (moreMatch) {
    const itemPart = moreMatch[1].trim();
    const additional = Number.parseInt(moreMatch[2], 10);
    const matched = findCartMatch(itemPart, state.cart);
    if (matched) {
      return { name: matched.name, qty: clampQty(matched.qty + additional) };
    }
  }

  const lessMatch = normalizedText.match(/(.+?)\s+(\d{1,2})\s+(kam|less|kum)/i);
  if (lessMatch) {
    const itemPart = lessMatch[1].trim();
    const reduction = Number.parseInt(lessMatch[2], 10);
    const matched = findCartMatch(itemPart, state.cart);
    if (matched) {
      return { name: matched.name, qty: Math.max(1, matched.qty - reduction) };
    }
  }

  return null;
}

function applyQtyOverride(cart: DraftCartItem[], name: string, qty: number): DraftCartItem[] {
  const updated = cart.map((item) => ({ ...item }));
  const index = updated.findIndex((item) => normalizeText(item.name) === normalizeText(name));
  if (index >= 0) {
    updated[index].qty = qty;
  }
  return updated;
}

function applyLastItemQtyOverride(cart: DraftCartItem[], qty: number): DraftCartItem[] {
  const updated = cart.map((item) => ({ ...item }));
  const lastIndex = updated.length - 1;
  updated[lastIndex].qty = qty;
  return updated;
}


