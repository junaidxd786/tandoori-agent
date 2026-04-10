import {
  buildRestaurantDateTimeIso,
  getRestaurantNowParts,
  type RestaurantSettings,
} from "./settings";

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

interface AppliedCartRemoval {
  name: string;
  removedQty: number;
}

interface CartQuantityMutation {
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
  settings: RestaurantSettings;
  isOpenNow: boolean;
  recentOrder: RecentOrderContext | null;
}

export type TurnDecision =
  | {
    kind: "reply";
    reply: string;
    statePatch: Partial<ConversationState>;
  }
  | {
    kind: "place_order";
    reply: string;
    statePatch: Partial<ConversationState>;
    order: PlaceableOrderPayload;
  }
  | {
    kind: "fallback";
    statePatch?: Partial<ConversationState>;
  };

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

const YES_WORDS = [
  "y",
  "ye",
  "yeah",
  "yep",
  "yup",
  "ya",
  "haan",
  "han",
  "haan ji",
  "han ji",
  "ji",
  "jee",
  "yes",
  "ok",
  "okay",
  "confirm",
  "confirmed",
  "done",
  "sure",
  "theek hai",
  "thik hai",
  "sahi hai",
  "kar do",
  "kr do",
  "bhej do",
  "send it",
  "place it",
  "place order",
  "bilkul",
  "zaroor",
];

const NO_WORDS = [
  "n",
  "na",
  "no",
  "noo",
  "nahi",
  "nah",
  "naah",
  "nope",
  "skip",
  "bas",
  "nothing else",
  "dont",
  "don't",
  "nahin",
];

const CHANGE_WORDS = [
  "change",
  "badal",
  "badlo",
  "remove",
  "delete",
  "aur",
  "add",
  "another",
  "ek aur",
  "instead",
  "replace",
];
const QUANTITY_MUTATION_WORDS = [
  "change",
  "make it",
  "make that",
  "set it",
  "set that",
  "instead",
  "replace",
  "update",
];
const REMOVAL_INTENT_WORDS = [
  "remove",
  "delete",
  "without",
  "minus",
  "dont want",
  "don't want",
  "do not want",
  "nahi chahiye",
  "nahin chahiye",
  "cancel this",
];
const SPLIT_CONNECTORS_PATTERN = /\s*(?:,|\band\b|\baur\b|&|\+)\s*/;
const BUNDLE_ALIASES: Record<string, string[]> = {
  family_deal: ["family deal", "family combo", "family package", "family platter", "deal family"],
  deal_one: ["deal 1", "deal one", "1st deal", "first deal"],
  combo_deal: ["combo", "combos", "meal deal", "value deal", "special deal", "package", "platter", "bucket"],
};

const CANCEL_WORDS = [
  "cancel",
  "rehne do",
  "rehny do",
  "leave it",
  "forget it",
  "stop order",
];
const RESTART_WORDS = [
  "restart",
  "start over",
  "new order",
  "fresh order",
  "cancel and restart",
  "dubara",
  "naya order",
  "phir se",
];
const CONTINUE_WORDS = [
  "continue",
  "carry on",
  "resume",
  "same order",
  "continue order",
  "haan continue",
  "yes continue",
];

const ADDRESS_HINTS = [
  "street",
  "st",
  "road",
  "rd",
  "house",
  "home",
  "flat",
  "apartment",
  "apt",
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

const CATEGORY_QUESTION_WORDS = [
  "what",
  "which",
  "show",
  "have",
  "available",
  "menu",
  "list",
  "kya",
  "kia",
  "dikhao",
  "batao",
  "mein",
  "main",
];

const PAYMENT_WORDS = ["payment", "cash", "card", "jazzcash", "easypaisa", "pay"];
const ETA_WORDS = ["kitni der", "how long", "delivery time", "eta", "kab tak", "time lagega"];
const ORDER_STATUS_WORDS = ["mera order", "my order", "order status", "confirmed", "kahan", "where is my order"];
const ROMAN_URDU_SIGNAL_WORDS = [
  "aoa",
  "assalam",
  "walaikum",
  "kya",
  "kia",
  "chahiye",
  "chahye",
  "bhej",
  "haan",
  "han",
  "nahi",
  "nahin",
  "theek",
  "thik",
  "kar",
  "kr",
  "mera",
  "apna",
  "kitna",
  "kitni",
  "mein",
  "main",
  "aur",
  "bas",
  "batao",
  "dikhao",
];
const ENGLISH_SIGNAL_WORDS = [
  "hello",
  "hi",
  "please",
  "show",
  "what",
  "which",
  "menu",
  "delivery",
  "dine",
  "address",
  "confirm",
  "price",
  "cost",
  "order",
  "want",
  "would",
  "like",
  "can",
  "get",
  "add",
  "remove",
];
const AMBIGUOUS_QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "aik",
  "also",
  "bhi",
  "chahiye",
  "de",
  "dein",
  "deliver",
  "the",
  "do",
  "dain",
  "ek",
  "for",
  "hai",
  "hain",
  "home",
  "kar",
  "karo",
  "kr",
  "main",
  "mein",
  "with",
  "please",
  "plz",
  "show",
  "what",
  "which",
  "menu",
  "price",
  "cost",
  "i",
  "want",
  "would",
  "like",
  "can",
  "get",
  "add",
  "one",
  "two",
  "three",
  "delivery",
  "dine",
  "in",
  "on",
  "to",
  "of",
  "my",
]);
const CATEGORY_ALIASES: Record<string, string[]> = {
  beverage: ["beverage", "beverages", "drink", "drinks", "cold drink", "cold drinks", "soft drink", "soft drinks"],
  drinks: ["beverage", "beverages", "drink", "drinks", "cold drink", "cold drinks", "soft drink", "soft drinks"],
  soup: ["soup", "soups"],
  bbq: ["bbq", "barbecue", "grill", "grilled"],
  starter: ["starter", "starters", "appetizer", "appetizers"],
  karahi: ["karahi", "karhai"],
  biryani: ["biryani", "rice"],
  dessert: ["dessert", "desserts", "desert", "deserts", "sweet", "sweets", "meetha", "meeta"],
};
const STALE_DRAFT_HOURS = 4;
const PRESENTED_CATEGORY_TTL_MINUTES = 30;
const PRESENTED_OPTIONS_TTL_MINUTES = 15;
const FUZZY_ITEM_AUTO_MATCH_THRESHOLD = 0.83;
const FUZZY_ITEM_AMBIGUOUS_THRESHOLD = 0.68;
const FUZZY_ITEM_MIN_MARGIN = 0.06;
const MENU_DESCRIPTOR_TOKENS = new Set([
  "pcs",
  "pc",
  "piece",
  "pieces",
  "portion",
  "serving",
  "servings",
  "scoop",
  "scoops",
]);
const OPTION_WORDS: Record<string, number> = {
  ...NUMBER_WORDS,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  pehla: 1,
  pehli: 1,
  dusra: 2,
  teesra: 3,
  chautha: 4,
  "1st": 1,
  "2nd": 2,
  "3rd": 3,
};

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
    cart: Array.isArray(raw.cart) ? raw.cart : [],
    declined_upsells: Array.isArray(raw.declined_upsells)
      ? raw.declined_upsells.filter((value): value is string => typeof value === "string")
      : [],
    last_presented_options: Array.isArray(raw.last_presented_options)
      ? raw.last_presented_options.filter(isMenuCatalogItemLike)
      : null,
    last_presented_options_at: typeof raw.last_presented_options_at === "string" ? raw.last_presented_options_at : null,
  };
}

export function decideTurn(context: TurnContext): TurnDecision {
  const text = normalizeText(context.messageText);
  const preferredLanguage = inferPreferredLanguage(context.messageText, context.state.preferred_language);
  const prefersRomanUrdu = preferredLanguage === "roman_urdu";
  const state = context.state;
  const allMenuItems = context.menuItems;
  const menuItems = getAvailableMenuItems(allMenuItems);
  const orderIntent = hasOrderIntent(text);
  const shouldBlockForClosedHours = isOrderFlowAttempt(text, state, menuItems);
  const respond = (reply: string, statePatch: Partial<ConversationState>) =>
    replyDecision(reply, statePatch, preferredLanguage);

  const activePresentedOptions = getActivePresentedOptions(state);
  if (activePresentedOptions && activePresentedOptions.length > 0) {
    const selectionNumber = parseSelectionNumber(text);
    if (selectionNumber != null && selectionNumber >= 1 && selectionNumber <= activePresentedOptions.length) {
      const selectedItem = activePresentedOptions[selectionNumber - 1];
      return handleResolvedAdditions(
        [
          {
            name: selectedItem.name,
            price: selectedItem.price,
            qty: extractAnyQuantity(text) ?? 1,
            category: selectedItem.category,
          },
        ],
        {
          ...context,
          state: {
            ...state,
            preferred_language: preferredLanguage,
            last_presented_options: null,
            last_presented_options_at: null,
          },
        },
        preferredLanguage,
        prefersRomanUrdu,
      );
    }
  }

  if (text.length === 0) {
    return respond(
      prefersRomanUrdu
        ? "Text message bhej dein aur main aap ki madad karta hoon."
        : "Please send a text message and I'll help you right away.",
      {},
    );
  }

  if (hasAny(text, CANCEL_WORDS) && state.workflow_step !== "idle") {
    return respond(
      prefersRomanUrdu
        ? "Theek hai, maine current order draft cancel kar diya. Agar naya order karna ho to item ka naam bhej dein."
        : "No problem, I cancelled the current draft order. Send any item name whenever you want to start again.",
      resetDraftState(),
    );
  }

  if (!context.isOpenNow && shouldBlockForClosedHours) {
    return respond(buildClosedReply(context.settings, prefersRomanUrdu), {});
  }

  if (state.workflow_step === "awaiting_resume_decision") {
    if (isRestartIntent(text)) {
      return respond(
        prefersRomanUrdu
          ? "Theek hai, purana draft hata diya. Naya order shuru karne ke liye item ka naam bhej dein."
          : "Sure, I cleared the previous draft. Send an item name whenever you'd like to start a new order.",
        resetDraftState(),
      );
    }

    if (isContinueIntent(text) || isExplicitYes(text)) {
      const resumedStep = getResumeWorkflowStep(state);
      const resumedState = {
        ...state,
        workflow_step: resumedStep,
        resume_workflow_step: null,
        preferred_language: preferredLanguage,
      };

      return replyDecision(
        [
          prefersRomanUrdu ? "Theek hai, aap ka previous draft continue karte hain." : "Sure, let's continue your previous draft.",
          buildResumePrompt(resumedState, prefersRomanUrdu),
        ]
          .filter(Boolean)
          .join("\n\n"),
        persistDraftState(resumedState, {
          workflow_step: resumedStep,
          resume_workflow_step: null,
        }),
        preferredLanguage,
      );
    }

    return respond(buildStaleDraftPrompt(state, prefersRomanUrdu), {
      workflow_step: "awaiting_resume_decision",
      resume_workflow_step: getResumeWorkflowStep(state),
    });
  }

  if (shouldPromptForStaleDraftChoice(state)) {
    if (isRestartIntent(text)) {
      return respond(
        prefersRomanUrdu
          ? "Theek hai, purana draft hata diya. Ab naya order batayein."
          : "Sure, I cleared the previous draft. Tell me your new order whenever you're ready.",
        resetDraftState(),
      );
    }

    if (!isContinueIntent(text) && !isExplicitYes(text)) {
      return respond(buildStaleDraftPrompt(state, prefersRomanUrdu), {
        workflow_step: "awaiting_resume_decision",
        resume_workflow_step: state.workflow_step,
      });
    }
  }

  if (hasPendingSingleItemConfirmation(state)) {
    const pendingItem = getPendingSingleItem(state, menuItems);
    if (!pendingItem) {
      return respond(
        prefersRomanUrdu
          ? "Maazrat, woh suggested item menu mein update ho gaya hai. Aap apna item dobara bhej dein."
          : "Sorry, that suggested item was updated in the menu. Please send the item again.",
        {
          upsell_item_name: null,
          upsell_item_price: null,
          upsell_offered: false,
        },
      );
    }

    if (isExplicitYes(text)) {
      return handleResolvedAdditions(
        [
          {
            name: pendingItem.name,
            price: pendingItem.price,
            qty: extractAnyQuantity(text) ?? 1,
            category: pendingItem.category,
          },
        ],
        {
          ...context,
          state: {
            ...state,
            preferred_language: preferredLanguage,
            upsell_item_name: null,
            upsell_item_price: null,
            upsell_offered: false,
          },
        },
        preferredLanguage,
        prefersRomanUrdu,
      );
    }

    if (isExplicitNo(text)) {
      return respond(
        prefersRomanUrdu
          ? "Theek hai. Koi aur item likh dein, partial naam bhi chalega."
          : "No problem. Send another item name, even a partial one is fine.",
        {
          upsell_item_name: null,
          upsell_item_price: null,
          upsell_offered: false,
        },
      );
    }
  }

  if (state.workflow_step === "awaiting_confirmation") {
    const removalRequests = findCartItemRemovalRequests(text, state.cart);
    if (removalRequests.length > 0) {
      const { updatedCart: reducedCart, removed } = applyCartRemovals(state.cart, removalRequests);
      if (reducedCart.length === 0) {
        return replyDecision(
          prefersRomanUrdu
            ? "Theek hai, maine woh items remove kar diye. Aap ki cart ab empty hai, naya item bhej dein."
            : "Done, I removed those items. Your cart is empty now, so send any item to start again.",
          resetDraftState(),
          preferredLanguage,
        );
      }

      return buildLogisticsOrSummaryReply({
        ...context,
        state: {
          ...state,
          cart: reducedCart,
          preferred_language: preferredLanguage,
          workflow_step: "collecting_items",
          summary_sent_at: null,
          upsell_item_name: null,
          upsell_item_price: null,
        },
        overrideReplyPrefix: buildRemovedItemsMessage(removed, prefersRomanUrdu, reducedCart),
      });
    }

    const modificationItems = extractCartItems(text, menuItems, true);
    if (modificationItems.length > 0 || hasAny(text, CHANGE_WORDS)) {
      const mergedCart = mergeCartItems(state.cart, modificationItems);
      const basePatch: Partial<ConversationState> = { cart: mergedCart };

      if (modificationItems.length === 0) {
        return replyDecision(
          prefersRomanUrdu
            ? "Zaroor, batayein kya change karna hai ya konsa item add/remove karna hai."
            : "Sure, tell me what you'd like to change or which item you'd like to add or remove.",
          {
            ...basePatch,
            workflow_step: "collecting_items",
          },
          preferredLanguage,
        );
      }

      return buildLogisticsOrSummaryReply({
        ...context,
        state: {
          ...state,
          ...basePatch,
          preferred_language: preferredLanguage,
        },
        overrideReplyPrefix: buildAddedItemsMessage(modificationItems, prefersRomanUrdu, mergedCart),
      });
    }

    if (isExplicitNo(text)) {
      return respond(
        prefersRomanUrdu
          ? "Theek hai, batayein kya change karna hai."
          : "No problem. Tell me what you'd like to change.",
        { workflow_step: "collecting_items" },
      );
    }

    if (isExplicitYes(text)) {
      const validation = validateDraftForPlacement(state, context.settings);
      if (!validation.ok) {
        return replyDecision(validation.reply(prefersRomanUrdu), validation.statePatch, preferredLanguage);
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
      };
    }

    return respond(
      prefersRomanUrdu
        ? "Confirm karein? Reply *Haan* ya *Yes* likh dein order place karne ke liye."
        : "Please confirm by replying *Haan* or *Yes* so I can place your order.",
      {},
    );
  }

  if (state.workflow_step === "awaiting_upsell_reply") {
    const suggestedItem = getSuggestedUpsellItem(state, menuItems);
    const explicitlyAdded = extractCartItems(text, menuItems, true);
    const bundledCheckoutDetails =
      detectOrderType(text) != null ||
      parseAddress(context.messageText) != null ||
      parseGuestCount(text) != null ||
      parseReservationTime(text) != null;
    let updatedCart = state.cart;
    let prefix = "";

    if (explicitlyAdded.length > 0) {
      updatedCart = mergeCartItems(state.cart, explicitlyAdded);
      prefix = buildAddedItemsMessage(explicitlyAdded, prefersRomanUrdu, updatedCart);
    } else if (suggestedItem && isExplicitYes(text)) {
      updatedCart = mergeCartItems(state.cart, [
        {
          name: suggestedItem.name,
          qty: 1,
          price: suggestedItem.price,
          category: suggestedItem.category,
        },
      ]);
      prefix = prefersRomanUrdu
        ? `Theek hai, maine *${suggestedItem.name} x1* add kar diya.\n`
        : `Done, I added *${suggestedItem.name} x1* to your cart.\n`;
    }

    if (isExplicitNo(text)) {
      const declinedUpsells = addDeclinedUpsell(state.declined_upsells, suggestedItem?.name ?? state.upsell_item_name);
      return buildLogisticsOrSummaryReply({
        ...context,
        state: {
          ...state,
          cart: updatedCart,
          declined_upsells: declinedUpsells,
          workflow_step: "awaiting_order_type",
          upsell_item_name: null,
          upsell_item_price: null,
          preferred_language: preferredLanguage,
        },
        overrideReplyPrefix: prefix,
      });
    }

    if (isPaymentQuestion(text)) {
      return respond(
        maybeAppendCheckoutPrompt(
          prefersRomanUrdu
            ? "Cash on delivery available hai. Agar kisi aur payment method ki zarurat ho to call karein."
            : "Cash on delivery is available. If you need another payment method, please call us to confirm.",
          state,
          prefersRomanUrdu,
        ),
        persistDraftState(state, {}),
      );
    }

    if (isEtaQuestion(text)) {
      return respond(
        maybeAppendCheckoutPrompt(
          prefersRomanUrdu
            ? "Delivery usually 30 to 45 minutes leti hai after order confirmation."
            : "Delivery usually takes 30 to 45 minutes after order confirmation.",
          state,
          prefersRomanUrdu,
        ),
        persistDraftState(state, {}),
      );
    }

    if (isGenericMenuRequest(text)) {
      return respond(
        maybeAppendCheckoutPrompt(buildCategoryListReply(menuItems, prefersRomanUrdu), state, prefersRomanUrdu),
        persistDraftState(state, {}),
      );
    }

    const upsellCategory = findCategoryRequest(text, menuItems);
    if (upsellCategory) {
      return respond(
        maybeAppendCheckoutPrompt(buildCategoryItemsReply(upsellCategory, menuItems, prefersRomanUrdu), state, prefersRomanUrdu),
        persistDraftState(state, {}),
      );
    }

    const upsellPricedItem = findSingleMenuItemReference(text, menuItems);
    if (upsellPricedItem && isPriceQuestion(text)) {
      return respond(
        maybeAppendCheckoutPrompt(
          prefersRomanUrdu
            ? `*${upsellPricedItem.name}* ki price Rs. ${upsellPricedItem.price} hai.`
            : `*${upsellPricedItem.name}* is Rs. ${upsellPricedItem.price}.`,
          state,
          prefersRomanUrdu,
        ),
        persistDraftState(state, {}),
      );
    }

    if (explicitlyAdded.length === 0 && !isExplicitYes(text)) {
      if (bundledCheckoutDetails) {
        return buildLogisticsOrSummaryReply({
          ...context,
          state: {
            ...state,
            cart: updatedCart,
            workflow_step: "awaiting_order_type",
            upsell_item_name: null,
            upsell_item_price: null,
            preferred_language: preferredLanguage,
          },
          overrideReplyPrefix: prefix,
        });
      }

      return respond(
        maybeAppendCheckoutPrompt(
          prefersRomanUrdu
            ? "Please batayein suggested add-on chahiye ya nahi."
            : "Please tell me whether you'd like the suggested add-on or not.",
          state,
          prefersRomanUrdu,
        ),
        persistDraftState(state, {}),
      );
    }

    return buildLogisticsOrSummaryReply({
      ...context,
      state: {
        ...state,
        cart: updatedCart,
        workflow_step: "awaiting_order_type",
        upsell_item_name: null,
        upsell_item_price: null,
        preferred_language: preferredLanguage,
      },
      overrideReplyPrefix: prefix,
    });
  }

  if (state.workflow_step === "awaiting_delivery_address") {
    if (detectOrderType(text) === "dine-in") {
      return respond(
        prefersRomanUrdu
          ? "Theek hai, dine-in kar lete hain. Kitne guests honge aur kis time aana chahenge?"
          : "Sure, let's make it dine-in. How many guests will there be, and what time would you like to come?",
        {
          order_type: "dine-in",
          address: null,
          workflow_step: "awaiting_dine_in_details",
        },
      );
    }

    const addedItems = extractCartItems(text, menuItems, true);
    const address = parseAddress(context.messageText);
    if (addedItems.length > 0) {
      const mergedCart = mergeCartItems(state.cart, addedItems);
      if (address) {
        return buildSummaryReply({
          ...context,
          state: {
            ...state,
            cart: mergedCart,
            preferred_language: preferredLanguage,
            order_type: "delivery",
            address,
          },
        });
      }

      return respond(
        [
          buildAddedItemsMessage(addedItems, prefersRomanUrdu, mergedCart),
          prefersRomanUrdu
            ? "Ab apna full delivery address bhej dein."
            : "Please send your full delivery address now.",
        ].join("\n"),
        {
          cart: mergedCart,
          workflow_step: "awaiting_delivery_address",
        },
      );
    }

    if (!address) {
      return respond(
        prefersRomanUrdu
          ? "Please apna full address bhej dein, jisme block ya street aur house number dono hon."
          : "Please share your full address, including block or street and house number.",
        {},
      );
    }

    return buildSummaryReply({
      ...context,
      state: {
        ...state,
        preferred_language: preferredLanguage,
        order_type: "delivery",
        address,
      },
    });
  }

  if (state.workflow_step === "awaiting_dine_in_details") {
    if (detectOrderType(text) === "delivery") {
      return respond(
        prefersRomanUrdu
          ? "Theek hai, delivery kar dete hain. Please apna full address bhej dein."
          : "Sure, let's switch it to delivery. Please share your full address.",
        {
          order_type: "delivery",
          guests: null,
          reservation_time: null,
          workflow_step: "awaiting_delivery_address",
        },
      );
    }

    const addedItems = extractCartItems(text, menuItems, true);
    const guests = parseGuestCount(text) ?? state.guests;
    const reservationTime = parseReservationTime(text) ?? state.reservation_time;
    if (addedItems.length > 0) {
      const mergedCart = mergeCartItems(state.cart, addedItems);
      if (guests && reservationTime) {
        return buildSummaryReply({
          ...context,
          state: {
            ...state,
            cart: mergedCart,
            preferred_language: preferredLanguage,
            order_type: "dine-in",
            guests,
            reservation_time: reservationTime,
          },
        });
      }

      return respond(
        [
          buildAddedItemsMessage(addedItems, prefersRomanUrdu, mergedCart),
          prefersRomanUrdu
            ? "Ab guests ki tadaad aur preferred time bata dein."
            : "Now please share the number of guests and your preferred time.",
        ].join("\n"),
        {
          cart: mergedCart,
        },
      );
    }

    if (!guests || !reservationTime) {
      return respond(
        prefersRomanUrdu
          ? "Dine-in ke liye guests ki tadaad aur time dono chahiye. Misal: *4 guests at 8:30 PM*."
          : "For dine-in, I need both the guest count and time. For example: *4 guests at 8:30 PM*.",
        {
          guests: guests ?? null,
          reservation_time: reservationTime ?? null,
        },
      );
    }

    return buildSummaryReply({
      ...context,
      state: {
        ...state,
        preferred_language: preferredLanguage,
        order_type: "dine-in",
        guests,
        reservation_time: reservationTime,
      },
    });
  }

  if (isGreeting(text) && state.workflow_step === "idle" && state.cart.length === 0) {
    return respond(buildGreeting(prefersRomanUrdu), {});
  }

  if (isPaymentQuestion(text)) {
    return respond(
      maybeAppendCheckoutPrompt(
        prefersRomanUrdu
          ? "Cash on delivery available hai. Agar kisi aur payment method ki zarurat ho to call karein."
          : "Cash on delivery is available. If you need another payment method, please call us to confirm.",
        state,
        prefersRomanUrdu,
      ),
      {},
    );
  }

  if (isEtaQuestion(text)) {
    return respond(
      maybeAppendCheckoutPrompt(
        prefersRomanUrdu
          ? "Delivery usually 30 to 45 minutes leti hai after order confirmation."
          : "Delivery usually takes 30 to 45 minutes after order confirmation.",
        state,
        prefersRomanUrdu,
      ),
      {},
    );
  }

  if (context.recentOrder && isOrderStatusQuestion(text) && state.cart.length === 0) {
    return respond(buildRecentOrderReply(context.recentOrder, prefersRomanUrdu), {});
  }

  if (state.cart.length > 0) {
    const quantityMutations = findCartQuantityMutations(text, state.cart);
    if (quantityMutations.length > 0) {
      const updatedCart = applyCartQuantityMutations(state.cart, quantityMutations);
      return buildLogisticsOrSummaryReply({
        ...context,
        state: {
          ...state,
          cart: updatedCart,
          preferred_language: preferredLanguage,
          summary_sent_at: null,
        },
        overrideReplyPrefix: buildQuantityUpdatedMessage(quantityMutations, prefersRomanUrdu, updatedCart),
      });
    }
  }

  const unavailableReference = findUnavailableMenuItemReference(text, allMenuItems);
  if (unavailableReference && (orderIntent || hasExplicitQuantityHint(text) || requestLooksLikeItemSelection(text))) {
    const alternatives = findAlternativeMenuItems(unavailableReference, menuItems);
    const suggestionLine =
      alternatives.length > 0
        ? prefersRomanUrdu
          ? `Available alternatives:\n${alternatives.map((item) => `- *${item.name}* - Rs. ${item.price}`).join("\n")}`
          : `Available alternatives:\n${alternatives.map((item) => `- *${item.name}* - Rs. ${item.price}`).join("\n")}`
        : null;

    return respond(
      [
        prefersRomanUrdu
          ? `Maazrat, *${unavailableReference.name}* abhi out of stock hai.`
          : `Sorry, *${unavailableReference.name}* is currently out of stock.`,
        suggestionLine,
      ]
        .filter(Boolean)
        .join("\n"),
      {},
    );
  }

  const browseIntent = isExplicitBrowseRequest(text);
  const activePresentedCategory = getActivePresentedCategory(state, menuItems);
  const contextualMenuItems = activePresentedCategory
    ? menuItems.filter((item) => normalizeText(item.category ?? "General") === normalizeText(activePresentedCategory))
    : menuItems;
  const selectionAggressive =
    state.workflow_step !== "idle" ||
    orderIntent ||
    hasExplicitQuantityHint(text) ||
    (!browseIntent && (hasActivePresentedCategory(state, menuItems) || requestLooksLikeItemSelection(text)));
  const additions = extractCartItems(text, contextualMenuItems, selectionAggressive);
  const fuzzyMatches = additions.length === 0 && !browseIntent ? findFuzzyMenuMatches(text, contextualMenuItems) : [];
  const exactAmbiguousMatches = findAmbiguousMenuMatches(text, contextualMenuItems);
  const ambiguousMatches = exactAmbiguousMatches.length > 0 ? exactAmbiguousMatches : fuzzyMatches;
  const likelyMenuSuggestions = !browseIntent ? findLikelyMenuSuggestions(text, contextualMenuItems, 4) : [];
  const stateWithoutPendingSuggestion = hasPendingSingleItemConfirmation(state)
    ? {
        ...state,
        upsell_item_name: null,
        upsell_item_price: null,
        upsell_offered: false,
      }
    : state;
  const contextWithoutPendingSuggestion: TurnContext = {
    ...context,
    state: stateWithoutPendingSuggestion,
  };
  const shouldPrioritizeItemSelection =
    (additions.length > 0 && !browseIntent) ||
    state.workflow_step !== "idle" ||
    orderIntent ||
    hasExplicitQuantityHint(text) ||
    additions.some((item) => normalizeText(text) === normalizeText(item.name));

  if (fuzzyMatches.length === 1 && additions.length === 0 && !browseIntent) {
    const [match] = fuzzyMatches;
    const shouldAutoResolveSingleFuzzy =
      hasRecentPresentedContext(state) ||
      state.workflow_step !== "idle" ||
      state.cart.length > 0 ||
      orderIntent ||
      hasExplicitQuantityHint(text) ||
      (requestLooksLikeItemSelection(text) && !isPriceQuestion(text) && !hasAny(text, CATEGORY_QUESTION_WORDS));

    if (shouldAutoResolveSingleFuzzy) {
      return handleResolvedAdditions(
        [
          {
            name: match.name,
            price: match.price,
            qty: extractAnyQuantity(text) ?? 1,
            category: match.category,
          },
        ],
        contextWithoutPendingSuggestion,
        preferredLanguage,
        prefersRomanUrdu,
      );
    }

    return respond(
      prefersRomanUrdu
        ? `Kya aap *${match.name}* keh rahe hain? Reply *haan* likhein to main add kar doon.`
        : `Did you mean *${match.name}*? Reply *yes* and I'll add it for you.`,
      {
        last_presented_category: match.category,
        last_presented_at: new Date().toISOString(),
        upsell_item_name: match.name,
        upsell_item_price: match.price,
        upsell_offered: false,
      },
    );
  }

  if (additions.length > 0 && shouldPrioritizeItemSelection) {
    return handleResolvedAdditions(additions, contextWithoutPendingSuggestion, preferredLanguage, prefersRomanUrdu);
  }

  if (ambiguousMatches.length > 1 && (!browseIntent || orderIntent)) {
    const presentedOptions = ambiguousMatches.slice(0, 6);
    const numberedOptions = presentedOptions
      .map((item, index) => `${index + 1}. *${item.name}* - Rs. ${item.price}`)
      .join("\n");
    const prompt = prefersRomanUrdu
      ? `Aap *${context.messageText.trim()}* se in mein se konsa item chahte hain?\n${numberedOptions}\n\nNumber (1, 2, ...) likh dein ya item ka naam type karein.`
      : `I found multiple matching items for *${context.messageText.trim()}*.\nWhich one would you like?\n${numberedOptions}\n\nReply with the number or type the name.`;
    return respond(prompt, {
      workflow_step: state.cart.length > 0 ? state.workflow_step : "idle",
      last_presented_category: getSingleCategoryOrNull(ambiguousMatches),
      last_presented_at: new Date().toISOString(),
      last_presented_options: presentedOptions,
      last_presented_options_at: new Date().toISOString(),
      upsell_item_name: null,
      upsell_item_price: null,
      upsell_offered: false,
    });
  }

  if (isGenericMenuRequest(text)) {
    return respond(maybeAppendCheckoutPrompt(buildCategoryListReply(menuItems, prefersRomanUrdu), state, prefersRomanUrdu), {
      last_presented_category: null,
      last_presented_at: new Date().toISOString(),
      upsell_item_name: null,
      upsell_item_price: null,
      upsell_offered: false,
    });
  }

  const category = browseIntent ? findCategoryRequest(text, menuItems) : null;
  if (category) {
    return respond(maybeAppendCheckoutPrompt(buildCategoryItemsReply(category, menuItems, prefersRomanUrdu), state, prefersRomanUrdu), {
      last_presented_category: category,
      last_presented_at: new Date().toISOString(),
      upsell_item_name: null,
      upsell_item_price: null,
      upsell_offered: false,
    });
  }

  const pricedItem = findSingleMenuItemReference(text, menuItems);
  if (pricedItem && isPriceQuestion(text)) {
    return respond(
      maybeAppendCheckoutPrompt(
        prefersRomanUrdu
          ? `*${pricedItem.name}* ki price Rs. ${pricedItem.price} hai.`
          : `*${pricedItem.name}* is Rs. ${pricedItem.price}.`,
        state,
        prefersRomanUrdu,
      ),
      {
        upsell_item_name: null,
        upsell_item_price: null,
        upsell_offered: false,
      },
    );
  }

  if (state.cart.length > 0 && state.workflow_step !== "idle") {
    return buildLogisticsOrSummaryReply(context);
  }

  if (likelyMenuSuggestions.length > 0 && (orderIntent || hasExplicitQuantityHint(text) || requestLooksLikeItemSelection(text))) {
    if (likelyMenuSuggestions.length === 1) {
      const [suggestion] = likelyMenuSuggestions;
      return respond(
        prefersRomanUrdu
          ? `Mujhe lagta hai aap *${suggestion.name}* keh rahe hain. Reply *haan* likh dein aur main add kar doon.`
          : `I think you mean *${suggestion.name}*. Reply *yes* and I'll add it for you.`,
        {
          last_presented_category: suggestion.category,
          last_presented_at: new Date().toISOString(),
          upsell_item_name: suggestion.name,
          upsell_item_price: suggestion.price,
          upsell_offered: false,
        },
      );
    }

    return respond(
      prefersRomanUrdu
        ? `Mujhe exact item clear nahi hua. In mein se konsa chahiye?\n${likelyMenuSuggestions
            .slice(0, 4)
            .map((item, index) => `${index + 1}. *${item.name}* - Rs. ${item.price}`)
            .join("\n")}\n\nNumber likh dein.`
        : `I couldn't identify the exact item yet. Which one did you mean?\n${likelyMenuSuggestions
            .slice(0, 4)
            .map((item, index) => `${index + 1}. *${item.name}* - Rs. ${item.price}`)
            .join("\n")}\n\nReply with the number.`,
      {
        last_presented_category: getSingleCategoryOrNull(likelyMenuSuggestions),
        last_presented_at: new Date().toISOString(),
        last_presented_options: likelyMenuSuggestions.slice(0, 4),
        last_presented_options_at: new Date().toISOString(),
        upsell_item_name: null,
        upsell_item_price: null,
        upsell_offered: false,
      },
    );
  }

  if (orderIntent || hasExplicitQuantityHint(text)) {
    return respond(
      prefersRomanUrdu
        ? "Main exact item abhi match nahi kar saka. Aap partial naam bhi bhej sakte hain, ya category pooch lein."
        : "I couldn't match that item yet. You can send a partial name, or ask for a category.",
      { preferred_language: preferredLanguage },
    );
  }

  const lowConfidenceSuggestions = requestLooksLikeItemSelection(text)
    ? findLikelyMenuSuggestions(text, menuItems, 2, 0.45)
    : [];
  if (lowConfidenceSuggestions.length > 0) {
    return respond(
      prefersRomanUrdu
        ? `Kya aap in mein se kuch kehna chahte hain?\n${lowConfidenceSuggestions
            .map((item, index) => `${index + 1}. *${item.name}* - Rs. ${item.price}`)
            .join("\n")}\n\nNumber likh dein.`
        : `Did you mean one of these?\n${lowConfidenceSuggestions
            .map((item, index) => `${index + 1}. *${item.name}* - Rs. ${item.price}`)
            .join("\n")}\n\nReply with the number.`,
      {
        last_presented_category: getSingleCategoryOrNull(lowConfidenceSuggestions),
        last_presented_at: new Date().toISOString(),
        last_presented_options: lowConfidenceSuggestions,
        last_presented_options_at: new Date().toISOString(),
      },
    );
  }

  return { kind: "fallback", statePatch: { preferred_language: preferredLanguage } };
}

function buildLogisticsOrSummaryReply(
  context: TurnContext & { overrideReplyPrefix?: string },
): TurnDecision {
  const state = context.state;
  const preferredLanguage = inferPreferredLanguage(context.messageText, context.state.preferred_language);
  const prefersRomanUrdu = preferredLanguage === "roman_urdu";
  const text = normalizeText(context.messageText);
  const addressFromMessage = parseAddress(context.messageText);
  const detectedType = detectOrderType(text) ?? state.order_type ?? (addressFromMessage ? "delivery" : null);
  const respond = (reply: string, statePatch: Partial<ConversationState>) =>
    replyDecision(reply, statePatch, preferredLanguage);
  const removalRequests = findCartItemRemovalRequests(text, state.cart);
  if (removalRequests.length > 0) {
    const { updatedCart, removed } = applyCartRemovals(state.cart, removalRequests);
    if (updatedCart.length === 0) {
      return respond(
        [
          context.overrideReplyPrefix,
          prefersRomanUrdu
            ? "Theek hai, maine woh items remove kar diye. Aap ki cart ab empty hai, naya item bhej dein."
            : "Done, I removed those items. Your cart is empty now, so send any item to start again.",
        ]
          .filter(Boolean)
          .join("\n"),
        resetDraftState(),
      );
    }

    const draftStateAfterRemoval: ConversationState = {
      ...state,
      cart: updatedCart,
      summary_sent_at: null,
      upsell_item_name: null,
      upsell_item_price: null,
    };
    const nextWorkflowStep = getResumeWorkflowStep(draftStateAfterRemoval);
    const followUp =
      buildResumePrompt(
        {
          ...draftStateAfterRemoval,
          workflow_step: nextWorkflowStep,
        },
        prefersRomanUrdu,
      ) ??
      (prefersRomanUrdu ? "Aap delivery chahenge ya dine-in?" : "Would you like delivery or dine-in?");

    return respond(
      [
        context.overrideReplyPrefix,
        buildRemovedItemsMessage(removed, prefersRomanUrdu, updatedCart),
        followUp,
      ]
        .filter(Boolean)
        .join("\n"),
      persistDraftState(state, {
        cart: updatedCart,
        summary_sent_at: null,
        upsell_item_name: null,
        upsell_item_price: null,
        workflow_step: nextWorkflowStep,
      }),
    );
  }

  if (!detectedType) {
    return respond(
      [
        context.overrideReplyPrefix,
        prefersRomanUrdu ? "Aap delivery chahenge ya dine-in?" : "Would you like delivery or dine-in?",
      ]
        .filter(Boolean)
        .join("\n"),
      persistDraftState(state, {
        workflow_step: "awaiting_order_type",
      }),
    );
  }

  if (detectedType === "delivery") {
    const maybeAddress = addressFromMessage ?? state.address;
    if (!maybeAddress) {
      return respond(
        [
          context.overrideReplyPrefix,
          prefersRomanUrdu
            ? buildDeliveryMinimumNote(context.settings, true)
            : buildDeliveryMinimumNote(context.settings, false),
          prefersRomanUrdu
            ? "Please apna full delivery address bhej dein, jisme block ya street aur house number dono hon."
            : "Please share your full delivery address, including block or street and house number.",
        ]
          .filter(Boolean)
          .join("\n"),
        persistDraftState(state, {
          order_type: "delivery",
          workflow_step: "awaiting_delivery_address",
        }),
      );
    }

    return buildSummaryReply({
      ...context,
      state: {
        ...state,
        preferred_language: preferredLanguage,
        order_type: "delivery",
        address: maybeAddress,
      },
    });
  }

  const guests = parseGuestCount(text) ?? state.guests;
  const reservationTime = parseReservationTime(text) ?? state.reservation_time;

  if (!guests || !reservationTime) {
    return respond(
      [
        context.overrideReplyPrefix,
        prefersRomanUrdu
          ? "Dine-in ke liye guests ki tadaad aur time bata dein. Misal: *4 guests at 8:30 PM*."
          : "For dine-in, please share the guest count and time. Example: *4 guests at 8:30 PM*.",
      ]
        .filter(Boolean)
        .join("\n"),
      persistDraftState(state, {
        order_type: "dine-in",
        guests: guests ?? null,
        reservation_time: reservationTime ?? null,
        workflow_step: "awaiting_dine_in_details",
      }),
    );
  }

  return buildSummaryReply({
    ...context,
    state: {
      ...state,
      preferred_language: preferredLanguage,
      order_type: "dine-in",
      guests,
      reservation_time: reservationTime,
    },
  });
}

function buildSummaryReply(context: TurnContext): TurnDecision {
  const state = context.state;
  const preferredLanguage = inferPreferredLanguage(context.messageText, context.state.preferred_language);
  const prefersRomanUrdu = preferredLanguage === "roman_urdu";
  const subtotal = getCartSubtotal(state.cart);

  if (state.order_type === "delivery" && context.settings.min_delivery_amount > 0 && subtotal < context.settings.min_delivery_amount) {
    return replyDecision(
      prefersRomanUrdu
        ? `Delivery ke liye minimum order Rs. ${context.settings.min_delivery_amount} hai. Aap thora sa aur add kar dein please. Current subtotal Rs. ${subtotal} hai.`
        : `The minimum for delivery is Rs. ${context.settings.min_delivery_amount}. Please add a little more to continue. Your current subtotal is Rs. ${subtotal}.`,
      persistDraftState(state, {
        workflow_step: "collecting_items",
      }),
      preferredLanguage,
    );
  }

  return replyDecision(
    formatSummary(state, context.settings, prefersRomanUrdu),
    persistDraftState(state, {
      workflow_step: "awaiting_confirmation",
      summary_sent_at: new Date().toISOString(),
    }),
    preferredLanguage,
  );
}

function validateDraftForPlacement(
  state: ConversationState,
  settings: RestaurantSettings,
):
  | { ok: true; order: PlaceableOrderPayload }
  | {
    ok: false;
    reply: (prefersRomanUrdu: boolean) => string;
    statePatch: Partial<ConversationState>;
  } {
  if (state.cart.length === 0) {
    return {
      ok: false,
      reply: (prefersRomanUrdu) =>
        prefersRomanUrdu
          ? "Aap ki cart empty hai. Pehle items bhej dein."
          : "Your cart is empty. Please send the items you'd like first.",
      statePatch: { workflow_step: "idle" },
    };
  }

  const subtotal = getCartSubtotal(state.cart);
  const deliveryFee =
    state.order_type === "delivery" && settings.delivery_enabled && settings.delivery_fee > 0
      ? Number(settings.delivery_fee)
      : 0;

  if (!state.order_type) {
    return {
      ok: false,
      reply: (prefersRomanUrdu) =>
        prefersRomanUrdu ? "Delivery ya dine-in select karein." : "Please select delivery or dine-in first.",
      statePatch: { workflow_step: "awaiting_order_type" },
    };
  }

  if (state.order_type === "delivery") {
    if (!state.address || !isCompleteAddress(state.address)) {
      return {
        ok: false,
        reply: (prefersRomanUrdu) =>
          prefersRomanUrdu ? "Please apna full delivery address bhej dein." : "Please share your full delivery address.",
        statePatch: { workflow_step: "awaiting_delivery_address" },
      };
    }

    if (settings.min_delivery_amount > 0 && subtotal < settings.min_delivery_amount) {
      return {
        ok: false,
        reply: (prefersRomanUrdu) =>
          prefersRomanUrdu
            ? `Delivery ke liye minimum order Rs. ${settings.min_delivery_amount} hai.`
            : `The minimum order for delivery is Rs. ${settings.min_delivery_amount}.`,
        statePatch: { workflow_step: "collecting_items" },
      };
    }
  }

  if (state.order_type === "dine-in" && (!state.guests || !state.reservation_time)) {
    return {
      ok: false,
      reply: (prefersRomanUrdu) =>
        prefersRomanUrdu
          ? "Dine-in ke liye guests aur time dono chahiye."
          : "For dine-in, I need both the guest count and time.",
      statePatch: { workflow_step: "awaiting_dine_in_details" },
    };
  }

  return {
    ok: true,
    order: {
      items: state.cart,
      type: state.order_type,
      subtotal,
      delivery_fee: deliveryFee,
      address: state.order_type === "delivery" ? state.address : null,
      guests: state.order_type === "dine-in" ? state.guests : null,
      reservation_time: state.order_type === "dine-in" ? state.reservation_time : null,
    },
  };
}

function replyDecision(
  reply: string,
  statePatch: Partial<ConversationState>,
  preferredLanguage: LanguagePreference,
): TurnDecision {
  const effectivePatch: Partial<ConversationState> = { ...statePatch };
  if (!("last_presented_options" in statePatch)) {
    effectivePatch.last_presented_options = null;
  }
  if (!("last_presented_options_at" in statePatch)) {
    effectivePatch.last_presented_options_at = null;
  }

  return { kind: "reply", reply, statePatch: withPreferredLanguage(effectivePatch, preferredLanguage) };
}

function resetDraftState(): Partial<ConversationState> {
  return {
    workflow_step: "idle",
    resume_workflow_step: null,
    last_presented_category: null,
    last_presented_at: null,
    last_presented_options: null,
    last_presented_options_at: null,
    cart: [],
    order_type: null,
    address: null,
    guests: null,
    reservation_time: null,
    upsell_item_name: null,
    upsell_item_price: null,
    upsell_offered: false,
    summary_sent_at: null,
    last_error: null,
  };
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\bkarai\b/g, "karahi")
    .replace(/\bkarhai\b/g, "karahi")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompactText(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function parseSelectionNumber(text: string): number | null {
  const normalized = normalizeText(text);
  const digitMatch = normalized.match(/\b([1-9][0-9]?)\b/);
  if (digitMatch) {
    const parsed = Number.parseInt(digitMatch[1], 10);
    if (parsed >= 1 && parsed <= 20) return parsed;
  }

  for (const token of normalized.split(/\s+/)) {
    const parsed = OPTION_WORDS[token];
    if (typeof parsed === "number" && parsed >= 1 && parsed <= 20) {
      return parsed;
    }
  }

  return null;
}

function getActivePresentedOptions(state: ConversationState): MenuCatalogItem[] | null {
  if (!state.last_presented_options || !state.last_presented_options_at) return null;
  const ageMs = Date.now() - new Date(state.last_presented_options_at).getTime();
  if (Number.isNaN(ageMs) || ageMs > PRESENTED_OPTIONS_TTL_MINUTES * 60 * 1000) return null;
  return state.last_presented_options;
}

function isMenuCatalogItemLike(value: unknown): value is MenuCatalogItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<MenuCatalogItem>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.price === "number" &&
    typeof item.is_available === "boolean" &&
    (item.category === null || typeof item.category === "string")
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;

  const pattern = normalizedPhrase.includes(" ")
    ? new RegExp(`(?:^|\\s)${escapeRegex(normalizedPhrase)}(?:$|\\s)`)
    : new RegExp(`\\b${escapeRegex(normalizedPhrase)}\\b`);
  return pattern.test(text);
}

function getAvailableMenuItems(menuItems: MenuCatalogItem[]): MenuCatalogItem[] {
  return menuItems.filter((item) => item.is_available);
}

function findUnavailableMenuItemReference(text: string, menuItems: MenuCatalogItem[]): MenuCatalogItem | null {
  const unavailableItems = menuItems.filter((item) => !item.is_available);
  if (unavailableItems.length === 0) return null;
  return findSingleMenuItemReference(text, unavailableItems);
}

function findAlternativeMenuItems(target: MenuCatalogItem, availableMenuItems: MenuCatalogItem[]): MenuCatalogItem[] {
  const sameCategory = availableMenuItems.filter((item) => (item.category ?? "General") === (target.category ?? "General"));
  if (sameCategory.length > 0) {
    return sameCategory.slice(0, 3);
  }

  return findLikelyMenuSuggestions(target.name, availableMenuItems, 3, 0.45);
}

function inferPreferredLanguage(text: string, previous: LanguagePreference = "english"): LanguagePreference {
  const normalized = normalizeText(text);
  const romanScore = scoreSignals(normalized, ROMAN_URDU_SIGNAL_WORDS);
  const englishScore = scoreSignals(normalized, ENGLISH_SIGNAL_WORDS);

  if (romanScore === 0 && englishScore === 0) {
    return previous;
  }

  if (romanScore >= englishScore + 1) {
    return "roman_urdu";
  }

  if (englishScore >= romanScore + 1) {
    return "english";
  }

  return previous;
}

export function inferLanguagePreference(
  text: string,
  previous: LanguagePreference = "english",
): LanguagePreference {
  return inferPreferredLanguage(text, previous);
}

function scoreSignals(text: string, signalWords: string[]): number {
  return signalWords.reduce((score, signal) => {
    if (text === signal) return score + 2;
    if (text.includes(signal)) return score + 1;
    return score;
  }, 0);
}

function hasAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => hasPhrase(text, phrase));
}

function isGreeting(text: string): boolean {
  return /^(hi|hello|hey|aoa|assalam|assalam o alaikum|salam|salaam)\b/.test(text);
}

function hasOrderIntent(text: string): boolean {
  return /(\bi want\b|\bi would like\b|\bi ll take\b|\bi'll take\b|\bcan i get\b|\bget me\b|\bplease add\b|\badd\b|\border\b|\bsend\b|\bgive\b|\bneed\b|\bbhej\b|\bbhej dein\b|\bbhej dain\b|\bde do\b|\bdedo\b|\bchahiye\b|\bkrdo\b|\bkar do\b|\bkr dein\b|\bkr dain\b|\bkar dein\b|\bkar dain\b|\bbook\b|\breserve\b)/.test(
    text,
  );
}

function isOrderFlowAttempt(text: string, state: ConversationState, menuItems: MenuCatalogItem[]): boolean {
  if (state.workflow_step !== "idle") return true;
  if (hasOrderIntent(text)) return true;
  if (extractCartItems(text, menuItems, true).length > 0) return true;
  if (parseAddress(text) != null) return true;
  if (detectOrderType(text) != null && (hasExplicitQuantityHint(text) || requestLooksLikeItemSelection(text))) return true;
  if (parseGuestCount(text) != null && parseReservationTime(text) != null) return true;
  return hasExplicitQuantityHint(text) && requestLooksLikeItemSelection(text);
}

function isGenericMenuRequest(text: string): boolean {
  return /(menu|what do you have|what do u have|show menu|full menu|categories|list|show me what you have|what can i order)/.test(
    text,
  );
}

function isPriceQuestion(text: string): boolean {
  return /(price|cost|kitne|kitna|how much)/.test(text);
}

function isPaymentQuestion(text: string): boolean {
  return hasAny(text, PAYMENT_WORDS);
}

function isEtaQuestion(text: string): boolean {
  return hasAny(text, ETA_WORDS);
}

function isOrderStatusQuestion(text: string): boolean {
  return hasAny(text, ORDER_STATUS_WORDS);
}

function isExplicitYes(text: string): boolean {
  return YES_WORDS.some((word) => hasPhrase(text, word));
}

function isExplicitNo(text: string): boolean {
  return NO_WORDS.some((word) => hasPhrase(text, word));
}

function hasExplicitQuantityHint(text: string): boolean {
  return /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|panj|paanch|cheh|chay|saat|aath|ath|das)\b/.test(
    text,
  );
}

function isExplicitBrowseRequest(text: string): boolean {
  return isGenericMenuRequest(text) || hasAny(text, CATEGORY_QUESTION_WORDS);
}

function isRestartIntent(text: string): boolean {
  return hasAny(text, RESTART_WORDS);
}

function isContinueIntent(text: string): boolean {
  return hasAny(text, CONTINUE_WORDS);
}

function shouldPromptForStaleDraftChoice(state: ConversationState): boolean {
  if (state.workflow_step === "idle" || state.cart.length === 0) return false;
  if (!state.last_processed_user_message_at) return false;

  const lastActivity = new Date(state.last_processed_user_message_at);
  const now = new Date();
  const ageMs = now.getTime() - lastActivity.getTime();
  const crossedDateBoundary =
    now.toISOString().slice(0, 10) !== lastActivity.toISOString().slice(0, 10);

  return ageMs >= STALE_DRAFT_HOURS * 60 * 60 * 1000 || crossedDateBoundary;
}

function getResumeWorkflowStep(state: ConversationState): WorkflowStep {
  if (state.resume_workflow_step && state.resume_workflow_step !== "awaiting_resume_decision") {
    return state.resume_workflow_step;
  }

  if (state.order_type === "delivery" && !state.address) return "awaiting_delivery_address";
  if (state.order_type === "dine-in" && (!state.guests || !state.reservation_time)) return "awaiting_dine_in_details";
  if (!state.order_type) return "awaiting_order_type";
  if (state.summary_sent_at) return "awaiting_confirmation";
  if (state.upsell_item_name && state.upsell_offered) return "awaiting_upsell_reply";
  return "collecting_items";
}

function buildStaleDraftPrompt(state: ConversationState, prefersRomanUrdu: boolean): string {
  const itemsSummary = state.cart.map((item) => `${item.name} x${item.qty}`).join(", ");
  return prefersRomanUrdu
    ? `Aap ka pehle se ek incomplete draft order maujood hai: ${itemsSummary}. Kya aap usi order ko continue karna chahte hain ya restart? Reply *continue* ya *restart*.`
    : `You still have an unfinished draft order: ${itemsSummary}. Would you like to continue it or restart? Reply *continue* or *restart*.`;
}

function detectOrderType(text: string): OrderType | null {
  if (/(delivery|deliver|home delivery|ghar|bhej do|send it home|drop it off)/.test(text)) return "delivery";
  if (/(dine in|dine-in|reserve|reservation|table|eat there|book table|eat in)/.test(text)) return "dine-in";
  return null;
}

function parseAddress(raw: string): string | null {
  const text = raw.trim().replace(/\s+/g, " ");
  const extracted = extractAddressFragment(text);
  if (!extracted) return null;
  return extracted;
}

function isCompleteAddress(text: string): boolean {
  const normalized = normalizeText(text);
  if (normalized.length < 10) return false;
  const hasNumber = /\d/.test(normalized);
  const hasHint = ADDRESS_HINTS.some((hint) => normalized.includes(hint));
  return hasNumber && hasHint;
}

function extractAddressFragment(text: string): string | null {
  const normalizedHints = ADDRESS_HINTS
    .map((hint) => hint.toLowerCase())
    .sort((left, right) => right.length - left.length);
  const lowered = text.toLowerCase();
  let earliestHintIndex = -1;

  for (const hint of normalizedHints) {
    const index = lowered.indexOf(hint);
    if (index === -1) continue;
    if (earliestHintIndex === -1 || index < earliestHintIndex) {
      earliestHintIndex = index;
    }
  }

  if (earliestHintIndex !== -1) {
    const candidate = text.slice(earliestHintIndex).replace(/^[,\s:-]+/, "").trim();
    if (isCompleteAddress(candidate)) return candidate;
  }

  return isCompleteAddress(text) ? text : null;
}

function parseGuestCount(text: string): number | null {
  const match = text.match(/(\d{1,2})\s*(guest|guests|person|people|persons|bande|seats?|table)/i);
  if (match) return Number.parseInt(match[1], 10);

  const tokens = normalizeText(text).split(" ");
  for (const token of tokens) {
    const parsed = parseNumericToken(token);
    if (parsed && parsed > 0 && parsed <= 25) return parsed;
  }

  return null;
}

function parseReservationTime(text: string): string | null {
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!match) return null;

  const now = getRestaurantNowParts();
  let hours = Number.parseInt(match[1], 10);
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
  const period = match[3].toLowerCase();

  if (period === "pm" && hours !== 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  let year = now.year;
  let month = now.month;
  let day = now.day;
  const currentTotalMinutes = now.hour * 60 + now.minute;
  const requestedTotalMinutes = hours * 60 + minutes;

  if (requestedTotalMinutes < currentTotalMinutes) {
    const rollover = new Date(Date.UTC(now.year, now.month - 1, now.day, 12, 0, 0));
    rollover.setUTCDate(rollover.getUTCDate() + 1);
    year = rollover.getUTCFullYear();
    month = rollover.getUTCMonth() + 1;
    day = rollover.getUTCDate();
  }

  return buildRestaurantDateTimeIso(year, month, day, hours, minutes);
}

function extractCartItems(text: string, menuItems: MenuCatalogItem[], aggressive: boolean): DraftCartItem[] {
  const normalized = normalizeText(text);
  const normalizedCompact = normalizeCompactText(text);
  const explicitQuantityPresent = /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|panj|paanch|cheh|chay|saat|aath|ath|das)\b/.test(normalized);
  const results: DraftCartItem[] = [];
  const matchedIds = new Set<string>();

  const candidates = menuItems
    .map((item) => ({
      item,
      phrases: buildItemPhrases(item),
    }))
    .sort((left, right) => {
      const leftLength = Math.max(...left.phrases.map((phrase) => phrase.length));
      const rightLength = Math.max(...right.phrases.map((phrase) => phrase.length));
      return rightLength - leftLength;
    });

  for (const candidate of candidates) {
    if (matchedIds.has(candidate.item.id)) continue;

    for (const phrase of candidate.phrases) {
      const phraseMatched = normalized.includes(phrase);
      const compactPhrase = normalizeCompactText(phrase);
      const compactMatched = !phraseMatched && compactPhrase.length >= 4 && normalizedCompact.includes(compactPhrase);
      if (!phraseMatched && !compactMatched) continue;

      const qty = phraseMatched ? extractQuantityNearPhrase(normalized, phrase) : extractAnyQuantity(normalized);
      if (!aggressive && qty == null) continue;
      if (!aggressive && qty === 1 && !explicitQuantityPresent && !hasOrderIntent(normalized)) continue;

      results.push({
        name: candidate.item.name,
        price: candidate.item.price,
        qty: qty ?? 1,
        category: candidate.item.category,
      });
      matchedIds.add(candidate.item.id);
      break;
    }
  }

  if (results.length === 0) {
    const tokenMatched = findTokenMatchedItems(normalized, menuItems);
    if (tokenMatched.length === 1) {
      const [item] = tokenMatched;
      const qty = extractAnyQuantity(normalized) ?? 1;
      if (aggressive || explicitQuantityPresent || hasOrderIntent(normalized) || requestLooksLikeItemSelection(normalized)) {
        results.push({
          name: item.name,
          price: item.price,
          qty,
          category: item.category,
        });
      }
    }

    if (results.length === 0) {
      const bundleMatches = findBundleAliasMatches(normalized, menuItems);
      if (bundleMatches.length === 1) {
        const [item] = bundleMatches;
        results.push({
          name: item.name,
          price: item.price,
          qty: extractAnyQuantity(normalized) ?? 1,
          category: item.category,
        });
      }
    }
  }

  return results;
}

function buildItemPhrases(item: MenuCatalogItem): string[] {
  const base = normalizeText(item.name);
  const phrases = new Set<string>([base]);
  const simplifiedTokens = getMeaningfulTokens(base).filter((token) => !MENU_DESCRIPTOR_TOKENS.has(token));

  const portionAtEndMatch = base.match(/^(.*)\b(half|full)\b$/);
  if (portionAtEndMatch) {
    const itemName = portionAtEndMatch[1].trim();
    const portion = portionAtEndMatch[2].trim();
    if (itemName) phrases.add(`${portion} ${itemName}`);
  }

  if (simplifiedTokens.length >= 2) {
    const simplifiedPhrase = simplifiedTokens.join(" ");
    if (simplifiedPhrase.length >= 4) {
      phrases.add(simplifiedPhrase);
    }
  }

  if (base.includes("soup")) {
    const withoutSoup = base.replace(/\bsoup\b/g, "").trim();
    if (withoutSoup.length >= 4) phrases.add(`${withoutSoup} soup`);
  }

  return [...phrases].filter((phrase) => phrase.length > 2);
}

function extractQuantityNearPhrase(text: string, phrase: string): number | null {
  const tokens = text.split(" ");
  const phraseTokens = phrase.split(" ");

  for (let index = 0; index <= tokens.length - phraseTokens.length; index += 1) {
    const windowTokens = tokens.slice(index, index + phraseTokens.length);
    if (windowTokens.join(" ") !== phrase) continue;

    const nearbyTokens = [
      ...tokens.slice(Math.max(0, index - 3), index),
      ...tokens.slice(index + phraseTokens.length, index + phraseTokens.length + 2),
    ];

    for (const token of nearbyTokens.reverse()) {
      const parsed = parseNumericToken(token);
      if (parsed != null) return parsed;
    }

    return 1;
  }

  return null;
}

function parseNumericToken(token: string): number | null {
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10);
  if (token in NUMBER_WORDS) return NUMBER_WORDS[token];
  return null;
}

function extractAnyQuantity(text: string): number | null {
  const tokens = normalizeText(text).split(" ");
  for (const token of tokens) {
    const parsed = parseNumericToken(token);
    if (parsed != null) return parsed;
  }
  return null;
}

function requestLooksLikeItemSelection(text: string): boolean {
  const tokens = getMeaningfulTokens(text);
  if (tokens.length >= 2) return true;
  if (tokens.length === 1 && tokens[0].length >= 5) return true;
  return normalizeCompactText(text).length >= 8;
}

function hasActivePresentedCategory(state: ConversationState, menuItems: MenuCatalogItem[]): boolean {
  return getActivePresentedCategory(state, menuItems) != null;
}

function getActivePresentedCategory(state: ConversationState, menuItems: MenuCatalogItem[]): string | null {
  if (!state.last_presented_category || !state.last_presented_at) return null;

  const ageMs = Date.now() - new Date(state.last_presented_at).getTime();
  if (Number.isNaN(ageMs) || ageMs > PRESENTED_CATEGORY_TTL_MINUTES * 60 * 1000) {
    return null;
  }

  const categoryExists = menuItems.some(
    (item) => normalizeText(item.category ?? "General") === normalizeText(state.last_presented_category ?? ""),
  );

  return categoryExists ? state.last_presented_category : null;
}

function hasRecentPresentedContext(state: ConversationState): boolean {
  if (!state.last_presented_at) return false;

  const ageMs = Date.now() - new Date(state.last_presented_at).getTime();
  if (Number.isNaN(ageMs)) return false;

  return ageMs <= PRESENTED_CATEGORY_TTL_MINUTES * 60 * 1000;
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

function hasRemovalIntent(text: string): boolean {
  return hasAny(text, REMOVAL_INTENT_WORDS) || /(dont|don't|do not|nahi|nahin)\s+(want|chahiye|chahye)/.test(text);
}

function hasQuantityMutationIntent(text: string): boolean {
  if (!hasExplicitQuantityHint(text)) return false;
  return hasAny(text, QUANTITY_MUTATION_WORDS) || /\bmake\s+(it|that|this)\b/.test(text);
}

function cartToMenuItems(cart: DraftCartItem[]): MenuCatalogItem[] {
  return cart.map((item, index) => ({
    id: `cart-${index}`,
    name: item.name,
    price: item.price,
    category: item.category,
    is_available: true,
  }));
}

function splitActionSegments(text: string): string[] {
  const normalized = normalizeText(text);
  const stripped = normalized
    .replace(/\b(remove|delete|without|minus|dont want|don't want|do not want|nahi chahiye|nahin chahiye)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const segments = stripped.split(SPLIT_CONNECTORS_PATTERN).map((segment) => segment.trim()).filter(Boolean);
  return segments.length > 0 ? segments : [normalized];
}

function resolveMenuMatchesFromSegment(segment: string, menuItems: MenuCatalogItem[]): MenuCatalogItem[] {
  const exact = extractCartItems(segment, menuItems, true);
  if (exact.length > 0) {
    const names = new Set(exact.map((item) => normalizeText(item.name)));
    return menuItems.filter((item) => names.has(normalizeText(item.name)));
  }

  const tokenMatches = findTokenMatchedItems(segment, menuItems);
  if (tokenMatches.length > 0) return tokenMatches;

  const fuzzyMatches = findFuzzyMenuMatches(segment, menuItems);
  if (fuzzyMatches.length > 0) return fuzzyMatches;

  const likelyMatches = findLikelyMenuSuggestions(segment, menuItems, 2, 0.5);
  return likelyMatches;
}

function findCartItemRemovalRequests(text: string, cart: DraftCartItem[]): CartRemovalRequest[] {
  if (cart.length === 0) return [];

  const normalized = normalizeText(text);
  if (!hasRemovalIntent(normalized)) return [];

  if (/\b(all|everything|sab|sara|saara|poora|poori)\b/.test(normalized)) {
    return cart.map((item) => ({
      name: item.name,
      qty: "all" as const,
    }));
  }

  const cartMenuItems = cartToMenuItems(cart);
  const requestsByName = new Map<string, CartRemovalRequest>();
  const segments = splitActionSegments(normalized);

  for (const segment of segments) {
    const matched = resolveMenuMatchesFromSegment(segment, cartMenuItems);
    if (matched.length === 0) continue;

    const qty = extractAnyQuantity(segment);
    for (const match of matched.slice(0, 3)) {
      const key = normalizeText(match.name);
      const existing = requestsByName.get(key);
      const nextQty: number | "all" = qty && qty > 0 ? qty : "all";
      if (!existing) {
        requestsByName.set(key, { name: match.name, qty: nextQty });
        continue;
      }

      if (existing.qty === "all" || nextQty === "all") {
        requestsByName.set(key, { name: match.name, qty: "all" });
      } else {
        requestsByName.set(key, { name: match.name, qty: existing.qty + nextQty });
      }
    }
  }

  return [...requestsByName.values()];
}

function applyCartRemovals(
  cart: DraftCartItem[],
  requests: CartRemovalRequest[],
): { updatedCart: DraftCartItem[]; removed: AppliedCartRemoval[] } {
  const requestsByName = new Map(requests.map((request) => [normalizeText(request.name), request] as const));
  const removed: AppliedCartRemoval[] = [];
  const updatedCart: DraftCartItem[] = [];

  for (const item of cart) {
    const request = requestsByName.get(normalizeText(item.name));
    if (!request) {
      updatedCart.push(item);
      continue;
    }

    if (request.qty === "all" || request.qty >= item.qty) {
      removed.push({
        name: item.name,
        removedQty: item.qty,
      });
      continue;
    }

    removed.push({
      name: item.name,
      removedQty: request.qty,
    });
    updatedCart.push({
      ...item,
      qty: item.qty - request.qty,
    });
  }

  return { updatedCart, removed };
}

function buildRemovedItemsMessage(removed: AppliedCartRemoval[], prefersRomanUrdu: boolean, updatedCart: DraftCartItem[]): string {
  const removedSummary = removed
    .map((item) => `*${item.name} x${item.removedQty}*`)
    .join(", ");
  const removalLine = prefersRomanUrdu
    ? `Theek hai, maine ${removedSummary} remove kar diya.`
    : `Done, I removed ${removedSummary}.`;

  return [removalLine, `*Subtotal:* Rs. ${getCartSubtotal(updatedCart)}`].join("\n");
}

function findCartQuantityMutations(text: string, cart: DraftCartItem[]): CartQuantityMutation[] {
  if (cart.length === 0) return [];
  const normalized = normalizeText(text);
  if (!hasQuantityMutationIntent(normalized)) return [];

  const cartMenuItems = cartToMenuItems(cart);
  const segments = normalized.split(SPLIT_CONNECTORS_PATTERN).map((segment) => segment.trim()).filter(Boolean);
  const mutationsByName = new Map<string, CartQuantityMutation>();

  for (const segment of segments) {
    const qty = extractAnyQuantity(segment);
    if (!qty || qty <= 0) continue;
    const matched = resolveMenuMatchesFromSegment(segment, cartMenuItems);
    if (matched.length === 0) continue;

    const [firstMatch] = matched;
    mutationsByName.set(normalizeText(firstMatch.name), {
      name: firstMatch.name,
      qty,
    });
  }

  if (mutationsByName.size === 0 && cart.length === 1 && /\b(make|set|change|update)\s+(it|that|this)\b/.test(normalized)) {
    const fallbackQty = extractAnyQuantity(normalized);
    if (fallbackQty && fallbackQty > 0) {
      mutationsByName.set(normalizeText(cart[0].name), {
        name: cart[0].name,
        qty: fallbackQty,
      });
    }
  }

  return [...mutationsByName.values()];
}

function applyCartQuantityMutations(cart: DraftCartItem[], mutations: CartQuantityMutation[]): DraftCartItem[] {
  const mutationByName = new Map(mutations.map((mutation) => [normalizeText(mutation.name), mutation.qty] as const));
  return cart.map((item) => {
    const nextQty = mutationByName.get(normalizeText(item.name));
    if (!nextQty) return item;
    return {
      ...item,
      qty: nextQty,
    };
  });
}

function buildQuantityUpdatedMessage(
  mutations: CartQuantityMutation[],
  prefersRomanUrdu: boolean,
  updatedCart: DraftCartItem[],
): string {
  const summary = mutations.map((mutation) => `*${mutation.name} x${mutation.qty}*`).join(", ");
  const line = prefersRomanUrdu
    ? `Theek hai, maine quantity update kar di: ${summary}.`
    : `Done, I updated the quantity: ${summary}.`;
  return [line, `*Subtotal:* Rs. ${getCartSubtotal(updatedCart)}`].join("\n");
}

function handleResolvedAdditions(
  additions: DraftCartItem[],
  context: TurnContext,
  preferredLanguage: LanguagePreference,
  prefersRomanUrdu: boolean,
): TurnDecision {
  const mergedCart = mergeCartItems(context.state.cart, additions);
  const baseContext: TurnContext = {
    ...context,
    state: {
      ...context.state,
      cart: mergedCart,
      preferred_language: preferredLanguage,
      workflow_step: mergedCart.length > 0 ? "collecting_items" : context.state.workflow_step,
      last_presented_category: additions[0]?.category ?? null,
      last_presented_at: new Date().toISOString(),
    },
  };

  const prefix = buildAddedItemsMessage(additions, prefersRomanUrdu, mergedCart);
  const bundledCheckoutDetails =
    detectOrderType(normalizeText(context.messageText)) != null ||
    parseAddress(context.messageText) != null ||
    parseGuestCount(normalizeText(context.messageText)) != null ||
    parseReservationTime(normalizeText(context.messageText)) != null;

  if (!context.state.upsell_offered && !bundledCheckoutDetails) {
    const upsell = pickUpsell(mergedCart, context.menuItems, context.state.declined_upsells);
    if (upsell && !cartAlreadyHasItem(mergedCart, upsell.name)) {
      const question = prefersRomanUrdu
        ? `Kya aap *${upsell.name}* bhi add karna chahenge? - Rs. ${upsell.price}`
        : `Would you like to add *${upsell.name}* as well? - Rs. ${upsell.price}`;
      return replyDecision(
        [prefix, question].join("\n"),
        {
          cart: mergedCart,
          workflow_step: "awaiting_upsell_reply",
          upsell_offered: true,
          upsell_item_name: upsell.name,
          upsell_item_price: upsell.price,
          last_presented_category: additions[0]?.category ?? null,
          last_presented_at: new Date().toISOString(),
        },
        preferredLanguage,
      );
    }
  }

  return buildLogisticsOrSummaryReply({
    ...baseContext,
    overrideReplyPrefix: prefix,
  });
}

function cartAlreadyHasItem(cart: DraftCartItem[], itemName: string): boolean {
  return cart.some((item) => normalizeText(item.name) === normalizeText(itemName));
}

function getCartSubtotal(cart: DraftCartItem[]): number {
  return cart.reduce((total, item) => total + item.price * item.qty, 0);
}

function buildAddedItemsMessage(items: DraftCartItem[], prefersRomanUrdu: boolean, mergedCart: DraftCartItem[]): string {
  const lines = items.map((item) =>
    prefersRomanUrdu ? `- *${item.name} x${item.qty}* add kar diya.` : `- Added *${item.name} x${item.qty}*.`,
  );
  lines.push(`*Subtotal:* Rs. ${getCartSubtotal(mergedCart)}`);
  return lines.join("\n");
}

function pickUpsell(
  cart: DraftCartItem[],
  menuItems: MenuCatalogItem[],
  declinedUpsells: string[],
): MenuCatalogItem | null {
  const cartText = cart.map((item) => normalizeText(item.name)).join(" ");
  const declinedSet = new Set(declinedUpsells.map((name) => normalizeText(name)));
  const pairingPreferences = [
    { when: /(karahi)/, suggestions: ["naan", "tandoori roti"] },
    { when: /(biryani|rice)/, suggestions: ["raita", "salad"] },
    { when: /(bbq|tikka|kabab|seekh)/, suggestions: ["naan", "raita", "drink", "cold drink"] },
    { when: /(burger|sandwich)/, suggestions: ["fries", "drink", "cold drink"] },
  ];

  for (const preference of pairingPreferences) {
    if (!preference.when.test(cartText)) continue;
    for (const suggestion of preference.suggestions) {
      const found = menuItems.find(
        (item) => item.is_available && normalizeText(item.name).includes(suggestion) && !declinedSet.has(normalizeText(item.name)),
      );
      if (found) return found;
    }
  }

  return null;
}

function getSuggestedUpsellItem(state: ConversationState, menuItems: MenuCatalogItem[]): MenuCatalogItem | null {
  const upsellItemName = state.upsell_item_name;
  if (!upsellItemName) return null;
  return menuItems.find((item) => item.is_available && normalizeText(item.name) === normalizeText(upsellItemName)) ?? null;
}

function addDeclinedUpsell(history: string[], itemName: string | null): string[] {
  if (!itemName) return history;
  const normalizedItem = normalizeText(itemName);
  if (!normalizedItem) return history;
  if (history.some((name) => normalizeText(name) === normalizedItem)) return history;
  return [...history, itemName];
}

function hasPendingSingleItemConfirmation(state: ConversationState): boolean {
  const canUsePendingConfirmation =
    state.workflow_step === "idle" ||
    state.workflow_step === "collecting_items" ||
    state.workflow_step === "awaiting_order_type";
  if (!canUsePendingConfirmation) return false;

  return Boolean(
    state.upsell_item_name &&
      typeof state.upsell_item_price === "number" &&
      Number.isFinite(state.upsell_item_price) &&
      !state.upsell_offered,
  );
}

function getPendingSingleItem(state: ConversationState, menuItems: MenuCatalogItem[]): MenuCatalogItem | null {
  if (!hasPendingSingleItemConfirmation(state)) return null;
  const pendingName = state.upsell_item_name;
  if (!pendingName) return null;

  return (
    menuItems.find((item) => normalizeText(item.name) === normalizeText(pendingName)) ??
    menuItems.find((item) => normalizeCompactText(item.name) === normalizeCompactText(pendingName)) ??
    null
  );
}

function buildCategoryListReply(menuItems: MenuCatalogItem[], prefersRomanUrdu: boolean): string {
  const categories = getMenuCategories(menuItems);
  if (categories.length === 0) {
    return prefersRomanUrdu
      ? "Menu abhi temporarily unavailable hai. Please thori der baad try karein."
      : "The menu is temporarily unavailable right now. Please try again shortly.";
  }

  return [
    prefersRomanUrdu ? "Yeh hamari categories hain:" : "Here are our menu categories:",
    ...categories.map((category) => `- *${category}*`),
    prefersRomanUrdu ? "Konsi category dekhna chahenge?" : "Which category would you like to see?",
  ].join("\n");
}

function findCategoryRequest(text: string, menuItems: MenuCatalogItem[]): string | null {
  const normalized = normalizeText(text);
  const categories = getMenuCategories(menuItems);
  const requestTokens = getMeaningfulTokens(normalized);

  for (const category of categories) {
    const categoryText = normalizeText(category);
    const singular = categoryText.endsWith("s") ? categoryText.slice(0, -1) : categoryText;
    if ((normalized.includes(categoryText) || normalized.includes(singular)) && hasAny(normalized, CATEGORY_QUESTION_WORDS)) {
      return category;
    }
    if (normalized === categoryText || normalized === singular) {
      return category;
    }
    if (categoryMatchesTokens(categoryText, requestTokens)) {
      return category;
    }
  }

  return null;
}

function categoryMatchesTokens(categoryText: string, requestTokens: string[]): boolean {
  if (requestTokens.length === 0) return false;

  const categoryTokens = getMeaningfulTokens(categoryText);
  const expandedCategoryTokens = new Set<string>(categoryTokens);

  for (const token of categoryTokens) {
    const aliases = CATEGORY_ALIASES[token];
    if (!aliases) continue;
    for (const alias of aliases) {
      for (const aliasToken of getMeaningfulTokens(alias)) {
        expandedCategoryTokens.add(aliasToken);
      }
    }
  }

  return requestTokens.some((token) => expandedCategoryTokens.has(token));
}

function getMeaningfulTokens(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .map(singularizeToken)
    .filter((token) => token.length > 2 && !AMBIGUOUS_QUERY_STOPWORDS.has(token));
}

function singularizeToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
}

function buildCategoryItemsReply(category: string, menuItems: MenuCatalogItem[], prefersRomanUrdu: boolean): string {
  const items = menuItems.filter((item) => (item.category ?? "General") === category);
  const intro = prefersRomanUrdu ? `*${category}* mein yeh items hain:` : `Here are the items in *${category}*:`;
  return [intro, ...items.map((item) => `- *${item.name}* - Rs. ${item.price}`)].join("\n");
}

function getMenuCategories(menuItems: MenuCatalogItem[]): string[] {
  return [...new Set(menuItems.map((item) => item.category?.trim() || "General"))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function findSingleMenuItemReference(text: string, menuItems: MenuCatalogItem[]): MenuCatalogItem | null {
  const matches = extractCartItems(text, menuItems, true);
  if (matches.length === 1) {
    return menuItems.find((item) => normalizeText(item.name) === normalizeText(matches[0].name)) ?? null;
  }

  const tokenMatches = findTokenMatchedItems(text, menuItems);
  if (tokenMatches.length === 1) return tokenMatches[0];

  const fuzzyMatches = findFuzzyMenuMatches(text, menuItems);
  if (fuzzyMatches.length === 1) return fuzzyMatches[0];

  const likely = findLikelyMenuSuggestions(text, menuItems, 1);
  return likely.length === 1 ? likely[0] : null;
}

function findAmbiguousMenuMatches(text: string, menuItems: MenuCatalogItem[]): MenuCatalogItem[] {
  const normalized = normalizeText(text);
  const tokens = getMeaningfulTokens(normalized);
  if (tokens.length === 0) return [];

  const matches = menuItems.filter((item) => {
    const itemTokens = getMeaningfulTokens(item.name);

    if (tokens.length === 1) {
      return itemTokens.includes(tokens[0]);
    }

    return tokens.every((token) => itemTokens.includes(token));
  });

  return matches.length > 1 ? matches : [];
}

function findBundleAliasMatches(text: string, menuItems: MenuCatalogItem[]): MenuCatalogItem[] {
  const normalized = normalizeText(text);
  const matchedAliasKeys = Object.entries(BUNDLE_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => hasPhrase(normalized, alias)))
    .map(([key]) => key);

  if (matchedAliasKeys.length === 0) return [];

  const seen = new Set<string>();
  const results: MenuCatalogItem[] = [];

  const pushIfMatch = (item: MenuCatalogItem, condition: boolean) => {
    if (!condition || seen.has(item.id)) return;
    seen.add(item.id);
    results.push(item);
  };

  for (const key of matchedAliasKeys) {
    for (const item of menuItems) {
      const itemText = normalizeText(item.name);
      if (key === "family_deal") {
        pushIfMatch(item, /\bfamily\b/.test(itemText) && /\b(deal|combo|package|platter|bucket|offer)\b/.test(itemText));
        continue;
      }

      if (key === "deal_one") {
        pushIfMatch(item, /\bdeal\s*(1|one)\b/.test(itemText) || /\b(1|one)\s*deal\b/.test(itemText));
        continue;
      }

      if (key === "combo_deal") {
        pushIfMatch(item, /\b(combo|deal|package|platter|bucket|offer)\b/.test(itemText));
      }
    }
  }

  if (results.length === 0 && matchedAliasKeys.includes("deal_one")) {
    const numericCandidates = menuItems.filter((item) => /\b1\b/.test(normalizeText(item.name)));
    for (const item of numericCandidates) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      results.push(item);
    }
  }

  return results.slice(0, 6);
}

function findTokenMatchedItems(text: string, menuItems: MenuCatalogItem[]): MenuCatalogItem[] {
  const requestTokens = getMeaningfulTokens(text);
  if (requestTokens.length === 0) {
    return findBundleAliasMatches(text, menuItems);
  }
  const compactRequest = requestTokens.join("");

  const tokenMatches = menuItems.filter((item) => {
    const itemTokens = getMeaningfulTokens(item.name).filter((token) => !MENU_DESCRIPTOR_TOKENS.has(token));
    if (itemTokens.length === 0) return false;

    const tokenAligned = requestTokens.every((requestToken) =>
      itemTokens.some(
        (itemToken) =>
          itemToken === requestToken || itemToken.startsWith(requestToken) || requestToken.startsWith(itemToken),
      ),
    );
    if (tokenAligned) return true;

    if (requestTokens.length === 1 && requestTokens[0].length >= 4) {
      return itemTokens.some(
        (itemToken) =>
          itemToken.startsWith(requestTokens[0]) || getNormalizedSimilarity(itemToken, requestTokens[0]) >= 0.8,
      );
    }

    if (compactRequest.length >= 5) {
      const itemCompact = itemTokens.join("");
      return itemCompact.includes(compactRequest);
    }

    return false;
  });

  if (tokenMatches.length > 0) return tokenMatches;
  return findBundleAliasMatches(text, menuItems);
}

function findFuzzyMenuMatches(text: string, menuItems: MenuCatalogItem[]): MenuCatalogItem[] {
  const requestTokens = getMeaningfulTokens(text);
  const requestText = requestTokens.join(" ");
  const requestCompact = requestTokens.join("");
  if (requestText.length < 3 && requestCompact.length < 4) {
    return findBundleAliasMatches(text, menuItems);
  }

  const scored = menuItems
    .map((item) => ({
      item,
      score: getFuzzyItemScore(requestText, requestCompact, item),
    }))
    .filter((entry) => entry.score >= FUZZY_ITEM_AMBIGUOUS_THRESHOLD)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) return findBundleAliasMatches(text, menuItems);

  const [best, second] = scored;
  if (best.score >= FUZZY_ITEM_AUTO_MATCH_THRESHOLD && (!second || best.score - second.score >= FUZZY_ITEM_MIN_MARGIN)) {
    return [best.item];
  }

  return scored.slice(0, 6).map((entry) => entry.item);
}

function findLikelyMenuSuggestions(text: string, menuItems: MenuCatalogItem[], limit = 3, minScore = 0.56): MenuCatalogItem[] {
  const bundleAliasMatches = findBundleAliasMatches(text, menuItems);
  if (bundleAliasMatches.length > 0) {
    return bundleAliasMatches.slice(0, limit);
  }

  const requestTokens = getMeaningfulTokens(text);
  if (requestTokens.length === 0) return [];
  const requestText = requestTokens.join(" ");
  const requestCompact = requestTokens.join("");

  return menuItems
    .map((item) => ({
      item,
      score: getFuzzyItemScore(requestText, requestCompact, item),
    }))
    .filter((entry) => entry.score >= minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

function getFuzzyItemScore(requestText: string, requestCompact: string, item: MenuCatalogItem): number {
  const itemTokens = getMeaningfulTokens(item.name).filter((token) => !MENU_DESCRIPTOR_TOKENS.has(token));
  const itemText = itemTokens.join(" ");
  const itemCompact = itemTokens.join("");
  if (!itemText) return 0;

  const directSimilarity = getNormalizedSimilarity(requestText, itemText);
  const requestTokens = requestText.split(" ");
  const tokenSimilarity =
    requestTokens.length === 0
      ? 0
      : requestTokens.reduce((total, requestToken) => {
          const bestTokenScore = itemTokens.reduce((best, itemToken) => {
            return Math.max(best, getNormalizedSimilarity(requestToken, itemToken));
          }, 0);
          return total + bestTokenScore;
        }, 0) / requestTokens.length;
  const compactSimilarity = requestCompact.length >= 4 ? getNormalizedSimilarity(requestCompact, itemCompact) : 0;
  const compactContainment =
    requestCompact.length >= 5 && (itemCompact.includes(requestCompact) || requestCompact.includes(itemCompact))
      ? 0.97
      : 0;
  const prefixCoverage =
    requestTokens.length === 0
      ? 0
      : requestTokens.reduce((total, requestToken) => {
          const matched = itemTokens.some((itemToken) => itemToken.startsWith(requestToken));
          return total + (matched ? 1 : 0);
        }, 0) / requestTokens.length;

  return Math.max(directSimilarity, tokenSimilarity, compactSimilarity * 0.98, compactContainment, prefixCoverage * 0.9);
}

function getNormalizedSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 1;
  const distance = getLevenshteinDistance(left, right);
  return 1 - distance / maxLength;
}

function getLevenshteinDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let col = 0; col < cols; col += 1) matrix[0][col] = col;

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost,
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function getSingleCategoryOrNull(items: MenuCatalogItem[]): string | null {
  const categories = [...new Set(items.map((item) => item.category ?? "General"))];
  return categories.length === 1 ? categories[0] : null;
}

function withPreferredLanguage(
  statePatch: Partial<ConversationState>,
  preferredLanguage: LanguagePreference,
): Partial<ConversationState> {
  return {
    ...statePatch,
    preferred_language: preferredLanguage,
  };
}

function persistDraftState(
  state: ConversationState,
  overrides: Partial<ConversationState>,
): Partial<ConversationState> {
  return {
    cart: state.cart,
    declined_upsells: state.declined_upsells,
    resume_workflow_step: state.resume_workflow_step,
    last_presented_category: state.last_presented_category,
    last_presented_at: state.last_presented_at,
    order_type: state.order_type,
    address: state.address,
    guests: state.guests,
    reservation_time: state.reservation_time,
    upsell_item_name: state.upsell_item_name,
    upsell_item_price: state.upsell_item_price,
    upsell_offered: state.upsell_offered,
    summary_sent_at: state.summary_sent_at,
    ...overrides,
  };
}

function formatSummary(state: ConversationState, settings: RestaurantSettings, prefersRomanUrdu: boolean): string {
  const subtotal = getCartSubtotal(state.cart);
  const deliveryFee =
    state.order_type === "delivery" && settings.delivery_enabled && settings.delivery_fee > 0
      ? Number(settings.delivery_fee)
      : 0;
  const total = subtotal + deliveryFee;

  const lines = [prefersRomanUrdu ? "*Aap ka Order:*" : "*Your Order:*"];
  for (const item of state.cart) {
    lines.push(`- ${item.name} x${item.qty} - Rs. ${item.price * item.qty}`);
  }

  lines.push(`*Subtotal:* Rs. ${subtotal}`);
  if (state.order_type === "delivery") {
    lines.push(deliveryFee > 0 ? `*Delivery Fee:* Rs. ${deliveryFee}` : "*Delivery:* Free");
    lines.push(`*Total:* Rs. ${total}`);
    lines.push("*Type:* Delivery");
    lines.push(`*Address:* ${state.address ?? "-"}`);
  } else {
    lines.push("*Type:* Dine-in");
    lines.push(`*Guests:* ${state.guests ?? "-"}`);
    lines.push(`*Time:* ${formatReservationTime(state.reservation_time)}`);
  }

  lines.push(
    prefersRomanUrdu
      ? "Reply *Haan* ya *Yes* likh dein order confirm karne ke liye."
      : "Reply *Haan* or *Yes* to confirm your order.",
  );

  return lines.join("\n");
}

function formatReservationTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildGreeting(prefersRomanUrdu: boolean): string {
  return prefersRomanUrdu
    ? `Walaikum Assalam! Welcome to *${process.env.NEXT_PUBLIC_APP_NAME || "Tandoori"}*. Aaj aap ko kya bhejun?`
    : `Assalam o Alaikum! Welcome to *${process.env.NEXT_PUBLIC_APP_NAME || "Tandoori"}*. How can I help you today?`;
}

function buildClosedReply(settings: RestaurantSettings, prefersRomanUrdu: boolean): string {
  const phone = settings.phone_delivery || "our support line";
  return prefersRomanUrdu
    ? `Hum is waqt closed hain. Hamare hours ${settings.opening_time} se ${settings.closing_time} tak hain. Aap menu pooch sakte hain, lekin order place nahi ho sakta. Zarurat ho to call karein: ${phone}`
    : `We are currently closed. Our hours are ${settings.opening_time} to ${settings.closing_time}. I can still help with the menu, but I cannot place an order right now. For urgent help, call ${phone}.`;
}

function buildRecentOrderReply(order: RecentOrderContext, prefersRomanUrdu: boolean): string {
  const statusLabel = order.status.replaceAll("_", " ");
  return prefersRomanUrdu
    ? `Aap ka latest order #${order.order_number} is waqt *${statusLabel}* hai.`
    : `Your latest order #${order.order_number} is currently *${statusLabel}*.`;
}

function buildDeliveryMinimumNote(settings: RestaurantSettings, prefersRomanUrdu: boolean): string | null {
  if (!settings.min_delivery_amount || settings.min_delivery_amount <= 0) return null;
  return prefersRomanUrdu
    ? `Delivery minimum Rs. ${settings.min_delivery_amount} hai.`
    : `The minimum order for delivery is Rs. ${settings.min_delivery_amount}.`;
}

function buildOrderPlacedReply(settings: RestaurantSettings, prefersRomanUrdu: boolean): string {
  const phone = settings.phone_delivery || "our support line";
  return prefersRomanUrdu
    ? `Your order has been placed successfully. Hum jaldi aap se rabta karenge. Queries ke liye call karein ${phone}`
    : `Your order has been placed successfully. We'll be with you shortly. For queries, call ${phone}`;
}

function maybeAppendCheckoutPrompt(
  reply: string,
  state: ConversationState,
  prefersRomanUrdu: boolean,
): string {
  const prompt = buildResumePrompt(state, prefersRomanUrdu);
  if (!prompt) return reply;
  return `${reply}\n\n${prompt}`;
}

function buildResumePrompt(state: ConversationState, prefersRomanUrdu: boolean): string | null {
  if (state.cart.length === 0 || state.workflow_step === "idle") return null;

  const step = state.workflow_step === "awaiting_resume_decision" ? getResumeWorkflowStep(state) : state.workflow_step;

  switch (step) {
    case "collecting_items":
      return prefersRomanUrdu
        ? "Jab ready hon, aur items bhej dein ya bata dein delivery chahiye ya dine-in."
        : "When you're ready, add more items or tell me whether you'd like delivery or dine-in.";
    case "awaiting_upsell_reply":
      return prefersRomanUrdu
        ? "Saath hi batayein suggested add-on chahiye ya nahi."
        : "You can also tell me whether you'd like the suggested add-on.";
    case "awaiting_order_type":
      return prefersRomanUrdu
        ? "Jab ready hon, bas bata dein delivery chahiye ya dine-in."
        : "When you're ready, just tell me whether you'd like delivery or dine-in.";
    case "awaiting_delivery_address":
      return prefersRomanUrdu
        ? "Jab ready hon, apna full delivery address bhej dein."
        : "When you're ready, send me your full delivery address.";
    case "awaiting_dine_in_details":
      return prefersRomanUrdu
        ? "Jab ready hon, guests ki tadaad aur preferred time bhej dein."
        : "When you're ready, send the guest count and your preferred time.";
    case "awaiting_confirmation":
      return prefersRomanUrdu
        ? "Agar sab theek hai to *Haan* likh dein, warna jo change karna ho bata dein."
        : "If everything looks good, reply *Yes*, or tell me what you'd like to change.";
    default:
      return null;
  }
}
