import { getOrderTurnInterpretation, type OrderTurnInterpretation } from "./ai";
import type { SemanticMenuMatch } from "./semantic-menu";
import {
  buildRestaurantDateTimeIso,
  getRestaurantNowParts,
  parseRestaurantClock,
  type RestaurantSettings,
} from "./settings";
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
    .select("order_number, status, type, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    order_number: data.order_number,
    status: data.status,
    type: data.type,
    created_at: data.created_at,
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
  order_number: number;
  status: string;
  type: OrderType;
  created_at: string;
}

export interface PlaceableOrderPayload {
  items: DraftCartItem[];
  type: OrderType;
  subtotal: number;
  delivery_fee: number;
  address: string | null;
  guests: number | null;
  reservation_time: string | null;
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
  "kar do",
  "kr do",
  "place",
  "done",
];

const NO_WORDS = ["no", "nah", "nahi", "nahin", "skip", "cancel", "stop"];
const RESTART_WORDS = ["restart", "start over", "new order", "fresh order", "naya order", "phir se"];
const CONTINUE_WORDS = ["continue", "resume", "same order", "carry on"];
const CANCEL_WORDS = ["cancel order", "stop order", "rehne do", "forget it", "leave it"];

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  ek: 1,
  aik: 1,
  do: 2,
  teen: 3,
  char: 4,
  chaar: 4,
  panj: 5,
  paanch: 5,
  cheh: 6,
  chay: 6,
  saat: 7,
  aath: 8,
  ath: 8,
  das: 10,
};

const MENU_TOKEN_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "please",
  "pls",
  "with",
  "without",
  "and",
  "or",
  "my",
  "for",
  "item",
  "items",
  "dish",
  "food",
  "menu",
  "order",
  "add",
  "remove",
  "qty",
  "quantity",
]);

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

const PRESENTED_OPTIONS_TTL_MS = 20 * 60 * 1000;

function isShortAcknowledgment(normalizedText: string): boolean {
  const trimmed = normalizedText.trim();
  if (!trimmed) return false;
  if (trimmed.split(/\s+/).length > 3) return false;
  return /\b(ok|okay|k|thanks|thank\s*you|shukriya|theek|fine|good|alright|sure|haan|han|na|nahi)\b/i.test(trimmed);
}

const ADDRESS_HINTS = [
  "street",
  "st",
  "road",
  "rd",
  "house",
  "flat",
  "apartment",
  "block",
  "sector",
  "phase",
  "lane",
  "gali",
  "mohalla",
  "near",
  "opposite",
  "plot",
];

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

const STALE_DRAFT_HOURS = 4;

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
  };
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
    if (containsAny(normalizedText, RESTART_WORDS) || containsAny(normalizedText, CANCEL_WORDS)) {
      return replyDecision(
        prefersRomanUrdu
          ? "Theek hai, purana draft remove kar diya. Naya order bhej dein."
          : "Sure, I cleared your old draft. Send your new order whenever you're ready.",
        withPreferredLanguage(resetDraftState(), preferredLanguage),
      );
    }

    if (containsAny(normalizedText, CONTINUE_WORDS) || isExplicitYes(normalizedText)) {
      const resumedStep = getResumeWorkflowStep(state);
      const resumedState = {
        ...state,
        workflow_step: resumedStep,
        resume_workflow_step: null,
      };
      return replyDecision(
        buildResumePrompt(resumedState, prefersRomanUrdu),
        withPreferredLanguage(
          {
            workflow_step: resumedStep,
            resume_workflow_step: null,
          },
          preferredLanguage,
        ),
      );
    }

    return replyDecision(
      buildStaleDraftPrompt(state, prefersRomanUrdu),
      withPreferredLanguage(
        {
          workflow_step: "awaiting_resume_decision",
          resume_workflow_step: getResumeWorkflowStep(state),
        },
        preferredLanguage,
      ),
    );
  }

  if (shouldPromptForStaleDraftChoice(state)) {
    if (!containsAny(normalizedText, CONTINUE_WORDS) && !containsAny(normalizedText, RESTART_WORDS) && !isExplicitYes(normalizedText)) {
      return replyDecision(
        buildStaleDraftPrompt(state, prefersRomanUrdu),
        withPreferredLanguage(
          {
            workflow_step: "awaiting_resume_decision",
            resume_workflow_step: state.workflow_step,
          },
          preferredLanguage,
        ),
      );
    }
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
  if (containsAny(normalizedText, CONTINUE_WORDS)) {
    interpretation.wants_continue = true;
    interpretation.intent = "continue_order";
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
    !expectsStructuredCheckoutInput(state.workflow_step) &&
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
    return handleAwaitingConfirmation({
      context,
      interpretation,
      matchedAdds,
      removeRequests,
      qtyUpdates,
      preferredLanguage,
      trace,
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

  if (state.last_presented_options && state.last_presented_options.length > 0 && isPresentedOptionsFresh(state)) {
    const directSelection = findPresentedOptionByDirectValue(rawText, state.last_presented_options);
    if (directSelection) {
      matchedAdds.matched.push({
        name: directSelection.name,
        qty: 1,
        price: directSelection.price,
        category: directSelection.category,
      });
    }

    const selection = parseSelectionWithQty(rawText, state.last_presented_options.length);
    if (selection) {
      const selected = state.last_presented_options[selection.optionIndex];
      matchedAdds.matched.push({
        name: selected.name,
        qty: selection.qty,
        price: selected.price,
        category: selected.category,
      });
    }
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

  return handleLogisticsAndFallback({
    context,
    interpretation,
    matchedAdds,
    preferredLanguage,
    trace,
  });
}

function handleAwaitingConfirmation(params: {
  context: TurnContext;
  interpretation: OrderTurnInterpretation;
  matchedAdds: MatchedItemsResult;
  removeRequests: CartRemovalRequest[];
  qtyUpdates: CartQtyUpdate[];
  preferredLanguage: LanguagePreference;
  trace: TurnTrace;
}): TurnDecision {
  const { context, interpretation, matchedAdds, removeRequests, qtyUpdates, preferredLanguage, trace } = params;
  const state = context.state;
  const normalizedText = normalizeText(context.messageText);
  const prefersRomanUrdu = preferredLanguage === "roman_urdu";

  if (interpretation.wants_confirmation === true || isExplicitYes(normalizedText)) {
    const validation = validateDraftForPlacement(state, context.settings);
    if (validation.ok === false) {
      return replyDecision(
        validation.reply(prefersRomanUrdu),
        withPreferredLanguage(validation.statePatch, preferredLanguage),
        trace,
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
      trace,
    };
  }

  if (
    interpretation.wants_confirmation === false ||
    interpretation.intent === "modify_order" ||
    interpretation.intent === "add_items" ||
    matchedAdds.matched.length > 0 ||
    removeRequests.length > 0 ||
    qtyUpdates.length > 0 ||
    isExplicitNo(normalizedText)
  ) {
    const mutated = mutateCart(state.cart, matchedAdds.matched, removeRequests);
    const cartWithQtyUpdates = applyCartQtyUpdates(mutated.cart, qtyUpdates);
    if (cartWithQtyUpdates.length === 0) {
      return replyDecision(
        prefersRomanUrdu
          ? "Theek hai, cart empty ho gayi. Naya item bhej dein."
          : "Done, your cart is now empty. Send an item to start again.",
        withPreferredLanguage(resetDraftState(), preferredLanguage),
        trace,
      );
    }

    const nextStateBase: ConversationState = {
      ...state,
      cart: cartWithQtyUpdates,
      workflow_step: "collecting_items",
      summary_sent_at: null,
      preferred_language: preferredLanguage,
    };
    const nextState = applyCheckoutSignalsToState({
      state: nextStateBase,
      interpretation,
      rawText: context.messageText,
      settings: context.settings,
    });

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

  const askedForEditsWithoutResolvedItems =
    interpretation.add_items.length > 0 ||
    /(?:\badd\b|\baur\b|\bbhi\b|\bplus\b|kar do|kr do|remove|delete|minus|kam kr|kam kar)/.test(normalizedText);
  if (askedForEditsWithoutResolvedItems) {
    const unresolvedUnknown = [
      ...matchedAdds.unknown,
      ...interpretation.unknown_items,
      ...interpretation.add_items.map((item) => item.name),
    ]
      .map((value) => value.trim())
      .filter(Boolean);
    const uniqueUnknown = [...new Set(unresolvedUnknown)].slice(0, 3);
    const unknownReply = buildUnknownItemReplyData(
      uniqueUnknown.length > 0 ? uniqueUnknown : [context.messageText],
      context.menuItems,
      prefersRomanUrdu,
      context.semanticMatches,
    );

    return replyDecision(
      unknownReply.text,
      withPreferredLanguage(
        {
          workflow_step: "collecting_items",
          summary_sent_at: null,
          last_presented_options: unknownReply.selectableItems,
          last_presented_options_at: unknownReply.selectableItems.length > 0 ? new Date().toISOString() : null,
        },
        preferredLanguage,
      ),
      trace,
    );
  }

  if (shouldDeferToContextSwitchFallback(context.messageText, normalizedText, interpretation)) {
    return {
      kind: "fallback",
      statePatch: withPreferredLanguage({ workflow_step: "awaiting_confirmation" }, preferredLanguage),
      trace,
    };
  }

  return replyDecision(
    prefersRomanUrdu
      ? "Order confirm karne ke liye *Haan* likhein, ya changes batayein."
      : "Reply *Yes* to confirm your order, or tell me what to change.",
    withPreferredLanguage({}, preferredLanguage),
    trace,
  );
}

function handleLogisticsAndFallback(params: {
  context: TurnContext;
  interpretation: OrderTurnInterpretation;
  matchedAdds: MatchedItemsResult;
  preferredLanguage: LanguagePreference;
  trace: TurnTrace;
}): TurnDecision {
  const { context, interpretation, matchedAdds, preferredLanguage, trace } = params;
  const state = context.state;
  const prefersRomanUrdu = preferredLanguage === "roman_urdu";
  const normalizedText = normalizeText(context.messageText);

  if (
    (state.workflow_step === "awaiting_order_type" ||
      state.workflow_step === "awaiting_delivery_address" ||
      state.workflow_step === "awaiting_dine_in_details" ||
      state.workflow_step === "awaiting_confirmation") &&
    state.cart.length === 0
  ) {
    return replyDecision(
      prefersRomanUrdu
        ? "Cart empty hai. Please pehle item add karein."
        : "Your cart is empty. Please add an item first.",
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

  if (state.workflow_step === "awaiting_upsell_reply") {
    const isYesReply = isUpsellYes(normalizedText);
    const isNoReply = isUpsellNo(normalizedText);

    if (isYesReply && state.upsell_item_name && state.upsell_item_price != null) {
      const sourceItem = context.menuItems.find(
        (item) => normalizeText(item.name) === normalizeText(state.upsell_item_name ?? ""),
      );
      const upsellItem: DraftCartItem = {
        name: state.upsell_item_name,
        qty: 1,
        price: state.upsell_item_price,
        category: sourceItem?.category ?? null,
      };
      const nextCart = mergeCartItems(state.cart, [upsellItem]);

      return replyDecision(
        [
          prefersRomanUrdu
            ? `Theek hai, ${upsellItem.name} add kar diya.`
            : `Great, I added ${upsellItem.name}.`,
          buildOrderTypePrompt(context.settings.delivery_enabled, prefersRomanUrdu),
        ].join("\n\n"),
        withPreferredLanguage(
          {
            cart: nextCart,
            workflow_step: "awaiting_order_type",
            upsell_item_name: null,
            upsell_item_price: null,
          },
          preferredLanguage,
        ),
        trace,
        buildOrderTypeInteractiveList(prefersRomanUrdu, context.settings.delivery_enabled),
      );
    }

    if (isNoReply || !state.upsell_item_name) {
      const declined = state.upsell_item_name
        ? [...new Set([...state.declined_upsells, state.upsell_item_name])]
        : state.declined_upsells;

      return replyDecision(
        prefersRomanUrdu
          ? `Theek hai, upsell skip kar diya. ${buildOrderTypePrompt(context.settings.delivery_enabled, prefersRomanUrdu)}`
          : `No problem, skipped. ${buildOrderTypePrompt(context.settings.delivery_enabled, prefersRomanUrdu)}`,
        withPreferredLanguage(
          {
            workflow_step: "awaiting_order_type",
            upsell_item_name: null,
            upsell_item_price: null,
            declined_upsells: declined,
          },
          preferredLanguage,
        ),
        trace,
        buildOrderTypeInteractiveList(prefersRomanUrdu, context.settings.delivery_enabled),
      );
    }

    if (shouldDeferToContextSwitchFallback(context.messageText, normalizedText, interpretation)) {
      return {
        kind: "fallback",
        statePatch: withPreferredLanguage({ workflow_step: "awaiting_upsell_reply" }, preferredLanguage),
        trace,
      };
    }

    const upsellInteractive = buildUpsellInteractiveList(prefersRomanUrdu, state.upsell_item_name || undefined, state.upsell_item_price || undefined);
    return replyDecision(
      prefersRomanUrdu
        ? `*${state.upsell_item_name}* add karna chahenge?`
        : `Would you like to add *${state.upsell_item_name}*?`,
      withPreferredLanguage({ workflow_step: "awaiting_upsell_reply" }, preferredLanguage),
      trace,
      upsellInteractive,
    );
  }

  if (state.workflow_step === "awaiting_order_type") {
    const quickOrderType = parseOrderTypeShortcut(normalizedText);
    if (quickOrderType) {
      return handleOrderTypeSelection(context, state, preferredLanguage, quickOrderType, trace);
    }

    const generalQtyOverride = inferGeneralQtyOverride(normalizedText, state);
    if (generalQtyOverride) {
      const updatedCart = applyQtyOverride(state.cart, generalQtyOverride.name, generalQtyOverride.qty);
      return replyDecision(
        [
          prefersRomanUrdu
            ? `Theek hai, maine quantity update kar di: ${generalQtyOverride.name} x${generalQtyOverride.qty}.`
            : `Done, quantity updated: ${generalQtyOverride.name} x${generalQtyOverride.qty}.`,
          !context.isOpenNow
            ? buildClosedReply(context.settings, prefersRomanUrdu, true)
            : buildOrderTypePrompt(context.settings.delivery_enabled, prefersRomanUrdu),
        ].join("\n\n"),
        withPreferredLanguage(
          {
            cart: updatedCart,
            workflow_step: context.isOpenNow ? "awaiting_order_type" : "collecting_items",
          },
          preferredLanguage,
        ),
        trace,
      );
    }

    const lastItemOverrideQty = inferLastItemQtyOverride(normalizedText, state);
    if (lastItemOverrideQty != null) {
      const updatedCart = applyLastItemQtyOverride(state.cart, lastItemOverrideQty);
      return replyDecision(
        [
          prefersRomanUrdu
            ? `Theek hai, maine quantity update kar di: ${updatedCart[updatedCart.length - 1].name} x${lastItemOverrideQty}.`
            : `Done, quantity updated: ${updatedCart[updatedCart.length - 1].name} x${lastItemOverrideQty}.`,
          !context.isOpenNow
            ? buildClosedReply(context.settings, prefersRomanUrdu, true)
            : buildOrderTypePrompt(context.settings.delivery_enabled, prefersRomanUrdu),
        ].join("\n\n"),
        withPreferredLanguage(
          {
            cart: updatedCart,
            workflow_step: context.isOpenNow ? "awaiting_order_type" : "collecting_items",
          },
          preferredLanguage,
        ),
        trace,
      );
    }

    if (interpretation.order_type) {
      return handleOrderTypeSelection(context, state, preferredLanguage, interpretation.order_type, trace);
    }

    if (shouldDeferToContextSwitchFallback(context.messageText, normalizedText, interpretation)) {
      return {
        kind: "fallback",
        statePatch: withPreferredLanguage({ workflow_step: "awaiting_order_type" }, preferredLanguage),
        trace,
      };
    }

    return replyDecision(
      prefersRomanUrdu
        ? `${buildOrderTypePrompt(context.settings.delivery_enabled, prefersRomanUrdu)} Agar quantity ya item remove karna ho to bhi likh dein.`
        : `${buildOrderTypePrompt(context.settings.delivery_enabled, prefersRomanUrdu)} You can also ask to remove items or change quantity.`,
      withPreferredLanguage({ workflow_step: "awaiting_order_type" }, preferredLanguage),
      trace,
      buildOrderTypeInteractiveList(prefersRomanUrdu, context.settings.delivery_enabled),
    );
  }

  if (state.workflow_step === "awaiting_delivery_address") {
    if (interpretation.order_type === "dine-in") {
      return handleOrderTypeSelection(context, state, preferredLanguage, "dine-in", trace);
    }

    const address = interpretation.address ?? parseAddress(context.messageText);
    if (!address) {
      if (shouldDeferToContextSwitchFallback(context.messageText, normalizedText, interpretation)) {
        return {
          kind: "fallback",
          statePatch: withPreferredLanguage({ workflow_step: "awaiting_delivery_address" }, preferredLanguage),
          trace,
        };
      }

      const isRetrying = context.session.invalid_step_count > 0;
      return replyDecision(
        prefersRomanUrdu
          ? isRetrying
            ? "Mujhe address samajh nahi aaya. Please apna mukammal (full) delivery address clearly type karein. Agar masla ho to 'human' type karein."
            : "Please apna poora delivery address bhej dein."
          : isRetrying
            ? "I couldn't quite understand the address. Could you please type your full delivery address clearly? If you're stuck, type 'human'."
            : "Please send your full delivery address.",
        withPreferredLanguage({ workflow_step: "awaiting_delivery_address" }, preferredLanguage),
        trace,
      );
    }

    return buildSummaryReply(
      {
        state: {
          ...state,
          preferred_language: preferredLanguage,
          address,
          order_type: "delivery",
        },
        settings: context.settings,
      },
      trace,
    );
  }

  if (state.workflow_step === "awaiting_dine_in_details") {
    if (interpretation.order_type === "delivery") {
      return handleOrderTypeSelection(context, state, preferredLanguage, "delivery", trace);
    }

    const guests = interpretation.guests ?? parseGuestCount(normalizedText) ?? state.guests;
    const reservationTime =
      parseReservationTime(interpretation.reservation_time ?? context.messageText, {
        opening_time: context.settings.opening_time,
        closing_time: context.settings.closing_time,
      }) ??
      state.reservation_time;

    if (!guests || !reservationTime) {
      if (shouldDeferToContextSwitchFallback(context.messageText, normalizedText, interpretation)) {
        return {
          kind: "fallback",
          statePatch: withPreferredLanguage(
            {
              workflow_step: "awaiting_dine_in_details",
              guests: guests ?? null,
              reservation_time: reservationTime ?? null,
            },
            preferredLanguage,
          ),
          trace,
        };
      }

      const isRetrying = context.session.invalid_step_count > 0;
      return replyDecision(
        prefersRomanUrdu
          ? isRetrying
            ? "Mujhe details samajh nahi aayin. Please clearly batayein: Kitne guests honge aur kis time aana hai? Misal: *4 guests at 8 PM*."
            : "Kitne guests honge aur kis time aana hai? Misal: *4 guests at 8 PM*."
          : isRetrying
            ? "I didn't catch the details. Please clearly state how many guests and what time? Example: *4 guests at 8 PM*."
            : "How many guests and what time? Example: *4 guests at 8 PM*.",
        withPreferredLanguage(
          {
            workflow_step: "awaiting_dine_in_details",
            guests: guests ?? null,
            reservation_time: reservationTime ?? null,
          },
          preferredLanguage,
        ),
        trace,
      );
    }

    return buildSummaryReply(
      {
        state: {
          ...state,
          preferred_language: preferredLanguage,
          order_type: "dine-in",
          guests,
          reservation_time: reservationTime,
          address: null,
        },
        settings: context.settings,
      },
      trace,
    );
  }

  if (state.cart.length > 0) {
    if (interpretation.order_type) {
      return handleOrderTypeSelection(context, state, preferredLanguage, interpretation.order_type, trace);
    }

    return replyDecision(
      prefersRomanUrdu
        ? `${buildOrderTypePrompt(context.settings.delivery_enabled, prefersRomanUrdu)} Agar quantity ya item remove karna ho to bhi likh dein.`
        : `${buildOrderTypePrompt(context.settings.delivery_enabled, prefersRomanUrdu)} You can also ask to remove items or change quantity.`,
      withPreferredLanguage({ workflow_step: "awaiting_order_type" }, preferredLanguage),
      trace,
      buildOrderTypeInteractiveList(prefersRomanUrdu, context.settings.delivery_enabled),
    );
  }

  if (matchedAdds.unknown.length > 0 || interpretation.unknown_items.length > 0) {
    const unknown = [...new Set([...matchedAdds.unknown, ...interpretation.unknown_items])].slice(0, 3);
    const unknownReply = buildUnknownItemReplyData(unknown, context.menuItems, prefersRomanUrdu, context.semanticMatches);
      return replyDecision(
      unknownReply.text,
      withPreferredLanguage(
        {
          workflow_step: "collecting_items",
          last_presented_options: unknownReply.selectableItems,
          last_presented_options_at: unknownReply.selectableItems.length > 0 ? new Date().toISOString() : null,
        },
        preferredLanguage,
      ),
      trace,
    );
  }

  if (interpretation.intent === "greeting") {
    return replyDecision(
      prefersRomanUrdu
        ? "Ji, main yahan hoon. Aap *menu* likh dein ya item ka naam quantity ke sath bhej dein."
        : "Hi, I am here to help. You can send *menu* or share an item name with quantity.",
      withPreferredLanguage({}, preferredLanguage),
      trace,
    );
  }

  if (interpretation.intent === "chitchat" || interpretation.intent === "unknown") {
    return {
      kind: "fallback",
      statePatch: withPreferredLanguage({}, preferredLanguage),
      trace,
    };
  }

  return replyDecision(
    prefersRomanUrdu
      ? "Aap *menu* likh dein ya item ka naam aur quantity bhej dein. Misal: *2 Chicken Biryani*."
      : "You can send *menu* or item name with quantity, for example: *2 Chicken Biryani*.",
    withPreferredLanguage({ workflow_step: "collecting_items" }, preferredLanguage),
    trace,
  );
}

function isDraftCartItemLike(value: unknown): value is DraftCartItem {
  if (!value || typeof value !== "object") return false;
  const cast = value as Record<string, unknown>;
  return (
    typeof cast.name === "string" &&
    typeof cast.price === "number" &&
    typeof cast.qty === "number" &&
    (typeof cast.category === "string" || cast.category === null)
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

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompact(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function tokenizeForMenuMatching(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !MENU_TOKEN_STOP_WORDS.has(token));
}

function tokenOverlapScore(left: string, right: string): number {
  const leftTokens = tokenizeForMenuMatching(left);
  const rightTokens = tokenizeForMenuMatching(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const rightSet = new Set(rightTokens);
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightSet.has(token)) overlap += 1;
  }

  return overlap / Math.max(leftTokens.length, rightTokens.length);
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
    .filter((item) => itemSimilarityScore(normalizeText(query), normalizeText(item.name)) >= 0.35);
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
    const guests = interpretation.guests ?? parseGuestCount(normalizedText) ?? next.guests;
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
    const guests = interpretation.guests ?? parseGuestCount(normalizedText) ?? next.guests;
    const reservationTime =
      parseReservationTime(interpretation.reservation_time ?? rawText, {
        opening_time: settings.opening_time,
        closing_time: settings.closing_time,
      }) ?? next.reservation_time;
    next.guests = guests ?? null;
    next.reservation_time = reservationTime ?? null;
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

function shouldPromptForStaleDraftChoice(state: ConversationState): boolean {
  if (state.workflow_step === "idle" || state.cart.length === 0) return false;
  if (!state.last_processed_user_message_at) return false;

  const lastActivity = new Date(state.last_processed_user_message_at);
  const now = new Date();
  const ageMs = now.getTime() - lastActivity.getTime();
  const crossedDateBoundary = now.toISOString().slice(0, 10) !== lastActivity.toISOString().slice(0, 10);
  return ageMs >= STALE_DRAFT_HOURS * 60 * 60 * 1000 || crossedDateBoundary;
}

function getResumeWorkflowStep(state: ConversationState): WorkflowStep {
  if (state.resume_workflow_step && state.resume_workflow_step !== "awaiting_resume_decision") {
    return state.resume_workflow_step;
  }

  if (state.order_type === "delivery" && !state.address) return "awaiting_delivery_address";
  if (state.order_type === "dine-in" && (!state.guests || !state.reservation_time)) return "awaiting_dine_in_details";
  if (state.order_type == null) return "awaiting_order_type";
  if (state.summary_sent_at) return "awaiting_confirmation";
  return "collecting_items";
}

function buildResumePrompt(state: ConversationState, romanUrdu: boolean): string {
  if (state.cart.length === 0) {
    return romanUrdu
      ? "Naya order bhej dein, main help kar deta hoon."
      : "Send your order and I can help right away.";
  }

  const summary = formatCartItems(state.cart);
  const hint =
    state.order_type == null
      ? romanUrdu
        ? "Ab order type batayein: Delivery ya Dine-in."
        : "Please choose order type: Delivery or Dine-in."
      : state.order_type === "delivery" && !state.address
        ? romanUrdu
          ? "Ab apna full delivery address bhej dein."
          : "Please send your full delivery address."
        : state.order_type === "dine-in" && (!state.guests || !state.reservation_time)
          ? romanUrdu
            ? "Guests aur time bhej dein."
            : "Please share guest count and time."
          : romanUrdu
            ? "Agar ready hain to confirm kar dein."
            : "If you're ready, confirm the order.";

  return romanUrdu ? `Aap ka draft: ${summary}\n${hint}` : `Your current draft: ${summary}\n${hint}`;
}

function buildStaleDraftPrompt(state: ConversationState, romanUrdu: boolean): string {
  const summary = formatCartItems(state.cart);
  return romanUrdu
    ? `Aap ka pehle se draft order hai: ${summary}. *continue* ya *restart* likh dein.`
    : `You already have a draft order: ${summary}. Reply *continue* or *restart*.`;
}

function resetDraftState(): Partial<ConversationState> {
  return {
    workflow_step: "idle",
    cart: [],
    order_type: null,
    address: null,
    guests: null,
    reservation_time: null,
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

function getMenuCategories(menuItems: MenuCatalogItem[]): string[] {
  return [...new Set(menuItems.map((item) => item.category?.trim() || "General"))];
}

function parseCategoryMorePage(text: string): number | null {
  const raw = text.trim();
  const moreMatch = raw.match(/^category[_\s-]?more[_\s-]?(\d+)$/i);
  if (!moreMatch) return null;

  const page = Number.parseInt(moreMatch[1], 10);
  if (!Number.isFinite(page) || page < 1) return null;
  return page;
}

function buildCategoryListReply(
  menuItems: MenuCatalogItem[],
  romanUrdu: boolean,
  page = 1,
): {
  text: string;
  interactiveList?: {
    body: string;
    buttonText: string;
    sectionTitle?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  } | null;
} {
  const categories = getMenuCategories(menuItems);
  if (categories.length === 0) {
    return {
      text: romanUrdu
        ? "Is branch ka menu filhal available nahi lag raha. *menu* dobara try karein ya branch confirm kar dein."
        : "I could not find a live menu for this branch right now. Please try *menu* again or confirm your branch.",
    };
  }

  const pageSize = 9;
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  const visibleCategories = categories.slice(start, start + pageSize);
  if (visibleCategories.length === 0) {
    return buildCategoryListReply(menuItems, romanUrdu, 1);
  }
  const hasMore = start + pageSize < categories.length;

  const text = [
    "Available categories:",
    ...visibleCategories.map((category, index) => `${start + index + 1}. ${category}`),
    ...(hasMore
      ? [
          romanUrdu
            ? "...mazeed categories ke liye *more* bhej dein."
            : "...for more categories, send *more*.",
        ]
      : []),
    romanUrdu
      ? "Category ka *number* ya *name* bhej dein."
      : "Reply with category *number* or *name*.",
  ].join("\n");

  let interactiveList: {
    body: string;
    buttonText: string;
    sectionTitle?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  } | null = null;

  if (visibleCategories.length >= 1) {
    const rows = visibleCategories.map((category, index) => {
      const absoluteIndex = start + index + 1;
      const truncatedTitle = category.length > 24 ? category.slice(0, 21) + "..." : category;
      return {
        id: `category_option_${absoluteIndex}`,
        title: truncatedTitle,
        description: undefined,
      };
    });
    if (hasMore) {
      rows.push({
        id: `category_more_${safePage + 1}`,
        title: romanUrdu ? "More Categories" : "More Categories",
        description: undefined,
      });
    }

    interactiveList = {
      body: romanUrdu
        ? "Menu categories se ek select karein."
        : "Choose a category from the menu.",
      buttonText: romanUrdu ? "Select Category" : "Select Category",
      sectionTitle: romanUrdu ? "Categories" : "Categories",
      rows,
    };
  }

  return { text, interactiveList };
}

function findCategoryRequest(text: string, menuItems: MenuCatalogItem[]): string | null {
  const raw = text.trim();
  const normalized = normalizeText(raw);
  const categories = getMenuCategories(menuItems);

  // Handle interactive list selection
  const optionMatch = raw.match(/^category[_\s-]?option[_\s-]?(\d+)$/i);
  if (optionMatch) {
    const index = Number.parseInt(optionMatch[1], 10) - 1;
    if (index >= 0 && index < categories.length) {
      return categories[index];
    }
  }

  const numberMatch = normalized.match(/^(?:category|cat|option|number)?\s*(\d{1,2})$/);
  if (numberMatch) {
    const index = Number.parseInt(numberMatch[1], 10) - 1;
    if (index >= 0 && index < categories.length) {
      return categories[index];
    }
  }

  for (const category of categories) {
    const normCategory = normalizeText(category);
    if (normCategory && normalized.includes(normCategory)) return category;
  }

  const fuzzyCategory = categories
    .map((category) => ({
      category,
      score: Math.max(
        itemSimilarityScore(normalized, normalizeText(category)),
        tokenOverlapScore(normalized, normalizeText(category)),
      ),
    }))
    .filter((entry) => entry.score >= 0.52)
    .sort((left, right) => right.score - left.score)[0];

  if (fuzzyCategory) return fuzzyCategory.category;

  return null;
}

function buildCategoryItemsReply(
  category: string,
  menuItems: MenuCatalogItem[],
  romanUrdu: boolean,
): { text: string; selectableItems: MenuCatalogItem[] } {
  const target = normalizeText(category);
  const rows = menuItems.filter((item) => normalizeText(item.category ?? "General") === target);
  if (rows.length === 0) {
    return {
      text: romanUrdu
        ? "Is category mein items nahi mile. Kisi aur category ka number ya naam bhej dein."
        : "No items found in that category. Please send another category number or name.",
      selectableItems: [],
    };
  }

  const selectableItems = rows.slice(0, 10);
  const lines = selectableItems.map((item, index) => `${index + 1}. ${item.name} - Rs. ${item.price}`);
  if (rows.length > selectableItems.length) {
    lines.push(
      romanUrdu
        ? `...aur ${rows.length - selectableItems.length} items bhi hain. Naam bhej kar search karein.`
        : `...and ${rows.length - selectableItems.length} more. Send item name to search further.`,
    );
  }

  const text = [
    `*${category}* items:`,
    ...lines,
    romanUrdu
      ? "Number ya item name ke sath quantity bhej dein (misal: *2* ya *2 Chicken Karahi*)."
      : "Reply with number or item name and quantity (e.g., *2* or *2 Chicken Karahi*).",
  ].join("\n");

  return { text, selectableItems };
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

function formatCartItems(cart: DraftCartItem[]): string {
  return cart.map((item) => `${item.name} x${item.qty}`).join(", ");
}

function buildAddedItemsMessage(items: DraftCartItem[]): string {
  if (items.length === 0) return "";
  const summary = items.map((item) => `${item.name} x${item.qty}`).join(", ");
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

function buildAmbiguousItemReply(query: string, options: MenuCatalogItem[], romanUrdu: boolean): string {
  const lines = options.slice(0, 3).map((item, index) => `${index + 1}. ${item.name} - Rs. ${item.price}`);
  return [
    romanUrdu
      ? `*${query}* se mutaliq kaunsa item chahiye?`
      : `Which item did you mean for *${query}*?`,
    ...lines,
    romanUrdu ? "Number bhej dein." : "Reply with the number.",
  ].join("\n");
}

function buildItemMatchesReply(query: string, options: MenuCatalogItem[], romanUrdu: boolean): string {
  const lines = options.slice(0, 10).map((item, index) => `${index + 1}. ${item.name} - Rs. ${item.price}`);
  const topResultsHint =
    options.length >= 10
      ? romanUrdu
        ? "Top matches dikhaye gaye hain. Zyada exact result ke liye poora item name bhej dein."
        : "Showing top matches. Send a more specific item name for broader accuracy."
      : null;
  return [
    romanUrdu ? `*${query}* ke related items ye hain:` : `Here are matching items for *${query}*:`,
    ...lines,
    ...(topResultsHint ? [topResultsHint] : []),
    romanUrdu
      ? "Order ke liye number select karein ya item name + quantity bhej dein."
      : "Reply with a number, or send item name with quantity to order.",
  ].join("\n");
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
    ...state.cart.map((item) => `- ${item.name} x${item.qty} = Rs. ${item.price * item.qty}`),
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

  const requests = requested.length > 0 ? requested : findInlineItems(rawText, menuItems);

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
  const compact = normalizeCompact(rawText);
  const items: Array<{ name: string; qty: number }> = [];

  for (const item of menuItems) {
    const itemName = normalizeText(item.name);
    if (!itemName) continue;
    const itemCompact = normalizeCompact(item.name);
    const overlapScore = tokenOverlapScore(normalized, itemName);
    const isMatched =
      normalized.includes(itemName) ||
      (itemCompact.length >= 5 && compact.includes(itemCompact)) ||
      overlapScore >= 0.66;
    if (!isMatched) continue;
    items.push({
      name: item.name,
      qty: extractQuantityNearPhrase(normalized, itemName) ?? extractAnyQuantity(normalized) ?? 1,
    });
  }

  return items;
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
  if (requestTokens.some((token) => normalizedRaw.includes(token))) return true;
  if (tokenOverlapScore(normalizedRaw, normalizedRequest) >= 0.6) return true;

  return semanticMatches.some(
    (match) =>
      normalizeText(match.name) === normalizedRequest &&
      (match.similarity ?? 0) >= 0.72,
  );
}

function itemSimilarityScore(left: string, right: string): number {
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.85;

  const leftCompact = normalizeCompact(left);
  const rightCompact = normalizeCompact(right);
  if (leftCompact && rightCompact) {
    if (leftCompact === rightCompact && leftCompact.length >= 4) return 0.92;
    const minCompactLength = Math.min(leftCompact.length, rightCompact.length);
    if (minCompactLength >= 5 && (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact))) {
      return 0.74;
    }
  }

  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = union > 0 ? intersection / union : 0;
  const compactBonus = normalizeCompact(left) === normalizeCompact(right) ? 0.2 : 0;
  return Math.min(1, jaccard + compactBonus);
}

function findLikelyMenuSuggestions(text: string, menuItems: MenuCatalogItem[], limit = 3): MenuCatalogItem[] {
  const normalized = normalizeText(text);
  const queryTokens = normalized
    .split(/\s+/)
    .filter((token) => token.length > 1 && !MENU_LOOKUP_FILLER_WORDS.has(token));
  if (queryTokens.length === 0) return [];

  // First, find items that contain all the query terms
  const containingItems = menuItems.filter((item) => {
    const normalizedItem = normalizeText(`${item.name} ${item.category ?? ""}`);
    return queryTokens.every((token) => normalizedItem.includes(token));
  });

  if (containingItems.length > 0) {
    // Return all containing items, up to the limit
    return containingItems.slice(0, limit);
  }

  // Fallback: find items that contain any of the query terms
  const partialMatches = menuItems.filter((item) => {
    const normalizedItem = normalizeText(`${item.name} ${item.category ?? ""}`);
    return queryTokens.some((token) => normalizedItem.includes(token) && token.length > 2);
  });

  if (partialMatches.length > 0) {
    return partialMatches
      .map((item) => ({
        item,
        score: queryTokens.filter((token) =>
          normalizeText(`${item.name} ${item.category ?? ""}`).includes(token),
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
  const requests: CartRemovalRequest[] = [];
  if (cart.length === 0) return requests;

  for (const removal of interpretation.remove_items) {
    const matched = findCartMatch(removal.name, cart);
    if (!matched) continue;
    requests.push({
      name: matched.name,
      qty: removal.qty === "all" ? "all" : clampQty(removal.qty),
    });
  }

  requests.push(...extractDirectRemovalRequests(rawText, cart));
  return mergeRemovalRequests(requests);
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
    const existing = merged.find((item) => normalizeText(item.name) === normalizeText(addition.name));
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
    /^(?:category[_\s-]?(?:option|more)[_\s-]?\d{1,2}|city[_\s-]?option[_\s-]?\d{1,2}|branch[_\s-]?option[_\s-]?\d{1,2}|order[_\s-]?type[_\s-]?(?:delivery|dine[_\s-]?in))$/i.test(
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

function parseAddress(raw: string): string | null {
  const compact = raw.trim().replace(/\s+/g, " ");
  if (!compact || compact.length < 8) return null;
  const normalized = normalizeText(compact);
  const hasHint = ADDRESS_HINTS.some((hint) => normalized.includes(hint));
  const hasNumber = /\d/.test(compact);
  if (!hasHint || !hasNumber) return null;
  return compact;
}

function parseGuestCount(text: string): number | null {
  const match = text.match(/(\d{1,2})\s*(guest|guests|person|people|bande|seats?|table)/i);
  if (match) return clampQty(Number.parseInt(match[1], 10));

  const tokenized = normalizeText(text).split(" ");
  for (const token of tokenized) {
    const parsed = parseNumericToken(token);
    if (parsed && parsed > 0) return clampQty(parsed);
  }
  return null;
}

function isWithinOperatingHoursForTime(requestedHours: number, requestedMinutes: number, openingTime: string, closingTime: string): boolean {
  const parsedOpening = parseRestaurantClock(openingTime);
  const parsedClosing = parseRestaurantClock(closingTime);
  if (!parsedOpening || !parsedClosing) return false;

  const totalRequestedMinutes = requestedHours * 60 + requestedMinutes;

  if (parsedClosing.totalMinutes < parsedOpening.totalMinutes) {
    return totalRequestedMinutes >= parsedOpening.totalMinutes || totalRequestedMinutes <= parsedClosing.totalMinutes;
  }

  return totalRequestedMinutes >= parsedOpening.totalMinutes && totalRequestedMinutes <= parsedClosing.totalMinutes;
}
function parseReservationTime(text: string, settings?: { opening_time: string; closing_time: string }): string | null {
  const normalized = text.trim();
  const amPm = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const twentyFour = normalized.match(/\b(\d{1,2}):(\d{2})\b/);
  const relative = normalized.match(/in\s+(\d{1,3})\s*(minute|minutes|min|hour|hours|hr)/i);

  let hours: number | null = null;
  let minutes = 0;

  if (relative) {
    const amount = Number.parseInt(relative[1], 10);
    const unit = relative[2].toLowerCase();
    const now = getRestaurantNowParts();
    const nowTotalMinutes = now.hour * 60 + now.minute;

    let targetMinutes: number;
    if (unit.startsWith('hour') || unit.startsWith('hr')) {
      targetMinutes = nowTotalMinutes + (amount * 60);
    } else {
      targetMinutes = nowTotalMinutes + amount;
    }

    hours = Math.floor(targetMinutes / 60) % 24;
    minutes = targetMinutes % 60;

    // If it's past midnight, assume next day
    const year = now.year;
    let month = now.month;
    let day = now.day;
    if (targetMinutes >= 24 * 60) {
      const rollover = new Date(Date.UTC(now.year, now.month - 1, now.day, 12, 0, 0));
      rollover.setUTCDate(rollover.getUTCDate() + 1);
      month = rollover.getUTCMonth() + 1;
      day = rollover.getUTCDate();
    }

    const parsedTime = buildRestaurantDateTimeIso(year, month, day, hours, minutes);

    // Validate against operating hours if settings provided
    if (settings && !isWithinOperatingHoursForTime(hours, minutes, settings.opening_time, settings.closing_time)) {
      return null; // Invalid time
    }

    return parsedTime;
  }

  if (amPm) {
    hours = Number.parseInt(amPm[1], 10);
    minutes = amPm[2] ? Number.parseInt(amPm[2], 10) : 0;
    const period = amPm[3].toLowerCase();
    if (period === "pm" && hours !== 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;
  } else if (twentyFour) {
    hours = Number.parseInt(twentyFour[1], 10);
    minutes = Number.parseInt(twentyFour[2], 10);
  }

  if (hours == null || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  // Validate against operating hours if settings provided
  if (settings && !isWithinOperatingHoursForTime(hours, minutes, settings.opening_time, settings.closing_time)) {
    return null; // Invalid time
  }

  const now = getRestaurantNowParts();
  let year = now.year;
  let month = now.month;
  let day = now.day;
  const requestedTotal = hours * 60 + minutes;
  const nowTotal = now.hour * 60 + now.minute;

  if (requestedTotal < nowTotal) {
    const rollover = new Date(Date.UTC(now.year, now.month - 1, now.day, 12, 0, 0));
    rollover.setUTCDate(rollover.getUTCDate() + 1);
    year = rollover.getUTCFullYear();
    month = rollover.getUTCMonth() + 1;
    day = rollover.getUTCDate();
  }

  return buildRestaurantDateTimeIso(year, month, day, hours, minutes);
}

function getGreetingReply(rawText: string, romanUrdu: boolean): string {
  const text = rawText.toLowerCase();
  const isSalam = /\b(assalam|aoa|salam)\b/.test(text);

  if (romanUrdu) {
    return isSalam
      ? "Walaikum Assalam! Aapko kya order karna hai? Item ka naam bhej dein."
      : "Hello! Aapko kya order karna hai? Item ka naam bhej dein.";
  } else {
    return isSalam
      ? "Walaikum Assalam! What would you like to order? Send any item name."
      : "Hello! What would you like to order? Send any item name.";
  }
}

function isSimpleGreetingPattern(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return /\b(assalam|aoa|salam|hello|hi|hey|good\s+(morning|afternoon|evening)|namaste|namaskar)\b/i.test(normalized) &&
         normalized.split(/\s+/).length <= 5; // Simple greetings are usually short
}

function isSimpleAcknowledgmentPattern(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  const simpleWords = /\b(ok|okay|yes|no|thanks|thank\s+you|shukriya|theek|fine|good|alright|sure|haan|na|nahi|acha|thik)\b/i;
  return simpleWords.test(normalized) && normalized.split(/\s+/).length <= 3;
}

function parseNumericToken(token: string): number | null {
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10);
  if (token in NUMBER_WORDS) return NUMBER_WORDS[token];
  return null;
}

function extractAnyQuantity(text: string): number | null {
  const tokens = normalizeText(text).split(" ");
  for (const token of tokens) {
    const value = parseNumericToken(token);
    if (value != null) return value;
  }
  return null;
}

function extractQuantityNearPhrase(text: string, phrase: string): number | null {
  const tokens = text.split(" ");
  const phraseTokens = phrase.split(" ");

  for (let index = 0; index <= tokens.length - phraseTokens.length; index += 1) {
    const window = tokens.slice(index, index + phraseTokens.length).join(" ");
    if (window !== phrase) continue;

    const around = [
      ...tokens.slice(Math.max(0, index - 3), index),
      ...tokens.slice(index + phraseTokens.length, index + phraseTokens.length + 2),
    ];
    for (const token of around.reverse()) {
      const parsed = parseNumericToken(token);
      if (parsed != null) return parsed;
    }
    return 1;
  }

  return null;
}

