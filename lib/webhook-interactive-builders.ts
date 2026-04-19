import type { BranchSummary } from "./branches";
import type { ConversationState, MenuCatalogItem } from "./order-engine";
import type { RestaurantSettings } from "./settings";
import { buildWhatsAppFlowPayload, type WhatsAppFlowContext } from "./whatsapp-flow.ts";
import type { WhatsAppInteractiveFlowPayload } from "./whatsapp";

type InteractiveListPayload =
  | {
    body: string;
    buttonText: string;
    sectionTitle?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }
  | null;

export function buildInteractiveListForPresentedOptions(
  options: MenuCatalogItem[],
  prefersRomanUrdu: boolean,
): InteractiveListPayload {
  if (!Array.isArray(options) || options.length < 1) {
    return null;
  }

  const rows = options.slice(0, 10).map((item) => ({
    id: item.id,
    title: item.name,
    description: `Rs. ${item.price}${item.category ? ` - ${item.category}` : ""}`,
  }));

  return {
    body: prefersRomanUrdu
      ? "Apni pasand ka item list se select karein."
      : "Please choose your item from the list.",
    buttonText: prefersRomanUrdu ? "Select Item" : "Select Item",
    sectionTitle: prefersRomanUrdu ? "Menu Options" : "Menu Options",
    rows,
  };
}

export function buildInteractiveListForBranches(
  branches: BranchSummary[],
  prefersRomanUrdu: boolean,
  selectedCity?: string,
): InteractiveListPayload {
  if (!Array.isArray(branches) || branches.length < 1) {
    return null;
  }

  const rows = branches.slice(0, 10).map((branch) => ({
    id: branch.id,
    title: branch.name,
    description: branch.address || undefined,
  }));

  return {
    body: prefersRomanUrdu
      ? selectedCity
        ? `*${selectedCity}* mein apni branch select karein.`
        : "Order shuru karne se pehle apni branch select karein."
      : selectedCity
        ? `Please choose your branch in *${selectedCity}*.`
        : "Before we start your order, please choose your branch.",
    buttonText: prefersRomanUrdu ? "Select Branch" : "Select Branch",
    sectionTitle: prefersRomanUrdu ? "Branches" : "Branches",
    rows,
  };
}

export function buildBranchSelectionFlowMessage(
  phone: string,
  branches: BranchSummary[],
  prefersRomanUrdu: boolean,
): WhatsAppInteractiveFlowPayload | null {
  return buildWhatsAppFlowPayload({
    context: "branch",
    body: prefersRomanUrdu
      ? "Branch choose karne ke liye rich menu khol dein."
      : "Open the rich branch picker to continue.",
    preferredLanguage: prefersRomanUrdu ? "roman_urdu" : "english",
    branches,
    workflowStep: "awaiting_branch_selection",
    conversationId: phone,
  });
}

export function buildFlowMessageForAgentReply(input: {
  context?: WhatsAppFlowContext;
  conversationId: string;
  prefersRomanUrdu: boolean;
  workflowStep: ConversationState["workflow_step"];
  branch?: { id: string; slug?: string | null; name: string; address?: string | null } | null;
  branches?: BranchSummary[];
  menuItems?: MenuCatalogItem[];
  cart?: ConversationState["cart"];
  customerInstructions?: ConversationState["customer_instructions"];
  orderType?: ConversationState["order_type"];
  address?: ConversationState["address"];
  guests?: ConversationState["guests"];
  reservationTime?: ConversationState["reservation_time"];
  settings?: RestaurantSettings;
  suggestedUpsell?: { name: string; price: number } | null;
  body: string;
}): WhatsAppInteractiveFlowPayload | null {
  const context = input.context ?? inferFlowContext(input.workflowStep);
  if (!context) return null;

  return buildWhatsAppFlowPayload({
    context,
    conversationId: input.conversationId,
    body: input.body,
    preferredLanguage: input.prefersRomanUrdu ? "roman_urdu" : "english",
    workflowStep: input.workflowStep,
    branch: input.branch ?? undefined,
    branches: input.branches,
    menuItems: input.menuItems,
    cart: input.cart,
    customerInstructions: input.customerInstructions,
    orderType: input.orderType,
    address: input.address,
    guests: input.guests,
    reservationTime: input.reservationTime,
    settings: input.settings,
    suggestedUpsell: input.suggestedUpsell,
  });
}

function inferFlowContext(workflowStep: ConversationState["workflow_step"]): WhatsAppFlowContext | null {
  if (workflowStep === "awaiting_branch_selection") return "branch";
  if (workflowStep === "awaiting_upsell_reply") return "upsell";
  if (
    workflowStep === "awaiting_order_type" ||
    workflowStep === "awaiting_delivery_address" ||
    workflowStep === "awaiting_dine_in_details" ||
    workflowStep === "awaiting_confirmation"
  ) {
    return "checkout";
  }

  if (
    workflowStep === "idle" ||
    workflowStep === "collecting_items"
  ) {
    return "menu";
  }

  return null;
}
