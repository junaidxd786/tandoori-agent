import assert from "node:assert/strict";
import {
  buildInteractiveCategoryList,
  buildInteractiveListForCities,
  dedupeCities,
  findCitySelection,
} from "../lib/webhook-city-helpers.ts";
import {
  buildBranchSelectionFlowMessage,
  buildFlowMessageForAgentReply,
  buildInteractiveListForBranches,
  buildInteractiveListForPresentedOptions,
} from "../lib/webhook-interactive-builders.ts";

function pass(message) {
  console.log(`PASS: ${message}`);
}

function testCityHelpers() {
  const deduped = dedupeCities(["Lahore", "lahore", "Karachi", "KARACHI"]);
  assert.equal(deduped.length, 2);
  assert.equal(findCitySelection("city_option_2", ["Lahore", "Karachi"]), "Karachi");
  assert.equal(findCitySelection("2", ["Lahore", "Karachi"]), "Karachi");

  const cityList = buildInteractiveListForCities(["Lahore", "Karachi"], false);
  assert.ok(cityList);
  assert.equal(cityList.rows[0].id, "city_option_1");
  pass("City helpers dedupe and interactive selection parsing work.");
}

function testCategoryInteractivePagination() {
  const menuItems = Array.from({ length: 11 }).map((_, index) => ({
    category: `Category ${index + 1}`,
  }));
  const page1 = buildInteractiveCategoryList(menuItems, false, 1);
  assert.ok(page1);
  assert.equal(page1.rows.length, 10);
  assert.ok(page1.rows.some((row) => row.id === "category_more_2"));
  pass("Category interactive builder paginates and emits category_more controls.");
}

function testInteractiveBuilders() {
  const presented = buildInteractiveListForPresentedOptions(
    [
      { id: "i1", name: "Chicken Karahi", price: 1395, category: "Pakistani", is_available: true },
      { id: "i2", name: "Kheer", price: 295, category: "Desserts", is_available: true },
    ],
    false,
  );
  assert.ok(presented);
  assert.equal(presented.rows.length, 2);

  const branchList = buildInteractiveListForBranches(
    [{ id: "b1", name: "Main Branch", slug: "main", address: "Mall Road, Lahore" }],
    false,
    "Lahore",
  );
  assert.ok(branchList);
  assert.equal(branchList.rows[0].id, "b1");
  pass("Interactive list builders return expected list payloads.");
}

function testFlowBuilders() {
  const previousFlowName = process.env.WHATSAPP_FLOW_NAME;
  process.env.WHATSAPP_FLOW_NAME = "test_flow";

  const branchFlow = buildBranchSelectionFlowMessage(
    "923001112233",
    [{ id: "b1", name: "Main Branch", slug: "main", address: "Mall Road, Lahore" }],
    false,
  );
  assert.ok(branchFlow);

  const checkoutFlow = buildFlowMessageForAgentReply({
    conversationId: "conv1",
    prefersRomanUrdu: false,
    workflowStep: "awaiting_order_type",
    body: "Please choose your order type.",
  });
  assert.ok(checkoutFlow);
  assert.equal(checkoutFlow.body, "Please choose your order type.");

  process.env.WHATSAPP_FLOW_NAME = previousFlowName;
  pass("Flow payload builders create payloads for branch and checkout contexts.");
}

try {
  testCityHelpers();
  testCategoryInteractivePagination();
  testInteractiveBuilders();
  testFlowBuilders();
} catch (error) {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
}
