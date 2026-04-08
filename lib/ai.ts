import OpenAI from "openai";
import { getRestaurantSettings, RestaurantSettings } from "./settings";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "dummy_key_to_prevent_build_crash",
});

const groqClient = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY || "dummy_key_to_prevent_build_crash",
});

// ─────────────────────────────────────────────────────────────────────────────
// In-memory cache — avoids a DB round-trip on every WhatsApp message
// ─────────────────────────────────────────────────────────────────────────────
let _cachedSettings: { data: RestaurantSettings; expires: number } | null = null;
const SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getCachedSettings(): Promise<RestaurantSettings> {
  const now = Date.now();
  if (_cachedSettings && _cachedSettings.expires > now) {
    return _cachedSettings.data;
  }
  const fresh = await getRestaurantSettings();
  _cachedSettings = { data: fresh, expires: now + SETTINGS_CACHE_TTL };
  return fresh;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip raw ### markdown headers from the menu string so the AI never sees
 * them in the formatted output.  We replace them with *Category:* (WhatsApp bold).
 */
const cleanMenuSection = (raw: string): string =>
  raw.replace(/^### (.+)$/gm, "*$1:*");

// ─────────────────────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────────────────────

export const getSystemPrompt = (
  settings: RestaurantSettings,
  hasHistory: boolean,
  isOpenNow: boolean
): string => {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "Restaurant";
  const address = process.env.NEXT_PUBLIC_APP_ADDRESS || "";
  const city = process.env.NEXT_PUBLIC_APP_CITY || "";
  const phoneDelivery = process.env.NEXT_PUBLIC_APP_PHONE_DELIVERY || "";
  const phoneDineIn = process.env.NEXT_PUBLIC_APP_PHONE_DINEIN || "";
  const personality = process.env.NEXT_PUBLIC_AI_PERSONALITY || "Warm & Professional";

  const hasDeliveryFee =
    settings.delivery_enabled && settings.delivery_fee > 0;

  const deliveryFeeDisplay = hasDeliveryFee
    ? `Rs. ${settings.delivery_fee}`
    : "Free 🎉";

  const deliveryFeeRule = hasDeliveryFee
    ? `A delivery fee of Rs. ${settings.delivery_fee} applies to every delivery order. Always add this to the total shown to the customer and pass delivery_fee=${settings.delivery_fee} in place_order.`
    : `Delivery is FREE. Always pass delivery_fee=0 in place_order. Never mention a delivery charge.`;

  const minOrderInfo =
    settings.min_delivery_amount && settings.min_delivery_amount > 0
      ? `Minimum delivery order: Rs. ${settings.min_delivery_amount}. Politely reject delivery orders below this amount and ask the customer to add more items.`
      : "";

  // ── CLOSED GUARD ─────────────────────────────────────────────────────────
  // Placed first in the prompt so the model reads it before anything else.
  const closedGuard = !isOpenNow
    ? `
╔══════════════════════════════════════════════════╗
║  CRITICAL OVERRIDE — RESTAURANT IS CLOSED        ║
╚══════════════════════════════════════════════════╝
Operating hours: ${settings.opening_time} – ${settings.closing_time}
The restaurant is CLOSED right now.

MANDATORY RULES WHILE CLOSED:
• Your FIRST sentence MUST say we are currently closed.
• NEVER say "we are open". NEVER say "yes, we accept orders".
• NEVER call place_order under any circumstances.
• You MAY describe menu items if asked, but immediately remind the
  customer that orders are not accepted until ${settings.opening_time}.
• If the customer insists, politely repeat that we are closed and
  give the phone number: ${phoneDelivery}.
`
    : "";

  return `${closedGuard}
Current Date & Time: ${new Date().toISOString()}

You are the official WhatsApp ordering assistant for *${appName}* — ${city}.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 1 — PRICE GROUNDING  ⚠️ READ FIRST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A LIVE MENU block is injected into this conversation by the system.
That block is the ONLY valid source of item names and prices.

RULES — enforced on every single reply:
1. Before stating any price, find the item in the LIVE MENU block and
   copy its Rs. value exactly. Do not recall, estimate, or calculate.
2. If an item is not in the LIVE MENU block, it does not exist.
   Say "Sorry, that item isn't on our menu."
3. Never invent a price. Never guess. Never round.
4. If the LIVE MENU block is missing or empty, tell the customer the
   menu is temporarily unavailable and ask them to try again shortly
   or call ${phoneDelivery}.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 2 — FORMAT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are on WhatsApp. Follow every rule below on every reply:
• Bold:    *single asterisks* only  (e.g. *Item Name*)
• Bullets: use dash ( - ) for lists
• NEVER use: ## headers, ### headers, **double asterisks**,
  _underscores_, \`backticks\`, or numbered lists with dots (1. 2.)
• Keep replies short and conversational — 3 to 5 lines is ideal.
  Order summaries and full category listings may be longer.
• Never send a wall of unbroken text. One idea per message.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 3 — RESTAURANT INFO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- *Name:*       ${appName} — ${city}
- *Address:*    ${address}
- *Hours:*      ${settings.opening_time} – ${settings.closing_time}
- *Status:*     ${isOpenNow ? "OPEN ✅ — accepting orders" : "CLOSED ❌ — not accepting orders"}
- *Delivery:*   ${phoneDelivery}
- *Dine-in:*    ${phoneDineIn}
- *Delivery fee:* ${deliveryFeeDisplay}${settings.min_delivery_amount && settings.min_delivery_amount > 0 ? `\n- *Min delivery order:* Rs. ${settings.min_delivery_amount}` : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 4 — PERSONALITY & LANGUAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tone: ${personality}

GREETING RULES (read carefully — these are absolute):
${hasHistory
      ? `- This conversation is ALREADY IN PROGRESS. You MUST NOT say "Assalam o Alaikum", "Welcome to", or introduce the restaurant again. Jump directly to answering the customer's current message.
- Exception: If the user themselves says "aoa" or "assalam o alaikum", reply ONLY with "Walaikum Assalam!" and then answer their question.`
      : `- This is the FIRST message. Start your reply with: "Assalam o Alaikum! 👋 Welcome to *${appName}* — ${city}. How can I help you today?"
- If the user's first message is "aoa" or "assalam o alaikum", reply with: "Walaikum Assalam! 👋 Welcome to *${appName}*! How can I help you today?"`
    }

LANGUAGE ALIGNMENT (CRITICAL):
- You MUST mirror the user's language EXACTLY.
- If the user types in English, your entire reply MUST be in pure English.
- If the user types in Roman Urdu (e.g., "mujhe burger chahiye"), your entire reply MUST be in natural Roman Urdu (e.g., "Jee zaroor! Aap ke cart mein add kar diya hai.").
- Do not switch to English if the user is speaking Roman Urdu, and vice versa.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 5 — MENU DISPLAY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "Show menu" / "menu" (generic): list CATEGORY NAMES only, one per
  line. Then ask which category they'd like to see.
- Specific category requested: list all items in that category with
  prices from the LIVE MENU block.
- Item price question: look up the item in LIVE MENU and reply with
  the exact price. Never paraphrase the price.
- Display format for items:
    - *Item Name* — Rs. XXXX
- ALWAYS use the exact item name as it appears in the LIVE MENU block.
  If the customer uses a nickname or misspells, map to the canonical
  menu name (e.g. "zinger" → "Zinger Burger") before ordering.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 6 — ORDER WORKFLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Work through these steps in order. Skip any step the customer has
already addressed upfront (e.g. they gave the address in their first
message — do not ask for it again).

STEP 1 — Build the cart
  - Acknowledge each item: "Got it! Added *[Item]* to your cart."
  - Never use the word "confirmed" for individual item additions.
  - Keep a running subtotal visible to the customer.
  - Look up every price from the LIVE MENU block before quoting it.

STEP 2 — Suggest add-ons
  - Ask once: "Would you like anything else?"
  - If the customer declines, move to Step 3.

STEP 3 — Order type
  - Ask: Delivery or Dine-in?
  - Delivery → ask for the full delivery address.
  - Dine-in  → ask for preferred time and number of guests.
  ${minOrderInfo ? `- DELIVERY MINIMUM: ${minOrderInfo}` : ""}

STEP 4 — Show order summary
  Present the following block before asking for confirmation:

  *Your Order:*
  - [Item] x[qty] — Rs. [price × qty]
  ...
  *Subtotal: Rs. [sum]*${hasDeliveryFee ? `\n  *Delivery Fee: Rs. ${settings.delivery_fee}*\n  *Total: Rs. [subtotal + ${settings.delivery_fee}]*` : `\n  *Delivery: Free 🎉*`}
  *Type:* [Delivery / Dine-in]
  *[Delivery: Address | Dine-in: Time & Guests]*

  End with: "Reply *Yes* to confirm your order."

STEP 5 — Wait for confirmation
  - Call place_order ONLY after the customer explicitly confirms.
  - Accepted confirmations: "Yes", "haan", "ji", "confirm", "done",
    "theek", "thik", "bilkul", "okay", "ok", "sure", or any clear
    affirmative — including phrases like "haan burgers wala".
  - NOT a confirmation: silence, a new question, or changing the order.
  - If the customer says "No" or wants to change something → go back
    to Step 1 and update the cart.
  - CRITICAL: When calling place_order you MUST include a text reply
    in the SAME response. The text MUST be exactly:
    "✅ Your order has been placed! We'll be with you shortly. For queries call ${phoneDelivery}"

STEP 6 — Post-order state
  - The order is in the system. Your job for this order is complete.
  - Do NOT call place_order again. The system blocks duplicates anyway.
  - "Is my order confirmed?" → "✅ Yes, confirmed! For queries call ${phoneDelivery}"
  - "I want to order something else" / new order request → start
    fresh from Step 1.
  - Casual chat after order → respond warmly, do not re-trigger the flow.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 7 — ORDER MODIFICATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "Remove [item]"         → remove it, show updated total.
- "Change [item] to [qty]"→ update quantity, show updated total.
- "Cancel my order" (before confirmation) → reset the cart, confirm
  cancelled: "No problem! Your cart has been cleared. 😊"
- "Cancel" (after place_order was called) → inform the customer the
  order is in the system and they must call ${phoneDelivery} to cancel.
- Always acknowledge the change before moving on.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 8 — EDGE CASES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Item / category not in the LIVE MENU block (e.g. "Do you have beverages?"): Check the LIVE MENU block first. If genuinely absent, say: "Sorry, we don't have [category/item] on our menu right now. Can I help you with something else? 😊"
- Truly off-topic (e.g. jokes, personal questions, directions): "I can only help with our menu and orders 😊 What would you like to eat?"
- Rude customer: remain calm and professional. Do not engage with insults.
- "Same as last time": explain you don't have order history and ask
  them to place a fresh order.
- Item unavailable mid-order: "Sorry, [item] is currently unavailable.
  Can I suggest something else?"
- Unsure about anything: say you don't know — never guess.
- Non-text message (image, audio, etc.): handled upstream; if reached,
  ask the customer to send a text message.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 9 — ABSOLUTE RULES (NEVER BREAK)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✗ NEVER return an empty response — always reply with at least one sentence.
✗ NEVER state a price not found verbatim in the LIVE MENU block.
✗ NEVER invent items, prices, or order IDs.
✗ NEVER call place_order before explicit customer confirmation.
✗ NEVER call place_order more than once per confirmed order.
✗ NEVER accept orders when the restaurant is CLOSED.
✗ NEVER accept a delivery order below the minimum amount (if set).
✗ NEVER use ## or ### headers or **double-asterisk** bold in replies.
✗ ${deliveryFeeRule}
`.trim();
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "place_order",
      description:
        "Submit the final confirmed order to the kitchen system. " +
        "Call this ONLY after the customer has explicitly confirmed the order summary. " +
        "Prices MUST be copied from the LIVE MENU block — do not recall or estimate them. " +
        "The backend validates every price against the database and will reject mismatches.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            description: "Line items in the order.",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Exact item name from the LIVE MENU block." },
                qty: { type: "number", description: "Quantity ordered (positive integer)." },
                price: { type: "number", description: "Unit price in Rs, copied verbatim from the LIVE MENU block." },
              },
              required: ["name", "qty", "price"],
            },
          },
          type: {
            type: "string",
            enum: ["delivery", "dine-in"],
            description: "Order type.",
          },
          subtotal: {
            type: "number",
            description:
              "Sum of (price × qty) for all items. Do NOT include the delivery fee.",
          },
          delivery_fee: {
            type: "number",
            description:
              "Delivery fee in Rs. For delivery orders use the configured fee. For dine-in always pass 0.",
          },
          address: {
            type: "string",
            description: "Full delivery address. Required for delivery orders.",
          },
          guests: {
            type: "number",
            description: "Number of guests. Required for dine-in orders.",
          },
          time: {
            type: "string",
            description:
              "Reservation time as an ISO-8601 string (e.g. 2026-04-07T20:00:00Z), " +
              "calculated from the Current Date & Time shown in the system prompt. " +
              "Required for dine-in orders.",
          },
        },
        required: ["items", "type", "subtotal", "delivery_fee"],
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Process Menu Image
// ─────────────────────────────────────────────────────────────────────────────

export async function processMenuImage(imageUrl: string) {
  const completion = await client.chat.completions.create({
    model: "google/gemini-2.0-flash-001",
    max_tokens: 8000,
    messages: [
      {
        role: "system",
        content: `You are a professional menu digitizer for ${process.env.NEXT_PUBLIC_APP_NAME || "the restaurant"
          }.

Extract EVERY SINGLE item visible in this menu image across all columns and sections.

STRICT RULES:
1. STRIP item numbers from names  (e.g. "1 BBQ Wings" → "BBQ Wings").
2. KEEP portion/size info in the name  (e.g. "Chicken Karahi (Full)").
3. ASSIGN the exact category shown by the section header  (e.g. "BBQ", "Starters", "Sea Food").
4. CLEAN names to Title Case.
5. price MUST be a plain number — no currency symbols, no commas  (e.g. 850 not Rs.850).
6. If a price is illegible or ambiguous, set price to null — do NOT guess.
7. Return compact JSON only — no preamble, no markdown, no extra whitespace.

Return: { "items": [ { "name": "...", "price": 850, "category": "..." }, ... ] }`,
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Parse this full menu and return as JSON:" },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0].message.content ?? "{}";
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("[processMenuImage] JSON parse error. Raw:", raw);
    throw new Error("The AI returned an invalid format. Please try again.");
  }

  // Normalise: accept { items: [...] }, a bare array, or any top-level array value
  let items: any[];
  if (data.items && Array.isArray(data.items)) {
    items = data.items;
  } else if (Array.isArray(data)) {
    items = data;
  } else {
    const arrayVal = Object.values(data).find((v) => Array.isArray(v));
    if (!arrayVal) {
      console.error("[processMenuImage] No array found in response. Raw:", raw);
      throw new Error(
        "The AI returned an unexpected format — no items array found. Please try again."
      );
    }
    items = arrayVal as any[];
  }

  // Flag null-price items — dashboard should surface these for human review
  const nullPriceCount = items.filter((i) => i.price === null || i.price === undefined).length;
  if (nullPriceCount > 0) {
    console.warn(
      `[processMenuImage] ${nullPriceCount} item(s) have null prices — manual review required.`
    );
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Get AI Reply (main entry point)
// ─────────────────────────────────────────────────────────────────────────────

export async function getAIReply(
  history: { role: string; content: string }[],
  currentMenu?: string,
  orderContext?: string | null,
  // Fail-closed default: if caller forgets this arg, orders are blocked.
  isOpenNow: boolean = false,
  hasHistory: boolean = false,
  settings?: RestaurantSettings
): Promise<OpenAI.Chat.Completions.ChatCompletionMessage & { tool_calls?: any[] }> {

  if (!settings) {
    settings = await getCachedSettings();
  }

  // ── Build message array ──────────────────────────────────────────────────
  const messages: any[] = [
    { role: "system", content: getSystemPrompt(settings, hasHistory, isOpenNow) },
  ];

  // ── Menu injection ───────────────────────────────────────────────────────
  // ALWAYS inject the full menu — never a partial subset.
  // Partial injection was the primary cause of hallucinated prices: items from
  // other categories were missing when the user's last message matched only one
  // category, so the model guessed prices from training data.
  if (!currentMenu) {
    // Menu is empty or Supabase errored — warn only if the message is food-related.
    const lastMsg = history[history.length - 1]?.content?.toLowerCase() ?? "";
    const isFoodQuery =
      /menu|order|item|food|list|price|have|want|eat|khana|khaana|chahiye|deliver|show|available|suggest|bata/.test(
        lastMsg
      );

    if (isFoodQuery) {
      messages.push({
        role: "system",
        content:
          "MENU STATUS: The menu is temporarily unavailable. " +
          "Tell the customer politely and ask them to try again in a few minutes " +
          "or call the restaurant directly. Do NOT invent or guess any items or prices.",
      });
    }
  } else {
    // Correct any stale "menu unavailable" message that may be in the history
    const historyHasStaleDenial = history.some(
      (m) =>
        m.role === "assistant" &&
        (m.content.includes("menu is currently being updated") ||
          m.content.includes("no items available") ||
          m.content.includes("menu unavailable") ||
          m.content.includes("temporarily unavailable"))
    );

    if (historyHasStaleDenial) {
      messages.push({
        role: "system",
        content:
          "CORRECTION: A previous reply in this conversation incorrectly stated the menu " +
          "was unavailable. The menu IS NOW FULLY AVAILABLE. Ignore those old replies. " +
          "Use the LIVE MENU DATA below to answer accurately.",
      });
    }

    // Extract category names for the header list (cosmetic — used in the intro line)
    const categories =
      currentMenu
        .match(/^### ([\w &/\-]+)/gm)
        ?.map((c) => c.replace(/^### /, "").trim()) ?? [];

    const cleanedMenu = cleanMenuSection(currentMenu);

    messages.push({
      role: "system",
      content: `
╔══════════════════════════════════════════════════╗
║  LIVE MENU DATA  —  PRICE AUTHORITY              ║
║  Copy prices exactly. Never guess or recall.     ║
╚══════════════════════════════════════════════════╝
Available categories: ${categories.map((c) => `*${c}*`).join(", ")}

${cleanedMenu}

RULE: Every Rs. amount you tell the customer MUST appear verbatim in the list above.
If an item is not listed above, it does not exist on our menu.
`.trim(),
    });
  }

  // ── Recent order context ─────────────────────────────────────────────────
  // Primary defence against duplicate place_order calls.
  if (orderContext) {
    messages.push({ role: "system", content: orderContext });
  }

  messages.push({
    role: "system",
    content: "─── CONVERSATION HISTORY ───",
  });

  // Keep last 50 messages so a long cart session doesn't lose early items.
  messages.push(...history.slice(-50));

  // ── Idempotency guard ────────────────────────────────────────────────────
  // Even if orderContext is absent, scan the history for a confirmation message.
  // If found, disable tools unless the customer explicitly starts a NEW order.
  let isOrderAlreadyPlaced = false;
  let lastOrderIndex = -1;

  for (let i = history.length - 1; i >= 0; i--) {
    if (
      history[i].role === "assistant" &&
      (history[i].content.includes("order has been placed") ||
        history[i].content.includes("order is confirmed") ||
        history[i].content.includes("✅ Your order"))
    ) {
      lastOrderIndex = i;
      break;
    }
  }

  if (lastOrderIndex !== -1) {
    isOrderAlreadyPlaced = true;
    // Re-enable tools only if customer explicitly asks for a new order
    for (let i = lastOrderIndex + 1; i < history.length; i++) {
      if (history[i].role === "user") {
        const t = history[i].content.toLowerCase();
        if (
          t.includes("order again") ||
          t.includes("order something else") ||
          t.includes("new order") ||
          t.includes("another order") ||
          t.includes("add another") ||
          t.includes("place a new order")
        ) {
          isOrderAlreadyPlaced = false;
          break;
        }
      }
    }
  }

  const allowTools = !orderContext && !isOrderAlreadyPlaced;

  // ── Model config ─────────────────────────────────────────────────────────
  const primaryModel = process.env.AI_MODEL || "llama-3.3-70b-versatile";
  const fallbackModel = process.env.AI_FALLBACK_MODEL || "google/gemini-2.0-flash-001:free";
  const maxTokens = parseInt(process.env.AI_MAX_TOKENS || "3500", 10);

  // ── Primary model call ───────────────────────────────────────────────────
  try {
    const completion = await groqClient.chat.completions.create({
      model: primaryModel,
      max_tokens: maxTokens,
      messages,
      ...(allowTools ? { tools, tool_choice: "auto" } : {}),
    });

    const response = completion.choices[0].message;

    // Safety: if the model returns neither content nor tool calls, inject a fallback.
    if (!response.content && !response.tool_calls) {
      response.content =
        "I'm sorry, I encountered a brief glitch. How can I help you with your order?";
    }

    return response;
  } catch (primaryError) {
    console.error(`[AI] Primary model (${primaryModel}) failed:`, primaryError);

    // ── Fallback model call ────────────────────────────────────────────────
    try {
      console.log(`[AI] Attempting fallback with ${fallbackModel}…`);

      if (fallbackModel.includes("claude")) {
        // Use native Anthropic SDK for Claude models (better tool support)
        const Anthropic = require("@anthropic-ai/sdk").default;
        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY,
        });

        const systemContent = messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n");

        const anthropicMessages = messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        const result = await anthropic.messages.create({
          model: fallbackModel.replace("anthropic/", ""),
          max_tokens: maxTokens,
          system: systemContent,
          messages: anthropicMessages,
        });

        return {
          role: "assistant",
          content:
            result.content[0]?.type === "text" ? result.content[0].text : "",
        } as any;
      }

      // Non-Claude fallback via OpenRouter
      const fallback = await client.chat.completions.create({
        model: fallbackModel,
        max_tokens: maxTokens,
        messages,
        ...(allowTools ? { tools, tool_choice: "auto" } : {}),
      });

      return fallback.choices[0].message;
    } catch (fallbackError) {
      console.error("[AI] Fallback also failed:", fallbackError);
      throw primaryError; // Re-throw original error for upstream handling
    }
  }
}