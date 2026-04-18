import { randomUUID } from "node:crypto";
import type { BranchSummary } from "./branches";
import type {
  DraftCartItem,
  LanguagePreference,
  MenuCatalogItem,
  OrderType,
  WorkflowStep,
} from "./order-engine";
import type { RestaurantSettings } from "./settings";
import type { WhatsAppInteractiveFlowPayload } from "./whatsapp";

export type WhatsAppFlowContext = "branch" | "menu" | "checkout" | "upsell";

type FlowPayloadInput = {
  context: WhatsAppFlowContext;
  conversationId?: string;
  body: string;
  preferredLanguage: LanguagePreference;
  workflowStep?: WorkflowStep;
  branch?: {
    id: string;
    slug?: string | null;
    name: string;
    address?: string | null;
  };
  branches?: BranchSummary[];
  menuItems?: MenuCatalogItem[];
  cart?: DraftCartItem[];
  customerInstructions?: string | null;
  orderType?: OrderType | null;
  address?: string | null;
  guests?: number | null;
  reservationTime?: string | null;
  settings?: RestaurantSettings;
  suggestedUpsell?: { name: string; price: number } | null;
};

const DEFAULT_CTA_BY_CONTEXT: Record<WhatsAppFlowContext, string> = {
  branch: "Select Branch",
  menu: "Browse Menu",
  checkout: "Checkout",
  upsell: "Choose Option",
};

const FLOW_CONTEXT_PREFIX: Record<WhatsAppFlowContext, string> = {
  branch: "BRANCH",
  menu: "MENU",
  checkout: "CHECKOUT",
  upsell: "UPSELL",
};

const FLOW_DATA_MENU_LIMIT = 40;
const FLOW_DATA_BRANCH_LIMIT = 10;
const FLOW_DATA_CART_LIMIT = 30;

type FlowResolvedConfig = {
  flowId?: string;
  flowName?: string;
  ctaText: string;
  mode: "draft" | "published";
  action: "navigate" | "data_exchange";
  screen?: string;
};

export function buildWhatsAppFlowPayload(input: FlowPayloadInput): WhatsAppInteractiveFlowPayload | null {
  const config = resolveFlowConfig(input.context);
  if (!config.flowId && !config.flowName) {
    return null;
  }

  const flowToken = buildFlowToken(input.context, input.conversationId);
  const data = buildFlowData(input);

  return {
    body: input.body,
    ctaText: config.ctaText,
    flowId: config.flowId,
    flowName: config.flowName,
    flowToken,
    mode: config.mode,
    action: config.action,
    actionPayload:
      config.action === "navigate"
        ? {
            ...(config.screen ? { screen: config.screen } : {}),
            data,
          }
        : undefined,
  };
}

export function extractFlowResponseCommand(responseJsonRaw: string): string | null {
  const payload = parseFlowResponseJson(responseJsonRaw);
  if (!payload) {
    return null;
  }

  const chunks: string[] = [];
  const freeText = pickString(payload, ["message", "command", "order_text", "input_text", "query"]);
  if (freeText) {
    chunks.push(freeText);
  }

  const selectedBranch = pickString(payload, [
    "selected_branch_id",
    "branch_id",
    "selected_branch",
    "branch",
  ]);
  if (selectedBranch) {
    chunks.push(selectedBranch);
  }

  const requestedItems = pickItemRequests(payload);
  for (const item of requestedItems) {
    if (!item.label) continue;
    if (item.qty <= 1) {
      chunks.push(item.label);
    } else {
      chunks.push(`${item.qty} ${item.label}`);
    }
  }

  const normalizedType = normalizeOrderType(
    pickString(payload, ["order_type", "fulfillment_type", "type", "service_type"]),
  );
  if (normalizedType) {
    chunks.push(normalizedType);
  }

  const address = pickString(payload, ["delivery_address", "address", "dropoff_address"]);
  if (address) {
    chunks.push(address);
  }

  const guests = pickNumber(payload, ["guests", "guest_count", "party_size"]);
  const reservationTime = pickString(payload, ["reservation_time", "dine_in_time", "time_slot", "arrival_time"]);
  if (guests && reservationTime) {
    chunks.push(`${guests} guests at ${reservationTime}`);
  } else {
    if (guests) chunks.push(`${guests} guests`);
    if (reservationTime) chunks.push(reservationTime);
  }

  if (pickBoolean(payload, ["confirm", "is_confirmed", "submit_order", "place_order"])) {
    chunks.push("yes confirm order");
  }

  const upsellChoice = pickString(payload, ["upsell_choice", "upsell", "addon_choice"]);
  if (upsellChoice) {
    chunks.push(upsellChoice);
  }

  if (chunks.length > 0) {
    return chunks.join("; ");
  }

  const primitiveSummary = summarizePrimitiveFields(payload);
  return primitiveSummary || null;
}

function resolveFlowConfig(context: WhatsAppFlowContext): FlowResolvedConfig {
  const prefix = FLOW_CONTEXT_PREFIX[context];
  const flowId = getEnv(`WHATSAPP_FLOW_${prefix}_ID`) || getEnv("WHATSAPP_FLOW_ID");
  const flowName = getEnv(`WHATSAPP_FLOW_${prefix}_NAME`) || getEnv("WHATSAPP_FLOW_NAME");
  const ctaText =
    getEnv(`WHATSAPP_FLOW_${prefix}_CTA`) ||
    getEnv("WHATSAPP_FLOW_CTA") ||
    DEFAULT_CTA_BY_CONTEXT[context];
  const screen = getEnv(`WHATSAPP_FLOW_${prefix}_SCREEN`) || getEnv("WHATSAPP_FLOW_SCREEN");
  const modeRaw = getEnv(`WHATSAPP_FLOW_${prefix}_MODE`) || getEnv("WHATSAPP_FLOW_MODE");
  const mode: "draft" | "published" = modeRaw === "draft" ? "draft" : "published";

  const actionRaw =
    getEnv(`WHATSAPP_FLOW_${prefix}_ACTION`) ||
    getEnv("WHATSAPP_FLOW_ACTION") ||
    (isTruthy(getEnv("WHATSAPP_FLOW_USE_DATA_EXCHANGE")) ? "data_exchange" : "navigate");
  const action: "navigate" | "data_exchange" = actionRaw === "data_exchange" ? "data_exchange" : "navigate";

  return {
    flowId,
    flowName,
    ctaText,
    mode,
    action,
    screen,
  };
}

function buildFlowToken(context: WhatsAppFlowContext, conversationId?: string): string {
  const random = randomUUID().replace(/-/g, "").slice(0, 12);
  const contextPart = `ctx=${context}`;
  const conversationPart = conversationId ? `;conv=${conversationId}` : "";
  return `${contextPart}${conversationPart};rid=${random}`;
}

function buildFlowData(input: FlowPayloadInput): Record<string, unknown> {
  const menuItems = (input.menuItems ?? []).slice(0, FLOW_DATA_MENU_LIMIT).map((item) => ({
    id: item.id,
    name: item.name,
    price: Number(item.price),
    category: item.category,
    is_available: item.is_available,
  }));
  const categories = [...new Set(menuItems.map((item) => item.category || "General"))];
  const cartItems = (input.cart ?? []).slice(0, FLOW_DATA_CART_LIMIT).map((item) => ({
    name: item.name,
    qty: item.qty,
    price: Number(item.price),
    category: item.category,
    size: item.size ?? null,
    addons: item.addons ?? [],
    item_instructions: item.item_instructions ?? null,
  }));
  const cartSubtotal = cartItems.reduce((sum, item) => sum + item.qty * item.price, 0);
  const deliveryFee =
    input.orderType === "delivery" && input.settings?.delivery_enabled
      ? Number(input.settings?.delivery_fee ?? 0)
      : 0;
  const total = cartSubtotal + deliveryFee;

  return {
    flow_context: input.context,
    preferred_language: input.preferredLanguage,
    workflow_step: input.workflowStep ?? null,
    conversation_id: input.conversationId ?? null,
    branch: input.branch
      ? {
          id: input.branch.id,
          slug: input.branch.slug ?? null,
          name: input.branch.name,
          address: input.branch.address ?? null,
        }
      : null,
    branches: (input.branches ?? []).slice(0, FLOW_DATA_BRANCH_LIMIT).map((branch) => ({
      id: branch.id,
      slug: branch.slug,
      name: branch.name,
      address: branch.address,
    })),
    menu_items: menuItems,
    menu_categories: categories,
    cart_items: cartItems,
    cart_subtotal: cartSubtotal,
    delivery_fee: deliveryFee,
    cart_total: total,
    customer_instructions: input.customerInstructions ?? null,
    order_type: input.orderType ?? null,
    address: input.address ?? null,
    guests: input.guests ?? null,
    reservation_time: input.reservationTime ?? null,
    city: input.settings?.city ?? null,
    min_delivery_amount: Number(input.settings?.min_delivery_amount ?? 0),
    suggested_upsell: input.suggestedUpsell ?? null,
    generated_at: new Date().toISOString(),
  };
}

function parseFlowResponseJson(responseJsonRaw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(responseJsonRaw) as unknown;
    if (!isRecord(parsed)) return null;

    const extensionResponse = parsed.extension_message_response;
    if (isRecord(extensionResponse) && isRecord(extensionResponse.params)) {
      return extensionResponse.params as Record<string, unknown>;
    }

    if (isRecord(parsed.params)) {
      return parsed.params as Record<string, unknown>;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pickString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

function pickBoolean(source: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
    }
    if (typeof value === "number" && value === 1) return true;
  }
  return false;
}

function pickItemRequests(source: Record<string, unknown>): Array<{ label: string; qty: number }> {
  const candidateKeys = ["items", "cart_items", "order_items", "selected_items"];
  for (const key of candidateKeys) {
    const value = source[key];
    if (!Array.isArray(value)) continue;

    const parsed = value
      .map((entry) => {
        if (!isRecord(entry)) return null;
        const name = typeof entry.name === "string" ? entry.name.trim() : "";
        const id = typeof entry.id === "string" ? entry.id.trim() : "";
        const qty =
          typeof entry.qty === "number"
            ? entry.qty
            : typeof entry.quantity === "number"
              ? entry.quantity
              : typeof entry.count === "number"
                ? entry.count
                : 1;
        return {
          label: name || id,
          qty: Math.max(1, Math.floor(qty)),
        };
      })
      .filter((entry): entry is { label: string; qty: number } => Boolean(entry?.label));

    if (parsed.length > 0) return parsed;
  }

  return [];
}

function summarizePrimitiveFields(source: Record<string, unknown>): string {
  const ignored = new Set([
    "flow_token",
    "flow_token_signature",
    "items",
    "cart_items",
    "order_items",
    "selected_items",
  ]);
  const lines = Object.entries(source)
    .filter(([key, value]) => !ignored.has(key) && isPrimitiveValue(value))
    .slice(0, 10)
    .map(([key, value]) => `${key} ${String(value)}`);
  return lines.join("; ");
}

function normalizeOrderType(value: string | null): OrderType | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "delivery") return "delivery";
  if (normalized === "dine-in" || normalized === "dine_in" || normalized === "dinein") {
    return "dine-in";
  }
  return null;
}

function getEnv(key: string): string | undefined {
  const value = process.env[key];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitiveValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
