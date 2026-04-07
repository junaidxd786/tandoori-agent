import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

import { getRestaurantSettings, isWithinOperatingHours, RestaurantSettings } from "./settings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip markdown headers from menu strings so the AI never sees ### syntax */
const cleanMenuSection = (raw: string): string =>
  raw.replace(/^### (.+)$/gm, "*$1:*");

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

export const getSystemPrompt = (
  settings: RestaurantSettings,
  hasHistory: boolean,
  isOpenNow: boolean
): string => {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || "Restaurant";
  const address = process.env.NEXT_PUBLIC_APP_ADDRESS || "";
  const city = process.env.NEXT_PUBLIC_APP_CITY || "";
  const deliveryPhone = process.env.NEXT_PUBLIC_APP_PHONE_DELIVERY || "";
  const dineinPhone = process.env.NEXT_PUBLIC_APP_PHONE_DINEIN || "";
  const personality = process.env.NEXT_PUBLIC_AI_PERSONALITY || "Warm & Professional";

  const minAmountInfo = settings.min_delivery_amount && settings.min_delivery_amount > 0
    ? `- *Min Delivery Order:* Rs. ${settings.min_delivery_amount}`
    : ``;

  // delivery_enabled = true  → a delivery fee is charged
  // delivery_enabled = false → delivery is FREE (no fee)
  const deliveryFeeInfo = settings.delivery_enabled && settings.delivery_fee > 0
    ? `- *Delivery Fee:* Rs. ${settings.delivery_fee} (charged on delivery orders)`
    : `- *Delivery Fee:* Free 🎉`;

  // Hard closed guard — placed at the very top of the prompt so the AI
  // reads this BEFORE any other instruction and cannot contradict it.
  const closedGuard = !isOpenNow
    ? `
=== CRITICAL OVERRIDE — READ FIRST ===
The restaurant is CLOSED right now. Operating hours: ${settings.opening_time} – ${settings.closing_time}.
YOUR FIRST SENTENCE must inform the user we are currently CLOSED.
- NEVER say "we are open". NEVER say "Yes we are open".
- NEVER call place_order. All order placement is BLOCKED.
- If asked about menu items, you may answer the question BUT immediately remind them we are closed and orders are not accepted right now.
- Tell the user we will open at ${settings.opening_time}.
=== END CRITICAL OVERRIDE ===
`
    : ``;

  return `${closedGuard}
Current Date and Time: ${new Date().toISOString()}

You are the official WhatsApp ordering assistant for Tandoori Restaurant — ${city}.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT RULES — STRICTLY ENFORCED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are on WhatsApp. Follow these rules on every single reply:
- ONLY allowed bold: *single asterisks* (e.g. *Item Name*)
- NEVER use: ## or ### headers, **double asterisks**, _underscores\`, \`backticks\`, or numbered lists with dots (1. 2. 3.)
- Use dash bullet points ( - ) for lists
- Keep every reply under 5 lines. If more is needed, split into multiple short messages (EXCEPTION: Your order summary can exceed 5 lines)
- NEVER output a wall of text. Short, conversational, mobile-friendly

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESTAURANT INFO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- *Name:* ${appName} — ${city}
- *Address:* ${address}
- *Hours:* ${settings.opening_time} – ${settings.closing_time}
- *Status:* ${isOpenNow ? "OPEN ✅ — accepting orders" : "CLOSED ❌ — NOT accepting orders"}
- *Delivery phone:* ${deliveryPhone}
- *Dine-in phone:* ${dineinPhone}
${minAmountInfo}
${deliveryFeeInfo}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERSONALITY & GREETING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tone: ${personality}
${hasHistory
      ? "The conversation is already ongoing. Do NOT re-greet. Answer the current message directly."
      : `First message only: Start with "Assalam o Alaikum! 👋 Welcome to *${appName}* — ${city}. How can I help you today?"`
    }

LANGUAGE: Detect whether the user writes in English or Roman Urdu and mirror their language exactly throughout the entire conversation.
- If the user greets with "Aoa", "aoa", or "Assalam o alaikum", ALWAYS reply with "Walaikum Assalam!"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MENU RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- If asked for the "menu" generically: list CATEGORY NAMES only (one per line). Ask which category they want to see.
- If a specific category or item is requested: show those items and prices.
- Format each item as:  - *Item Name* — Rs. XXXX
- ALWAYS use the EXACT spelling and name of the item as it appears in the menu context. If the user misspells an item or uses a nickname, map it to the exact canonical menu name before placing the order.
- If an item is not on the menu, say so politely. NEVER invent items or prices.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ORDER WORKFLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Follow these steps in order. Skip steps if the user has already provided the information upfront (e.g. if they already gave their order type or address, do not ask for it again).

1. *Build the order*
   - Acknowledge each item addition gracefully (e.g., 'Got it, added to your cart.'). Do not use the word 'confirmed' for individual items.
   - Keep a running total visible to the user
   - If the user provides items, quantity, type, and address in a single message, beautifully acknowledge it and jump to Step 4.

2. *Suggest add-ons*
   - Ask: "Would you like anything else?"

3. *Ask order type*
   - Delivery → ask for full delivery address
   - Dine-in  → ask for preferred time and number of guests

4. *Show order summary* in this exact format before confirming:

*Your Order:*
- [Item] x[qty] — Rs. [price]
*Subtotal: Rs. [subtotal]*${settings.delivery_enabled && settings.delivery_fee > 0 ? `
*Delivery Fee: Rs. ${settings.delivery_fee}*
*Total: Rs. [subtotal + fee]*` : `
*Delivery: Free 🎉*`}
*Type:* [Delivery / Dine-in]
*[Address OR Time & Guests]*

Reply *Yes* to confirm your order.

5. *Wait for confirmation*
   - Only call place_order AFTER the user replies "Yes" (or Roman Urdu equivalent like "haan", "ji", "confirm", "done", "theek", "thik", "bilkul", "haan burgers wala" or any affirmative phrase)
   - If they say "No" or want to change something, go back to step 1
   - CRITICAL: When you call the place_order tool, you MUST ALSO include a text reply in the SAME response. Never call the tool without text.
   - The confirmation text MUST be: "✅ Your order has been placed! We'll be with you shortly. For queries call ${deliveryPhone}"

6. *Post-order state (after order is placed)*
   - The order is now in our system. Your job is DONE for this order.
   - Do NOT call place_order again. The system will BLOCK duplicate orders anyway.
   - If the user asks "is it confirmed?", "what happened?", or similar → reassure them: "✅ Yes, your order is confirmed! For any queries call ${deliveryPhone}"
   - If the user says "I want to order something else" or clearly starts a NEW order → you may start a fresh order flow from step 1.
   - If user just chats casually after order → respond warmly but do NOT re-trigger the order flow.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ORDER MODIFICATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "Remove [item]" → remove it from the cart, show updated total
- "Change [item] to [qty]" → update the quantity, show updated total
- Always acknowledge the change before moving on

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OFF-TOPIC & EDGE CASES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- If the user asks something unrelated to food, orders, or the restaurant: politely redirect.
  Example: "I can only help with menu and order questions 😊 What would you like to eat?"
- If the user is rude: remain calm and professional. Do not engage with insults.
- If unsure about something: say you don't know rather than guessing.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ABSOLUTE RULES — NEVER BREAK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- NEVER return an empty response. You MUST ALWAYS reply with at least one sentence.
- NEVER invent prices, items, or order IDs
- NEVER call place_order before explicit user confirmation
- NEVER call place_order more than once per confirmed order
- NEVER accept orders when the restaurant is CLOSED
- NEVER accept delivery orders below the Minimum Delivery Amount
- NEVER use markdown headers or double-asterisk bold
- DELIVERY FEE RULE: ${settings.delivery_enabled && settings.delivery_fee > 0 ? `A delivery fee of Rs. ${settings.delivery_fee} applies. ALWAYS pass delivery_fee=${settings.delivery_fee} in place_order for delivery orders.` : 'Delivery is FREE. ALWAYS pass delivery_fee=0 in place_order for delivery orders.'}
`.trim();
};

// ---------------------------------------------------------------------------
// AI Tool Definitions
// ---------------------------------------------------------------------------

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "place_order",
      description: "Submit the final confirmed order to the system. Only call this after the user has explicitly confirmed their order summary.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                qty: { type: "number" },
                price: { type: "number" },
              },
              required: ["name", "qty", "price"],
            },
          },
          type: { type: "string", enum: ["delivery", "dine-in"] },
          subtotal: { type: "number", description: "Sum of all items (price × qty). Do NOT include delivery fee here." },
          delivery_fee: { type: "number", description: "Delivery fee in rupees. For delivery orders set this to the configured delivery fee. For dine-in always set to 0." },
          address: { type: "string", description: "Required for delivery orders" },
          guests: { type: "number", description: "Required for dine-in orders" },
          time: { type: "string", description: "Required for dine-in orders. Must be an ISO-8601 string (e.g. 2026-04-07T20:00:00Z) calculated from the Current Date and Time." },
        },
        required: ["items", "type", "subtotal", "delivery_fee"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Process Menu Image
// ---------------------------------------------------------------------------

export async function processMenuImage(imageUrl: string) {
  const completion = await client.chat.completions.create({
    model: "google/gemini-2.0-flash-001",
    max_tokens: 8000,
    messages: [
      {
        role: "system",
        content: `You are a professional menu digitizer for ${process.env.NEXT_PUBLIC_APP_NAME || "the restaurant"}.
Extract EVERY SINGLE item from this menu image across all columns.

RULES:
1. STRIP item numbers from the names (e.g. "1 BBQ WINGS" becomes "BBQ Wings").
2. KEEP portion/quantity info in the name (e.g. "Chicken Karahi (Full)").
3. ASSIGN the correct category for every item based on the headers (e.g. "STARTERS", "BBQ", "SEA FOOD").
4. CLEAN names to Title Case.
5. FORMAT COMPACTLY to save tokens. Do not add any extra whitespace to the JSON response.

Return a JSON object with an "items" key containing the array: { name, price, category }.`,
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

  const content = completion.choices[0].message.content ?? "{}";
  let data: any;
  try {
    data = JSON.parse(content);
  } catch (error) {
    console.error("AI JSON Parse Error. Raw content:", content);
    throw new Error("The AI provided an invalid menu format. Please try again.");
  }
  
  if (data.items && Array.isArray(data.items)) return data.items;
  if (Array.isArray(data)) return data;
  const arrayValue = Object.values(data).find((v) => Array.isArray(v));
  // Issue #9: if the AI returns valid JSON but no array anywhere, surface an error
  // instead of silently returning [] which makes the menu appear empty with no warning.
  if (!arrayValue) {
    console.error("processMenuImage: AI returned valid JSON but no array field found. Raw:", content);
    throw new Error("The AI returned an unexpected format — no menu items array found. Please try again.");
  }
  return arrayValue as any[];
}

// ---------------------------------------------------------------------------
// Get AI Reply with Tool Calling
// ---------------------------------------------------------------------------

export async function getAIReply(
  history: { role: string; content: string }[],
  currentMenu?: string,
  orderContext?: string | null,
  // Issue #3: default MUST be false — fail closed so orders aren't accidentally
  // accepted 24/7 if a caller forgets to pass this argument.
  isOpenNow: boolean = false,
  hasHistory: boolean = false,
  settings?: RestaurantSettings // Passed from webhook to avoid duplicate DB calls
): Promise<OpenAI.Chat.Completions.ChatCompletionMessage & { tool_calls?: any[] }> {

  if (!settings) {
    settings = await getRestaurantSettings();
  }

  const messages: any[] = [
    { role: "system", content: getSystemPrompt(settings, hasHistory, isOpenNow) },
  ];

  // ── Menu context injection ──────────────────────────────────────────────
  const lastMsg = history[history.length - 1]?.content.toLowerCase() || "";

  // Check if the conversation history has stale "menu unavailable" replies
  // (happens when DB was empty earlier in the session but now has items)
  const historyHasStaleDenial = history.some(
    (m) =>
      m.role === "assistant" &&
      (m.content.includes("menu is currently being updated") ||
        m.content.includes("no items available") ||
        m.content.includes("menu unavailable"))
  );

  if (!currentMenu) {
    // ── DB is empty / errored ──────────────────────────────────────────
    // Only warn about unavailability if the user is actually asking about food.
    // For plain greetings ("Hi", "Aoa") reply normally without mentioning menu.
    // Issue #5: The old check included `lastMsg.length > 20` as a heuristic for
    // "probably food-related". This is a false-positive trap — a greeting like
    // "Walaikum Assalam, how are you today?" is >20 chars and definitely NOT a food
    // query. Removed. Rely only on explicit food-related keywords.
    const isFoodQuery =
      lastMsg.includes("menu") ||
      lastMsg.includes("order") ||
      lastMsg.includes("item") ||
      lastMsg.includes("food") ||
      lastMsg.includes("list") ||
      lastMsg.includes("price") ||
      lastMsg.includes("have") ||
      lastMsg.includes("want") ||
      lastMsg.includes("eat") ||
      lastMsg.includes("khana") ||
      lastMsg.includes("khaana") ||
      lastMsg.includes("chahiye") ||
      lastMsg.includes("deliver") ||
      lastMsg.includes("show") ||
      lastMsg.includes("available") ||
      lastMsg.includes("suggest") ||
      lastMsg.includes("bata");

    if (isFoodQuery) {
      messages.push({
        role: "system",
        content: `MENU STATUS: The restaurant menu is currently empty or unavailable in the database. Politely inform the user that the menu is being updated and they should try again in a few minutes or call the restaurant directly. Do NOT invent or guess any items or prices.`,
      });
    }
  } else {
    // ── Menu IS available ─────────────────────────────────────────────
    // If old "menu unavailable" replies exist in history, correct them first
    if (historyHasStaleDenial) {
      messages.push({
        role: "system",
        content: `IMPORTANT CORRECTION: Previous responses in this conversation incorrectly stated the menu was unavailable. The menu IS NOW FULLY AVAILABLE. Ignore those old replies completely. Use the current menu data below to answer the user's question accurately.`,
      });
    }

    // Extract category names from the menu string
    const categories =
      currentMenu
        .match(/^### ([\w &/-]+)/gm)
        ?.map((c) => c.replace(/^### /, "").trim()) || [];

    // Issue #4: The old code used .find() and only matched the FIRST category the
    // user mentioned. "show me burgers and pizza" would inject burgers but silently
    // drop pizza. Now we collect ALL matched categories.
    const requestedCats = categories.filter((c) =>
      lastMsg.includes(c.toLowerCase())
    );

    if (requestedCats.length > 0) {
      // Inject only the requested categories' items (cleaned, no ### headers)
      const catSections = requestedCats.map((cat) => {
        const regex = new RegExp(`### ${cat}[\\s\\S]*?(?=### |$)`, "i");
        const rawCatData = currentMenu.match(regex)?.[0] || "";
        return `LIVE MENU DATA — ${cat}:\n${cleanMenuSection(rawCatData)}`;
      });
      messages.push({
        role: "system",
        content: `${catSections.join("\n\n")}\n\nAnswer the user's question using only these items and prices.`,
      });
    } else {
      // Always inject full categories so AI can answer ANY food question.
      // Issue #6: Use cleanMenuSection() on the full menu — the old code injected
      // raw `currentMenu` (with ### headers) for the non-category path, which
      // contradicted the point of cleanMenuSection. Now we clean it consistently.
      const cleanedMenu = cleanMenuSection(currentMenu);
      messages.push({
        role: "system",
        content: `LIVE MENU — CATEGORIES AVAILABLE:\n${categories.map((c) => `- *${c}*`).join("\n")}\n\nFULL MENU DATA (use for price/availability questions):\n${cleanedMenu}\n\nIf the user asks about a specific item, look it up above and answer accurately. If they ask to see a category, list its items with prices. Never guess prices or invent items not listed above.`,
      });
    }
  }

  // Inject order context if provided (e.g. an order was already placed recently)
  // This is the primary defence against duplicate orders
  if (orderContext) {
    messages.push({ role: "system", content: orderContext });
  }

  messages.push({ role: "system", content: "--- CONVERSATION HISTORY STARTS BELOW ---" });

  // Keep up to 50 messages to avoid losing cart context mid-order
  messages.push(...history.slice(-50));

  let lastOrderIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === "assistant" && (
      m.content.includes("order has been placed") ||
      m.content.includes("order is confirmed") ||
      m.content.includes("✅ Your order")
    )) {
      lastOrderIndex = i;
      break;
    }
  }

  let isOrderAlreadyPlaced = false;
  if (lastOrderIndex !== -1) {
    isOrderAlreadyPlaced = true;
    for (let i = lastOrderIndex + 1; i < history.length; i++) {
      if (history[i].role === "user") {
        const text = history[i].content.toLowerCase();
        if (text.includes("order again") || text.includes("order something else") || text.includes("new order") || text.includes("another order") || text.includes("add another") || text.includes("place a new order")) {
          isOrderAlreadyPlaced = false;
          break;
        }
      }
    }
  }

  // Double idempotency guard: even if orderContext is missing, if we see confirmation in history, we block the tools.
  const allowTools = !orderContext && !isOrderAlreadyPlaced;

  const primaryModel = process.env.AI_MODEL || "google/gemini-2.0-flash-001";
  // Issue #10: fallbackModel was hardcoded and couldn't be overridden without a
  // code deploy. Now reads from env — set AI_FALLBACK_MODEL in .env.local to change.
  const fallbackModel = process.env.AI_FALLBACK_MODEL || "anthropic/claude-3-haiku";

  // Issue #8: max_tokens was hardcoded at 2000. Large menus + 20-message history
  // can approach context limits. Read from env so it's tunable without a deploy.
  const maxTokens = parseInt(process.env.AI_MAX_TOKENS || "2000", 10);

  try {
    const completion = await client.chat.completions.create({
      model: primaryModel,
      max_tokens: maxTokens,
      messages,
      ...(allowTools ? { tools, tool_choice: "auto" } : {}),
    });

    const response = completion.choices[0].message;
    // Safety: If the AI returns a tool call but NO content text, ensure we have a blank string instead of undefined
    if (!response.content && !response.tool_calls) {
       response.content = "I'm sorry, I encountered a brief glitch. How can I help you with your order?";
    }
    return response;

  } catch (error) {
    console.error(`AI Primary Model (${primaryModel}) failed:`, error);
    
    // Attempt fallback
    try {
      console.log(`Attempting fallback with ${fallbackModel}...`);
      // If the fallback model is Anthropic, use the native Anthropic SDK.
      if (fallbackModel.includes("claude")) {
        const Anthropic = require("@anthropic-ai/sdk").default;
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY });
        const anthropicMessages = messages.filter(m => m.role !== "system").map(m => ({ role: m.role as any, content: m.content }));
        const systemMessage = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
        const completion = await anthropic.messages.create({
          model: fallbackModel.replace("anthropic/", ""), // e.g. claude-3-haiku-20240307
          max_tokens: maxTokens,
          system: systemMessage,
          messages: anthropicMessages,
        });
        return {
          role: "assistant",
          content: completion.content[0].type === "text" ? completion.content[0].text : "",
        } as any;
      }

      const completion = await client.chat.completions.create({
        model: fallbackModel,
        max_tokens: maxTokens,
        messages,
        ...(allowTools ? { tools, tool_choice: "auto" } : {}),
      });
      return completion.choices[0].message;
    } catch (fallbackError) {
      console.error("AI Fallback failed too:", fallbackError);
      throw error; // Re-throw original if fallback also fails
    }
  }
}