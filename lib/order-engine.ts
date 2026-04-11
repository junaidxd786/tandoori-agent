import { getOrderTurnInterpretation, type OrderTurnInterpretation } from "./ai";
import type { SemanticMenuMatch } from "./semantic-menu";
import {
  buildRestaurantDateTimeIso,
  getRestaurantNowParts,
  type RestaurantSettings,
} from "./settings";
import type { UserSession } from "./user-session";

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
  const menuItems = getAvailableMenuItems(context.menuItems);

  if (normalizedText.length === 0) {
    return replyDecision(
      prefersRomanUrdu
        ? "Text message bhej dein aur main order mein madad kar deta hoon."
        : "Please send a text message and I will help with your order.",
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

  const interpretation = await getOrderTurnInterpretation({
    messageText: rawText,
    workflowStep: state.workflow_step,
    preferredLanguage,
    cart: state.cart.map((item) => ({ name: item.name, qty: item.qty })),
    menuItems,
    isOpenNow: context.isOpenNow,
    semanticMatches: context.semanticMatches,
  });
  const trace: TurnTrace = {
    intent: interpretation.intent,
    confidence: interpretation.confidence,
    unknownItems: interpretation.unknown_items,
    sentiment: interpretation.sentiment,
    notes: interpretation.notes,
  };

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
    if (context.recentOrder) {
      return replyDecision(
        buildOrderStatusReply(context.recentOrder, prefersRomanUrdu),
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
      ? "Delivery aam tor par confirmation ke baad 30 se 45 minutes leti hai."
      : "Delivery usually takes 30 to 45 minutes after confirmation.";
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
    const contact = context.settings.phone_delivery?.trim() || context.settings.phone_dine_in?.trim() || "support line";
    const prompt = prefersRomanUrdu ? `Contact number: ${contact}.` : `Contact number: ${contact}.`;
    return replyDecision(
      maybeAppendCheckoutPrompt(prompt, state, prefersRomanUrdu),
      withPreferredLanguage({}, preferredLanguage),
      trace,
    );
  }

  if (
    interpretation.asks_menu ||
    interpretation.intent === "browse_menu" ||
    isLikelyMenuRequest(normalizedText)
  ) {
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

  if (state.last_presented_category === "__category_list__") {
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

  if (interpretation.intent === "greeting" && state.cart.length === 0 && state.workflow_step === "idle") {
    return replyDecision(
      prefersRomanUrdu
        ? "Assalam o Alaikum! Aap order dena chahen to item ka naam bhej dein."
        : "Hello! Send any item name and I can start your order.",
      withPreferredLanguage({}, preferredLanguage),
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

  const availabilityQuery = extractItemAvailabilityQuery(normalizedText);
  if (availabilityQuery) {
    const itemSuggestions = findLikelyMenuSuggestions(availabilityQuery, menuItems, 8);
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

  if (state.last_presented_options && state.last_presented_options.length > 0) {
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
    const nextState: ConversationState = {
      ...state,
      cart: cartWithQtyUpdates,
      workflow_step: "collecting_items",
      preferred_language: preferredLanguage,
      last_presented_options: null,
      last_presented_options_at: null,
    };

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
    if (!validation.ok) {
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

    return buildLogisticsOrSummaryReply(
      {
        state: {
          ...state,
          cart: cartWithQtyUpdates,
          workflow_step: "collecting_items",
          summary_sent_at: null,
          preferred_language: preferredLanguage,
        },
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
          prefersRomanUrdu
            ? "Ab order type batayein: *Delivery* ya *Dine-in*."
            : "Now choose order type: *Delivery* or *Dine-in*.",
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
      );
    }

    if (isNoReply || !state.upsell_item_name) {
      const declined = state.upsell_item_name
        ? [...new Set([...state.declined_upsells, state.upsell_item_name])]
        : state.declined_upsells;

      return replyDecision(
        prefersRomanUrdu
          ? "Theek hai, upsell skip kar diya. Ab order type batayein: *Delivery* ya *Dine-in*."
          : "No problem, skipped. Now choose order type: *Delivery* or *Dine-in*.",
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
      );
    }

    if (shouldDeferToContextSwitchFallback(context.messageText, normalizedText, interpretation)) {
      return {
        kind: "fallback",
        statePatch: withPreferredLanguage({ workflow_step: "awaiting_upsell_reply" }, preferredLanguage),
        trace,
      };
    }

    const upsellInteractive = buildUpsellInteractiveList(prefersRomanUrdu);
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
            : prefersRomanUrdu
              ? "Order type batayein: *Delivery* ya *Dine-in*."
              : "Please choose order type: *Delivery* or *Dine-in*.",
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
        ? "Order type batayein: *Delivery* ya *Dine-in*. Agar quantity ya item remove karna ho to bhi likh dein."
        : "Please choose order type: *Delivery* or *Dine-in*. You can also ask to remove items or change quantity.",
      withPreferredLanguage({ workflow_step: "awaiting_order_type" }, preferredLanguage),
      trace,
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

      return replyDecision(
        prefersRomanUrdu
          ? "Please apna poora delivery address bhej dein."
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
      parseReservationTime(interpretation.reservation_time ?? context.messageText) ??
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

      return replyDecision(
        prefersRomanUrdu
          ? "Kitne guests honge aur kis time aana hai? Misal: *4 guests at 8 PM*."
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
        ? "Order type batayein: *Delivery* ya *Dine-in*. Agar quantity ya item remove karna ho to bhi likh dein."
        : "Please choose order type: *Delivery* or *Dine-in*. You can also ask to remove items or change quantity.",
      withPreferredLanguage({ workflow_step: "awaiting_order_type" }, preferredLanguage),
      trace,
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

  if (interpretation.intent === "chitchat" || interpretation.intent === "unknown") {
    return {
      kind: "fallback",
      statePatch: withPreferredLanguage({}, preferredLanguage),
      trace,
    };
  }

  return replyDecision(
    prefersRomanUrdu
      ? "Aap item ka naam aur quantity bhej dein. Misal: *2 Chicken Biryani*."
      : "Send item name with quantity, for example: *2 Chicken Biryani*.",
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
  return /(menu|show.*menu|what.*have|list.*items|kya.*hai|dikhao)/.test(text);
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

  const match = cleaned.match(/^(.+?)\s+(hai|available|milta|milti|milta hai|milti hai)\??$/);
  if (!match) return null;

  const query = match[1].trim();
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
  return /\b(phone|number|contact|call)\b/.test(normalizedText);
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

function buildCategoryListReply(menuItems: MenuCatalogItem[], romanUrdu: boolean): {
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
        ? "Is waqt menu update ho raha hai. Thori dair baad try karein."
        : "The menu is being updated right now. Please try again shortly.",
    };
  }

  const text = [
    "Available categories:",
    ...categories.map((category, index) => `${index + 1}. ${category}`),
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

  const interactiveCategories = categories.slice(0, 10);
  if (interactiveCategories.length >= 2) {
    interactiveList = {
      body: romanUrdu
        ? "Menu categories se ek select karein."
        : "Choose a category from the menu.",
      buttonText: romanUrdu ? "Select Category" : "Select Category",
      sectionTitle: romanUrdu ? "Categories" : "Categories",
      rows: interactiveCategories.map((category, index) => ({
        id: `category_option_${index + 1}`,
        title: category,
        description: undefined,
      })),
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
    const prompt = romanUrdu ? "Order type batayein: Delivery ya Dine-in." : "Please choose order type: Delivery or Dine-in.";
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
  return [
    romanUrdu ? `*${query}* ke related items ye hain:` : `Here are matching items for *${query}*:`,
    ...lines,
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
  const normalizedUnknown = normalizeText(unknown.join(" "));
  const semanticCandidatePool = semanticMatches.filter((item) => (item.similarity ?? 0) >= 0.62);
  const lexicalCandidatePool = findLikelyMenuSuggestions(unknown.join(" "), menuItems, 8).filter((item) => {
    const score = itemSimilarityScore(normalizedUnknown, normalizeText(item.name));
    return score >= 0.5;
  });
  const candidatePool = semanticCandidatePool.length > 0 ? semanticCandidatePool : lexicalCandidatePool;
  const selectableItems = candidatePool
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      name: item.name,
      price: Number(item.price),
      category: item.category ?? null,
      is_available: item.is_available ?? true,
    }));

  if (selectableItems.length > 0) {
    const options = selectableItems
      .map((item, index) => `${index + 1}. ${item.name} - Rs. ${item.price}`)
      .join("\n");
    return {
      text: romanUrdu
        ? `Mujhe ye item clear nahi hua: ${unknown.join(", ")}.\nKya in mein se koi chahiye?\n${options}\nNumber bhej dein.`
        : `I could not confidently match: ${unknown.join(", ")}.\nDid you mean one of these?\n${options}\nReply with a number.`,
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

function isUpsellYes(normalizedText: string): boolean {
  return normalizedText === "upsell_yes" || hasPhrase(normalizedText, "add it") || isExplicitYes(normalizedText);
}

function isUpsellNo(normalizedText: string): boolean {
  return normalizedText === "upsell_no" || hasPhrase(normalizedText, "skip") || isExplicitNo(normalizedText);
}

function buildUpsellInteractiveList(romanUrdu: boolean): {
  body: string;
  buttonText: string;
  sectionTitle?: string;
  rows: Array<{ id: string; title: string; description?: string }>;
} {
  return {
    body: romanUrdu ? "Upsell option select karein." : "Choose an option.",
    buttonText: romanUrdu ? "Choose" : "Choose",
    sectionTitle: romanUrdu ? "Upsell" : "Upsell",
    rows: [
      {
        id: "upsell_yes",
        title: romanUrdu ? "Add Kar Do" : "Add It",
      },
      {
        id: "upsell_no",
        title: romanUrdu ? "Skip" : "Skip",
      },
    ],
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

    if (state.address) {
      return buildSummaryReply(
        {
          state: {
            ...state,
            preferred_language: preferredLanguage,
            order_type: "delivery",
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

  if (state.guests && state.reservation_time) {
    return buildSummaryReply(
      {
        state: {
          ...state,
          preferred_language: preferredLanguage,
          order_type: "dine-in",
          address: null,
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
            workflow_step: "awaiting_upsell_reply",
            upsell_item_name: upsell.name,
            upsell_item_price: upsell.price,
            upsell_offered: true,
          },
          params.state.preferred_language,
        ),
        trace,
        buildUpsellInteractiveList(romanUrdu),
      );
    }
  }

  if (params.state.order_type == null) {
    parts.push(
      romanUrdu
        ? "Order type batayein: *Delivery* ya *Dine-in*. Agar quantity ya item remove karna ho to bhi likh dein."
        : "Please choose order type: *Delivery* or *Dine-in*. You can also ask to remove items or change quantity.",
    );
    return replyDecision(
      parts.join("\n\n"),
      {
        ...withPreferredLanguage({ workflow_step: "awaiting_order_type" }, params.state.preferred_language),
      },
      trace,
    );
  }

  if (params.state.order_type === "delivery" && !params.state.address) {
    parts.push(
      romanUrdu ? "Apna full delivery address bhej dein." : "Please send your full delivery address.",
    );
    return replyDecision(
      parts.join("\n\n"),
      withPreferredLanguage({ workflow_step: "awaiting_delivery_address" }, params.state.preferred_language),
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
      withPreferredLanguage({ workflow_step: "awaiting_dine_in_details" }, params.state.preferred_language),
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
      .map((item) => ({
        item,
        score: itemSimilarityScore(normalizedRequest, normalizeText(item.name)),
      }))
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
    if (best.score >= 0.8 && (!second || best.score - second.score >= 0.12)) {
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

function findInlineItems(rawText: string, menuItems: MenuCatalogItem[]): Array<{ name: string; qty: number }> {
  const normalized = normalizeText(rawText);
  const compact = normalizeCompact(rawText);
  const items: Array<{ name: string; qty: number }> = [];

  for (const item of menuItems) {
    const itemName = normalizeText(item.name);
    if (!itemName) continue;
    const itemCompact = normalizeCompact(item.name);
    const isMatched = normalized.includes(itemName) || (itemCompact.length >= 5 && compact.includes(itemCompact));
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

  const requestTokens = normalizedRequest.split(" ").filter((token) => token.length >= 4);
  if (requestTokens.some((token) => normalizedRaw.includes(token))) return true;

  return semanticMatches.some(
    (match) =>
      normalizeText(match.name) === normalizedRequest &&
      (match.similarity ?? 0) >= 0.72,
  );
}

function itemSimilarityScore(left: string, right: string): number {
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.85;

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
  return menuItems
    .map((item) => ({
      item,
      score: itemSimilarityScore(normalized, normalizeText(item.name)),
    }))
    .filter((entry) => entry.score >= 0.35)
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
  if (!/(remove|delete|without|minus|cancel)/.test(normalized)) {
    return [];
  }

  const qty = extractAnyQuantity(normalized);
  const removeAll = /\b(all|saara|sara|poora|whole)\b/.test(normalized);
  const requests: CartRemovalRequest[] = [];

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
  return options.find((item) => normalizeText(item.name) === normalized) ?? null;
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

  if (/[?؟]/.test(rawText)) return true;

  if (
    /^(what|how|when|where|why|which|who|can|could|would|do|does|is|are|kya|kaise|kab|kahan|kitna|kitne)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  return /\b(price|timing|open|close|location|address|phone|contact|charges|fee|minimum)\b/.test(normalized);
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

function parseReservationTime(text: string): string | null {
  const normalized = text.trim();
  const amPm = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const twentyFour = normalized.match(/\b(\d{1,2}):(\d{2})\b/);

  let hours: number | null = null;
  let minutes = 0;

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
