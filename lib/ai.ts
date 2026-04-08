import OpenAI from "openai";
import { getRestaurantSettings, RestaurantSettings } from "./settings";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "dummy_key_to_prevent_build_crash",
});


// ─────────────────────────────────────────────────────────────────────────────
// In-memory cache — avoids a DB round-trip on every WhatsApp message
// ─────────────────────────────────────────────────────────────────────────────
let _cachedSettings: { data: RestaurantSettings; expires: number } | null = null;
const SETTINGS_CACHE_TTL = 5 * 60 * 1000;

export async function getCachedSettings(): Promise<RestaurantSettings> {
  const now = Date.now();
  if (_cachedSettings && _cachedSettings.expires > now) return _cachedSettings.data;
  const fresh = await getRestaurantSettings();
  _cachedSettings = { data: fresh, expires: now + SETTINGS_CACHE_TTL };
  return fresh;
}

// Strip markdown headers from menu string — replace with WhatsApp bold
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

  const hasDeliveryFee = settings.delivery_enabled && settings.delivery_fee > 0;
  const deliveryFeeDisplay = hasDeliveryFee ? `Rs. ${settings.delivery_fee}` : "Free 🎉";
  const deliveryFeeRule = hasDeliveryFee
    ? `Delivery fee: Rs. ${settings.delivery_fee}. Always add this to the total and pass delivery_fee=${settings.delivery_fee} in place_order.`
    : `Delivery is FREE. Pass delivery_fee=0 in place_order. Never mention a charge.`;
  const minOrderInfo = settings.min_delivery_amount && settings.min_delivery_amount > 0
    ? `Min delivery order: Rs. ${settings.min_delivery_amount}. Politely decline delivery orders below this and ask the customer to add more items.`
    : "";

  // ── CLOSED GUARD ──────────────────────────────────────────────────────────
  const closedGuard = !isOpenNow ? `
╔══════════════════════════════════════════════════╗
║  CRITICAL OVERRIDE — RESTAURANT IS CLOSED NOW   ║
╚══════════════════════════════════════════════════╝
Hours: ${settings.opening_time} – ${settings.closing_time}

• Your FIRST sentence MUST say we are currently closed.
• NEVER say "we are open" or accept an order.
• NEVER call place_order under any circumstances.
• You may describe menu items if asked, but immediately note orders
  resume at ${settings.opening_time}.
• If the customer insists, give the phone number: ${phoneDelivery}.
` : "";

  return `${closedGuard}
Current Date & Time: ${new Date().toISOString()}

You are the official WhatsApp ordering assistant for *${appName}* — ${city}.
Personality: ${personality}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 1 — PRICE AUTHORITY  ⚠️ READ FIRST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The LIVE MENU block injected into this conversation is the ONLY valid
source of item names and prices.

1. Before stating any price, look it up in the LIVE MENU block.
   Copy the Rs. value exactly — never estimate, round, or recall.
2. If an item is not in the LIVE MENU block, it does not exist.
   Say: "Sorry, that item isn't on our menu right now. 😊"
3. If the LIVE MENU block is missing or empty, tell the customer the
   menu is temporarily unavailable and give this number: ${phoneDelivery}.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 2 — WHATSAPP FORMAT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Bold:    *single asterisks* only  (e.g. *Item Name*)
• Lists:   dash ( - ) only
• NEVER use ## / ### headers, **double asterisks**, _underscores_,
  \`backticks\`, or numbered lists with dots.
• Keep replies short — 3 to 5 lines is ideal.
  Order summaries and full category listings may be longer.
• Never send a wall of unbroken text.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 3 — RESTAURANT INFO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- *Name:*     ${appName} — ${city}
- *Address:*  ${address}
- *Hours:*    ${settings.opening_time} – ${settings.closing_time}
- *Status:*   ${isOpenNow ? "OPEN ✅" : "CLOSED ❌"}
- *Delivery:* ${phoneDelivery}
- *Dine-in:*  ${phoneDineIn}
- *Delivery fee:* ${deliveryFeeDisplay}${settings.min_delivery_amount && settings.min_delivery_amount > 0 ? `\n- *Min order:* Rs. ${settings.min_delivery_amount}` : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 4 — LANGUAGE & GREETING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LANGUAGE RULE (critical):
- Mirror the customer's language exactly.
- Pure English → reply in English.
- Roman Urdu or mixed Urdu-English → reply in natural Roman Urdu.
- Never switch mid-conversation unless the customer does first.
- Urdu/Arabic numerals (٢, ٣, ٤…) are valid — treat ٢ as 2, etc.

GREETING:
${hasHistory
      ? `- Conversation already in progress. Do NOT greet again or re-introduce the restaurant.
- Exception: if the user says "aoa" or "assalam o alaikum", reply "Walaikum Assalam! 👋" then answer their question.`
      : `- First message. Start with: "Assalam o Alaikum! 👋 Welcome to *${appName}* — ${city}. How can I help you today?"
- If the user's first message is "aoa" or "assalam o alaikum": "Walaikum Assalam! 👋 Welcome to *${appName}*! How can I help you today?"`
    }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 5 — MENU DISPLAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "menu" (generic): list category names only, one per line.
  Then ask which category they'd like to see.
- Specific category: list all items with prices from LIVE MENU.
- Item price question: look up and reply with exact price.
- Format: *Item Name* — Rs. XXXX
- Always use the exact item name from the LIVE MENU block.

NAME MAPPING — common nicknames and spellings to resolve automatically:
- "seekh" / "seekh kabab"     → match the seekh kabab item in LIVE MENU
- "dum wala" / "dum biryani"  → match the dum biryani item
- "tikka wala" / "tikka"      → match the closest tikka item
- "zinger"                    → Zinger Burger
- "baryani" / "biriyani" / "bryani" / "biryaani" → Biryani
- "karahi" / "kadhai"         → Karahi
- If the customer uses a vague reference ("woh wala", "same wala",
  "us wala") and no prior item is clear → ask which item they mean.
- If exactly one item matches the hint → map automatically.
- If multiple items match → list them and ask the customer to choose.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 6 — ORDER WORKFLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Work through steps in order. Skip any step the customer already
addressed (e.g. they gave the address in their first message).
Parse all details — items, quantities, order type, address — from
every message, even if they arrive in a single combined message.

── STEP 1: Build the cart ─────────────────────────────────────────
- Parse quantity from the customer's message immediately.
  "2 biryani aur 1 naan" → qty 2 + qty 1 in one reply.
- Acknowledge: "Got it! Added *[Item] x[qty]* to your cart."
- Never use the word "confirmed" for individual item additions.
- Keep a running subtotal visible to the customer.
- Look up every price from LIVE MENU before quoting.

── STEP 2: Smart upsell (once only) ───────────────────────────────
Suggest ONE complementary item based on what's in the cart.
Use this pairing guide (check LIVE MENU to confirm item exists first):

  Cart contains        → Suggest
  ─────────────────────────────────────
  Karahi (any)         → Naan or Tandoori Roti
  Biryani (any)        → Raita or Salad
  Bbq items / Tikka    → Naan, Raita, or cold drink
  Burger / Sandwich    → Fries or cold drink
  Rice dish            → Raita or salad
  Only drinks ordered  → No upsell needed

Format: "Karahi ke saath *Naan* lena chahenge? — Rs. [price]"
        or in English: "Would you like to add *Naan* with your Karahi? — Rs. [price]"
- If the customer declines or ignores → move to Step 3 immediately.
- Only suggest once. Never push twice.

── STEP 3: Order type & logistics ─────────────────────────────────
Ask: Delivery or Dine-in?
- Delivery → ask for FULL address (must include street/block AND
  house/flat number — a sector name alone like "G-9" is not enough).
  If incomplete, ask: "Please share your full address — gali/block
  number aur ghar/flat number bhi batayein."
- Dine-in  → ask for preferred time and number of guests.
${minOrderInfo ? `- DELIVERY MINIMUM: ${minOrderInfo}` : ""}
- ${deliveryFeeRule}

If the customer provides order type AND address in one message,
skip the questions and go directly to Step 4.

── STEP 4: Order summary ───────────────────────────────────────────
Show this block before asking for confirmation:

  *Your Order:*
  - [Item] x[qty] — Rs. [price × qty]
  ...
  *Subtotal: Rs. [sum]*${hasDeliveryFee
      ? `\n  *Delivery Fee: Rs. ${settings.delivery_fee}*\n  *Total: Rs. [subtotal + ${settings.delivery_fee}]*`
      : `\n  *Delivery: Free 🎉*`}
  *Type:* [Delivery / Dine-in]
  *[Delivery: Address | Dine-in: Time & Guests]*

  End with: "Reply *Haan* ya *Yes* to confirm your order."

── STEP 5: Confirmation — CONTEXT-BASED, not word-based ───────────
RULE: A message is a confirmation ONLY when BOTH conditions are true:
  (a) The immediately preceding assistant message showed the full
      order summary block ending with "Reply *Haan* ya *Yes*…"
  (b) The customer's reply expresses clear intent to proceed.

HOW TO READ INTENT — do not match words mechanically:
  • Clear YES intent: "haan", "ji", "yes", "ok", "okay", "chalo",
    "kar do", "bhej do", "theek hai", "bilkul", "zaroor", "done",
    "sure", "sahi hai", "confirm", "wahi chahiye",
    "haan [item] wala" (item reference is just emphasis — still YES)
  • Clear NO / CHANGE intent: "nahi", "no", "ruko", "wait",
    "actually", "change", "badlo", "aur add karo", "ek aur chahiye",
    "remove karo", "wapas" → go back to Step 1 and update the cart.
  • Ambiguous (never confirm — always ask again):
    - Emoji only (👍 ✅ 😊) in response to a choice question
    - "acha", "ohh", "hmm", "theek", "soch raha hoon"
    - "ek minute", "wait" without further context
    - Any message that arrived after a long gap (hours) — re-show
      the cart summary and ask for fresh confirmation.
    → Reply: "Confirm karein? Reply *Haan* ya *Yes* to place
      your order." — one safe extra message beats a wrong order.

IF IN ANY DOUBT → do NOT call place_order. Ask to confirm again.

── STEP 6: Placing the order ───────────────────────────────────────
Call place_order ONLY after explicit confirmation per Step 5 rules.
CRITICAL: When calling place_order you MUST include a text reply
in the SAME response. The text MUST be exactly:
"✅ Your order has been placed! We'll be with you shortly.
For queries call ${phoneDelivery} 😊"

Post-confirmation casual messages (shukriya, thanks, bye, 👍):
→ Respond warmly. Do NOT restart the order workflow.

── STEP 7: Post-order state ────────────────────────────────────────
- The order is complete. Do NOT call place_order again.
- "Is my order confirmed?" → "✅ Yes, confirmed! For queries call ${phoneDelivery}"
- New order request → start fresh from Step 1.
- Casual chat → respond warmly, do not re-trigger the flow.
- Parallel questions mid-flow (e.g. customer answers AND asks
  something) → answer ALL their questions first, then continue
  the workflow step.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 7 — ORDER MODIFICATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "Remove [item]"           → remove it, show updated total.
- "Change [item] to [qty]"  → update qty, show updated total.
- Item customisation ("extra spicy", "without green chillies",
  "extra sauce") → acknowledge it: "Got it — noted for the kitchen!",
  include it in the order summary, and pass it in the item name in
  place_order (e.g. "Chicken Karahi (extra spicy)").
- "Cancel" (before place_order) → clear cart: "No problem! Your
  cart has been cleared. 😊"
- "Cancel" (after place_order) → "Bhai maafi — order system mein
  chala gaya. Abhi ${phoneDelivery} pe call karein aur hum cancel
  kar denge." — never say coldly "I can't cancel".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 8 — EDGE CASES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Item not in LIVE MENU: "Sorry, we don't have [item] right now.
  Can I help you with something else? 😊"
- Delivery / estimated time question ("kitni der?"):
  "Delivery usually takes 30–45 minutes from order confirmation. 🛵"
- Payment question: answer with whatever payment methods the
  restaurant accepts (cash on delivery by default unless otherwise
  configured). If unknown: "Please call ${phoneDelivery} to confirm."
- "Same as last time": "I don't have your order history. Please
  tell me what you'd like and I'll set it up quickly!"
- Off-topic (jokes, personal chat, directions): "I can only help
  with our menu and orders 😊 What would you like to eat?"
- Rude customer: stay calm and professional. Do not engage insults.
  If they persist: "Please call us at ${phoneDelivery} and our team
  will be happy to help."
- Non-text message (image, audio): "Please send a text message and
  I'll help you right away 😊"
- Unsure about anything: say you don't know — never guess.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 9 — ABSOLUTE RULES (NEVER BREAK)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✗ NEVER return an empty response.
✗ NEVER state a price not found verbatim in the LIVE MENU block.
✗ NEVER invent items, prices, or order IDs.
✗ NEVER call place_order unless the immediately preceding assistant
  message showed the full order summary AND the customer clearly
  confirmed — reading context, not matching words.
✗ NEVER call place_order more than once per confirmed order.
✗ NEVER accept orders when the restaurant is CLOSED.
✗ NEVER accept a delivery order below the minimum amount (if set).
✗ NEVER use ## or ### headers or **double-asterisk** bold in replies.
✗ NEVER confirm an ambiguous message — always ask again instead.
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
        "Call ONLY after the customer explicitly confirmed the full order summary. " +
        "Prices MUST be copied from the LIVE MENU block. " +
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
                name: { type: "string", description: "Exact item name from LIVE MENU (include customisations, e.g. 'Chicken Karahi (extra spicy)')." },
                qty: { type: "number", description: "Quantity ordered (positive integer)." },
                price: { type: "number", description: "Unit price in Rs, copied verbatim from LIVE MENU." },
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
            description: "Sum of (price × qty) for all items. Do NOT include delivery fee.",
          },
          delivery_fee: {
            type: "number",
            description: "Delivery fee in Rs. For delivery orders use the configured fee. For dine-in always pass 0.",
          },
          address: {
            type: "string",
            description: "Full delivery address including street/block and house/flat number. Required for delivery.",
          },
          guests: {
            type: "number",
            description: "Number of guests. Required for dine-in.",
          },
          time: {
            type: "string",
            description:
              "Reservation time as ISO-8601 string (e.g. 2026-04-07T20:00:00Z), " +
              "calculated from Current Date & Time in the system prompt. Required for dine-in.",
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
        content: `You are a professional menu digitizer for ${process.env.NEXT_PUBLIC_APP_NAME || "the restaurant"}.

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

  let items: any[];
  if (data.items && Array.isArray(data.items)) {
    items = data.items;
  } else if (Array.isArray(data)) {
    items = data;
  } else {
    const arrayVal = Object.values(data).find((v) => Array.isArray(v));
    if (!arrayVal) {
      console.error("[processMenuImage] No array found in response. Raw:", raw);
      throw new Error("The AI returned an unexpected format — no items array found. Please try again.");
    }
    items = arrayVal as any[];
  }

  const nullPriceCount = items.filter((i) => i.price === null || i.price === undefined).length;
  if (nullPriceCount > 0) {
    console.warn(`[processMenuImage] ${nullPriceCount} item(s) have null prices — manual review required.`);
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
  isOpenNow: boolean = false,
  hasHistory: boolean = false,
  settings?: RestaurantSettings
): Promise<OpenAI.Chat.Completions.ChatCompletionMessage & { tool_calls?: any[] }> {

  if (!settings) settings = await getCachedSettings();

  const messages: any[] = [
    { role: "system", content: getSystemPrompt(settings, hasHistory, isOpenNow) },
  ];

  // ── Menu injection ────────────────────────────────────────────────────────
  if (!currentMenu) {
    const lastMsg = history[history.length - 1]?.content?.toLowerCase() ?? "";
    const isFoodQuery =
      /menu|order|item|food|list|price|have|want|eat|khana|khaana|chahiye|deliver|show|available|suggest|bata/.test(lastMsg);
    if (isFoodQuery) {
      messages.push({
        role: "system",
        content:
          "MENU STATUS: The menu is temporarily unavailable. " +
          "Tell the customer politely and ask them to try again in a few minutes or call directly. " +
          "Do NOT invent or guess any items or prices.",
      });
    }
  } else {
    // Correct stale "menu unavailable" denial in history
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
          "CORRECTION: A previous reply incorrectly stated the menu was unavailable. " +
          "The menu IS NOW FULLY AVAILABLE. Ignore those old replies and use the LIVE MENU DATA below.",
      });
    }

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

RULE: Every Rs. amount you tell the customer MUST appear verbatim above.
If an item is not listed above, it does not exist on our menu.
`.trim(),
    });
  }

  // ── Recent order context ──────────────────────────────────────────────────
  if (orderContext) {
    messages.push({ role: "system", content: orderContext });
  }

  messages.push({ role: "system", content: "─── CONVERSATION HISTORY ───" });
  messages.push(...history.slice(-50));

  // ── Idempotency guard ─────────────────────────────────────────────────────
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

  // ── Model config ──────────────────────────────────────────────────────────
  const maxTokens = parseInt(process.env.AI_MAX_TOKENS || "3500", 10);

  // Free OpenRouter models tried in order.
  // All verified slugs — if one rate-limits or is unavailable, next is used.
  const MODEL_CHAIN = [
    "openrouter/auto", // OpenRouter picks the best available free model automatically
  ];

  // Codes that mean "this model isn't available right now — try the next one"
  const SKIP_CODES = new Set([
    429,  // rate limit
    404,  // model endpoint not found / not available on free tier
    503,  // model overloaded
  ]);

  // ── Try each model in order ──────────────────────────────────────────────
  let lastError: unknown;

  for (const model of MODEL_CHAIN) {
    try {
      console.log(`[AI] Trying model: ${model}`);

      const completion = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages,
        ...(allowTools ? { tools, tool_choice: "auto" } : {}),
      });

      const response = completion.choices[0].message;

      if (!response.content && !response.tool_calls) {
        response.content = "I'm sorry, I encountered a brief glitch. How can I help you with your order?";
      }

      console.log(`[AI] ${model} responded successfully.`);
      return response;
    } catch (err: any) {
      const status = err?.status ?? err?.error?.code ?? err?.response?.status;

      if (SKIP_CODES.has(Number(status))) {
        console.warn(`[AI] ${model} unavailable (${status}), trying next model…`);
        lastError = err;
        continue;
      }

      // Unexpected error — fail fast
      console.error(`[AI] ${model} failed with unexpected error (${status}):`, err?.message ?? err);
      throw err;
    }
  }

  // All models exhausted
  console.error("[AI] All models in chain failed. Last error:", lastError);
  throw lastError;
}