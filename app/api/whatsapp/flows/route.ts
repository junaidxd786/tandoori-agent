import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  privateDecrypt,
  timingSafeEqual,
  type BinaryLike,
} from "node:crypto";
import { NextRequest } from "next/server";
import { getMenuCatalog } from "@/lib/menu";
import { parseConversationState, type ConversationState } from "@/lib/order-engine";
import { getRestaurantSettings } from "@/lib/settings";
import { supabaseAdmin } from "@/lib/supabase-admin";

type EncryptedFlowEnvelope = {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
};

type FlowDataExchangeRequest = {
  version?: string;
  action?: string;
  screen?: string;
  data?: Record<string, unknown>;
  flow_token?: string;
  flow_token_signature?: string;
};

type DecryptedFlowRequest = {
  decryptedBody: FlowDataExchangeRequest;
  aesKeyBuffer: Buffer;
  initialVectorBuffer: Buffer;
};

type BranchMeta = {
  id: string;
  slug: string;
  name: string;
  address: string;
};

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!isValidFlowSignature(rawBody, signature)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody) as unknown;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (!isEncryptedFlowEnvelope(parsedBody)) {
    return new Response("Bad Request", { status: 400 });
  }

  const privateKey = normalizePrivateKey(
    process.env.WHATSAPP_FLOW_PRIVATE_KEY || process.env.WHATSAPP_PRIVATE_KEY || "",
  );
  if (!privateKey) {
    console.error("[whatsapp-flows] Missing WHATSAPP_FLOW_PRIVATE_KEY.");
    return new Response("Missing Flow private key", { status: 500 });
  }

  let decrypted: DecryptedFlowRequest;
  try {
    decrypted = decryptFlowRequest(parsedBody, privateKey);
  } catch (error) {
    console.error("[whatsapp-flows] Failed to decrypt Flow request:", error);
    return new Response("Unable to decrypt payload", { status: 421 });
  }

  try {
    const responsePayload = await buildFlowResponsePayload(decrypted.decryptedBody);
    const encryptedResponse = encryptFlowResponse(
      responsePayload,
      decrypted.aesKeyBuffer,
      decrypted.initialVectorBuffer,
    );

    return new Response(encryptedResponse, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  } catch (error) {
    console.error("[whatsapp-flows] Failed to process Flow request:", error);
    const fallbackPayload = {
      screen: resolveFallbackScreen(decrypted.decryptedBody),
      data: {
        error_message: "We could not load this step right now. Please try again.",
      },
    };
    const encryptedResponse = encryptFlowResponse(
      fallbackPayload,
      decrypted.aesKeyBuffer,
      decrypted.initialVectorBuffer,
    );

    return new Response(encryptedResponse, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }
}

function decryptFlowRequest(body: EncryptedFlowEnvelope, privatePem: string): DecryptedFlowRequest {
  const decryptedAesKey = privateDecrypt(
    {
      key: createPrivateKey(privatePem),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(body.encrypted_aes_key, "base64"),
  );

  const flowDataBuffer = Buffer.from(body.encrypted_flow_data, "base64");
  const initialVectorBuffer = Buffer.from(body.initial_vector, "base64");
  const tagLength = 16;

  const encryptedBody = flowDataBuffer.subarray(0, -tagLength);
  const authTag = flowDataBuffer.subarray(-tagLength);

  const decipher = createDecipheriv("aes-128-gcm", decryptedAesKey, initialVectorBuffer);
  decipher.setAuthTag(authTag);

  const decryptedJson = Buffer.concat([decipher.update(encryptedBody), decipher.final()]).toString("utf-8");
  const decryptedBody = JSON.parse(decryptedJson) as FlowDataExchangeRequest;

  return {
    decryptedBody,
    aesKeyBuffer: decryptedAesKey,
    initialVectorBuffer,
  };
}

function encryptFlowResponse(
  payload: Record<string, unknown>,
  aesKeyBuffer: Buffer,
  initialVectorBuffer: Buffer,
): string {
  // WhatsApp requires IV bit inversion for response encryption.
  const flippedIv = Buffer.from(initialVectorBuffer.map((byte) => byte ^ 0xff));
  const cipher = createCipheriv("aes-128-gcm", aesKeyBuffer, flippedIv);

  return Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf-8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}

async function buildFlowResponsePayload(request: FlowDataExchangeRequest): Promise<Record<string, unknown>> {
  if (request.action?.toLowerCase() === "ping") {
    return {
      data: {
        status: "active",
      },
    };
  }

  if (isErrorNotificationRequest(request)) {
    return {
      data: {
        acknowledged: true,
      },
    };
  }

  const conversationId =
    pickString(request.data, ["conversation_id"]) || extractConversationIdFromFlowToken(request.flow_token || "");
  const conversation = conversationId ? await getConversation(conversationId) : null;
  const branchId = pickString(request.data, ["branch_id"]) || conversation?.branch_id || null;

  const [branch, state, settings, menuItems] = await Promise.all([
    branchId ? getBranchMeta(branchId) : Promise.resolve(null),
    conversationId ? getConversationState(conversationId) : Promise.resolve(null),
    branchId ? getRestaurantSettings(branchId).catch(() => null) : Promise.resolve(null),
    branchId ? getMenuCatalog(branchId).catch(() => []) : Promise.resolve([]),
  ]);

  const normalizedAction = request.action?.toUpperCase() ?? "";
  if (shouldCompleteFlow(request)) {
    return {
      screen: "SUCCESS",
      data: {
        extension_message_response: {
          params: buildCompletionParams({
            request,
            conversationId,
            branchId,
            state,
            branch,
          }),
        },
      },
    };
  }

  const nextScreen =
    pickString(request.data, ["next_screen", "target_screen"]) ||
    request.screen ||
    (normalizedAction === "INIT"
      ? process.env.WHATSAPP_FLOW_ENTRY_SCREEN || "FIRST_ENTRY_SCREEN"
      : resolveFallbackScreen(request));

  const menuItemsForFlow = menuItems.slice(0, 50).map((item) => ({
    id: item.id,
    name: item.name,
    price: Number(item.price),
    category: item.category,
    is_available: item.is_available,
  }));
  const categories = [...new Set(menuItemsForFlow.map((item) => item.category || "General"))];

  return {
    screen: nextScreen,
    data: {
      ...(request.data ?? {}),
      flow_action: request.action ?? null,
      conversation_id: conversationId,
      branch_id: branchId,
      branch_name: branch?.name ?? null,
      branch_address: branch?.address ?? null,
      branch_slug: branch?.slug ?? null,
      workflow_step: state?.workflow_step ?? null,
      cart_items: state?.cart ?? [],
      order_type: state?.order_type ?? null,
      address: state?.address ?? null,
      guests: state?.guests ?? null,
      reservation_time: state?.reservation_time ?? null,
      menu_items: menuItemsForFlow,
      menu_categories: categories,
      delivery_enabled: settings?.delivery_enabled ?? null,
      delivery_fee: settings ? Number(settings.delivery_fee) : null,
      min_delivery_amount: settings ? Number(settings.min_delivery_amount) : null,
      city: settings?.city ?? null,
      generated_at: new Date().toISOString(),
    },
  };
}

function buildCompletionParams(input: {
  request: FlowDataExchangeRequest;
  conversationId: string | null;
  branchId: string | null;
  state: ConversationState | null;
  branch: BranchMeta | null;
}): Record<string, unknown> {
  const params: Record<string, unknown> = {
    flow_token: input.request.flow_token || "unused",
    conversation_id: input.conversationId,
    branch_id: input.branchId,
    branch_name: input.branch?.name ?? null,
    order_type: input.state?.order_type ?? pickString(input.request.data, ["order_type", "fulfillment_type"]) ?? null,
    address: input.state?.address ?? pickString(input.request.data, ["delivery_address", "address"]) ?? null,
    guests: input.state?.guests ?? pickNumber(input.request.data, ["guests", "guest_count", "party_size"]) ?? null,
    reservation_time:
      input.state?.reservation_time ??
      pickString(input.request.data, ["reservation_time", "dine_in_time", "time_slot"]) ??
      null,
    items: Array.isArray(input.request.data?.items)
      ? input.request.data?.items
      : Array.isArray(input.request.data?.cart_items)
        ? input.request.data?.cart_items
        : input.state?.cart ?? [],
    flow_response_source: "endpoint",
  };

  const summary = [
    params.order_type ? `Type: ${params.order_type}` : null,
    params.address ? `Address: ${params.address}` : null,
    params.guests ? `Guests: ${params.guests}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  if (summary) {
    params.summary = summary;
  }

  return params;
}

function isErrorNotificationRequest(request: FlowDataExchangeRequest): boolean {
  if (!request.data) return false;
  return typeof request.data.error === "string";
}

function shouldCompleteFlow(request: FlowDataExchangeRequest): boolean {
  const data = request.data;
  if (!data) return false;
  if (request.screen?.toUpperCase() === "SUCCESS") return true;
  if (pickBoolean(data, ["complete", "is_complete", "submit_order", "place_order"])) return true;

  const action = pickString(data, ["action", "submit_action", "next_action"]);
  if (action && ["complete", "success", "place_order", "checkout"].includes(action.toLowerCase())) {
    return true;
  }

  const nextScreen = pickString(data, ["next_screen", "target_screen"]);
  return Boolean(nextScreen && nextScreen.toUpperCase() === "SUCCESS");
}

function resolveFallbackScreen(request: FlowDataExchangeRequest): string {
  return (
    request.screen ||
    process.env.WHATSAPP_FLOW_ENTRY_SCREEN ||
    process.env.WHATSAPP_FLOW_SCREEN ||
    "FIRST_ENTRY_SCREEN"
  );
}

async function getConversation(conversationId: string): Promise<{ id: string; branch_id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("id, branch_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    console.error("[whatsapp-flows] Failed to load conversation:", error);
    return null;
  }

  if (!data?.id || !data.branch_id) {
    return null;
  }

  return {
    id: data.id,
    branch_id: data.branch_id,
  };
}

async function getConversationState(conversationId: string): Promise<ConversationState | null> {
  const { data, error } = await supabaseAdmin
    .from("conversation_states")
    .select("*")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.error("[whatsapp-flows] Failed to load conversation state:", error);
    }
    return null;
  }

  return parseConversationState(data as ConversationState);
}

async function getBranchMeta(branchId: string): Promise<BranchMeta | null> {
  const { data, error } = await supabaseAdmin
    .from("branches")
    .select("id, slug, name, address")
    .eq("id", branchId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.error("[whatsapp-flows] Failed to load branch:", error);
    }
    return null;
  }

  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    address: data.address,
  };
}

function extractConversationIdFromFlowToken(flowToken: string): string | null {
  const match = flowToken.match(/(?:^|;)conv=([0-9a-f-]{36})(?:;|$)/i);
  return match?.[1] ?? null;
}

function pickString(source: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function pickNumber(source: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function pickBoolean(source: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    }
  }
  return false;
}

function isEncryptedFlowEnvelope(value: unknown): value is EncryptedFlowEnvelope {
  if (!value || typeof value !== "object") return false;
  const cast = value as Record<string, unknown>;
  return (
    typeof cast.encrypted_flow_data === "string" &&
    typeof cast.encrypted_aes_key === "string" &&
    typeof cast.initial_vector === "string"
  );
}

function isValidFlowSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
  if (!appSecret) {
    return true;
  }

  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody as BinaryLike).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signatureHeader.trim());
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

function normalizePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, "\n").trim();
}
