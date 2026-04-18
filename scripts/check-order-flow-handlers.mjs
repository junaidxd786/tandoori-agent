import assert from "node:assert/strict";
import { handleAwaitingConfirmationFlow, handleLogisticsAndFallbackFlow } from "../lib/order-flow-handlers.ts";

function pass(message) {
  console.log(`PASS: ${message}`);
}

function baseState(overrides = {}) {
  return {
    conversation_id: "conv_test",
    workflow_step: "collecting_items",
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
    ...overrides,
  };
}

function makeReplyDecision(reply, statePatch, trace, interactiveList = null) {
  return {
    kind: "reply",
    reply,
    statePatch,
    trace,
    interactiveList,
  };
}

function withPreferredLanguage(patch, preferredLanguage) {
  return {
    ...patch,
    preferred_language: preferredLanguage,
  };
}

function createSharedHelpers() {
  return {
    extractOrderInstructionCandidate: () => null,
    buildSummaryReply: ({ state }) => makeReplyDecision("summary", state),
    replyDecision: makeReplyDecision,
    withPreferredLanguage,
    shouldDeferToContextSwitchFallback: () => false,
    buildUnknownItemReplyData: () => ({ text: "unknown", selectableItems: [] }),
  };
}

function testAwaitingConfirmationPlacesOrder() {
  const state = baseState({
    workflow_step: "awaiting_confirmation",
    cart: [{ name: "CHICKEN KARAHI", qty: 1, price: 1395, category: "Pakistani", size: null, addons: [], item_instructions: null }],
  });
  const context = {
    messageText: "yes confirm order",
    state,
    menuItems: [],
    semanticMatches: [],
    branch: { id: "b1", name: "Main", address: "City" },
    settings: {
      delivery_enabled: true,
      delivery_fee: 0,
      opening_time: "10:00",
      closing_time: "23:00",
      phone_delivery: "000",
    },
    isOpenNow: true,
    recentOrder: null,
    session: { invalid_step_count: 0 },
  };

  const helpers = {
    ...createSharedHelpers(),
    isExplicitYes: () => true,
    validateDraftForPlacement: () => ({
      ok: true,
      order: {
        items: state.cart,
        type: "delivery",
        subtotal: 1395,
        delivery_fee: 0,
        address: null,
        guests: null,
        reservation_time: null,
        customer_instructions: null,
      },
    }),
    buildOrderPlacedReply: () => "Order placed OK",
    resetDraftState: () => ({ workflow_step: "idle", cart: [] }),
    isExplicitNo: () => false,
    mutateCart: (currentCart) => ({ cart: currentCart, removed: [] }),
    applyCartQtyUpdates: (currentCart) => currentCart,
    applyCheckoutSignalsToState: ({ state: nextState }) => nextState,
    buildLogisticsOrSummaryReply: ({ state: nextState }) => makeReplyDecision("logistics", nextState),
    buildRemovedItemsMessage: () => "",
    buildQtyUpdatedItemsMessage: () => "",
  };

  const interpretation = {
    wants_confirmation: true,
    intent: "confirm_order",
    add_items: [],
    unknown_items: [],
  };

  const result = handleAwaitingConfirmationFlow({
    context,
    interpretation,
    matchedAdds: { matched: [], unknown: [], ambiguous: [] },
    removeRequests: [],
    qtyUpdates: [],
    preferredLanguage: "english",
    trace: { intent: "confirm_order", confidence: 1, unknownItems: [], notes: null },
    helpers,
  });

  assert.equal(result.kind, "place_order");
  assert.equal(result.reply, "Order placed OK");
  assert.ok(result.statePatch.summary_sent_at);
  pass("Awaiting confirmation places order via extracted handler.");
}

function testLogisticsEmptyCartGuard() {
  const context = {
    messageText: "delivery",
    state: baseState({
      workflow_step: "awaiting_order_type",
      cart: [],
    }),
    menuItems: [],
    semanticMatches: [],
    branch: { id: "b1", name: "Main", address: "City" },
    settings: {
      delivery_enabled: true,
      delivery_fee: 0,
      opening_time: "10:00",
      closing_time: "23:00",
      phone_delivery: "000",
    },
    isOpenNow: true,
    recentOrder: null,
    session: { invalid_step_count: 0 },
  };

  const helpers = {
    ...createSharedHelpers(),
    isUpsellYes: () => false,
    isUpsellNo: () => false,
    mergeCartItems: (cart) => cart,
    buildOrderTypePrompt: () => "Order type prompt",
    buildOrderTypeInteractiveList: () => null,
    buildUpsellInteractiveList: () => ({ body: "upsell", buttonText: "Choose", rows: [] }),
    handleOrderTypeSelection: () => makeReplyDecision("order type selected", {}),
    inferGeneralQtyOverride: () => null,
    applyQtyOverride: (cart) => cart,
    buildClosedReply: () => "closed",
    inferLastItemQtyOverride: () => null,
    applyLastItemQtyOverride: (cart) => cart,
    parseOrderTypeShortcut: () => null,
    buildPersistedStatePatch: (state) => state,
    clampQty: (qty) => qty,
  };

  const interpretation = {
    wants_confirmation: null,
    intent: "set_order_type",
    add_items: [],
    unknown_items: [],
    order_type: "delivery",
  };

  const result = handleLogisticsAndFallbackFlow({
    context,
    interpretation,
    matchedAdds: { matched: [], unknown: [], ambiguous: [] },
    preferredLanguage: "english",
    trace: { intent: "set_order_type", confidence: 0.9, unknownItems: [], notes: null },
    helpers,
  });

  assert.equal(result.kind, "reply");
  assert.match(result.reply.toLowerCase(), /cart is empty|cart empty/);
  assert.equal(result.statePatch.workflow_step, "collecting_items");
  pass("Logistics handler enforces empty-cart guard in checkout steps.");
}

try {
  testAwaitingConfirmationPlacesOrder();
  testLogisticsEmptyCartGuard();
} catch (error) {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
}
