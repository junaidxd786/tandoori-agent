import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAIReply } from "@/lib/ai";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getMenuForAI } from "@/lib/menu";
import { getRestaurantSettings, updateRestaurantSettings, isWithinOperatingHours } from "@/lib/settings";


// GET — Meta webhook verification
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

// POST — Incoming messages from Meta
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Always return 200 immediately to Meta
  processWebhook(body).catch((err) =>
    console.error("Webhook processing error:", err)
  );

  return new Response("OK", { status: 200 });
}

async function processWebhook(body: any) {
  try {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;
    if (!messages || messages.length === 0) return;

    const msg = messages[0];
    const from: string = msg.from;
    const whatsappMsgId: string = msg.id;
    const msgType: string = msg.type;
    const contactName: string = value?.contacts?.[0]?.profile?.name ?? from;

    if (msgType !== "text") {
      if (msgType !== "reaction") {
        await sendWhatsAppMessage(from, "Assalam o Alaikum! 👋 Please send a text message for ordering.");
      }
      return;
    }

    const messageText: string = msg.text?.body ?? "";
    const timestamp = new Date(parseInt(msg.timestamp) * 1000).toISOString();

    // 1. Get/Create Conversation
    const { data: conversation, error: convError } = await supabaseAdmin
      .from("conversations")
      .upsert({ phone: from, name: contactName, has_unread: true, updated_at: new Date().toISOString() }, { onConflict: "phone" })
      .select().single();

    if (convError || !conversation || conversation.mode === "human") {
      console.log("Webhook aborted: convError, no conversation, or mode=human", { convError, mode: conversation?.mode });
      return;
    }

    // 2. Save User Message (unique on whatsapp_msg_id to prevent replays)
    const { error: msgError } = await supabaseAdmin.from("messages").insert({
      conversation_id: conversation.id,
      role: "user",
      content: messageText,
      whatsapp_msg_id: whatsappMsgId,
      created_at: timestamp,
    });
    if (msgError) {
      console.log("Webhook aborted: msgError (likely deduplication)", msgError);
      return;
    }

    console.log("Fetching AI Reply...");
    // 3. Fetch History (last 3 hours for session expiry, up to 20 messages)
    const sessionStart = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    const [{ data: historyRows }, menuString, { data: recentOrders }] = await Promise.all([
      supabaseAdmin
        .from("messages")
        .select("role, content")
        .eq("conversation_id", conversation.id)
        .gte("created_at", sessionStart)
        .order("created_at", { ascending: false })
        .limit(50),
      getMenuForAI(),
      // Check if an order was already placed recently for this conversation
      supabaseAdmin
        .from("orders")
        .select("id, subtotal, type, status, created_at")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    // Reverse history to maintain chronological order for the AI
    const history = (historyRows ?? []).reverse().map((r) => ({ role: r.role, content: r.content }));

    // 3b. Fetch settings & auto-toggle is_accepting_orders based on clock
    const settings = await getRestaurantSettings();
    const withinHours = isWithinOperatingHours(settings.opening_time, settings.closing_time);
    const isOpenNow = settings.is_accepting_orders && withinHours;

    // Auto-toggle: keep the DB flag in sync with the clock
    if (withinHours && !settings.is_accepting_orders) {
      // Clock says open, but flag is off → turn it on automatically
      await updateRestaurantSettings({ is_accepting_orders: true }).catch((e) => console.error("[Auto-toggle] Failed to update settings:", e));
      console.log("[Auto-toggle] Restaurant opened — is_accepting_orders set to TRUE");
    } else if (!withinHours && settings.is_accepting_orders) {
      // Clock says closed, but flag is still on → turn it off automatically
      await updateRestaurantSettings({ is_accepting_orders: false }).catch((e) => console.error("[Auto-toggle] Failed to update settings:", e));
      console.log("[Auto-toggle] Restaurant closed — is_accepting_orders set to FALSE");
    }

    // 4. Inject recent order context into the AI so it knows the order state
    //    This prevents the AI from placing the order again after confirmation
    const recentOrder = recentOrders?.[0];
    const recentOrderMinutesAgo = recentOrder
      ? (Date.now() - new Date(recentOrder.created_at).getTime()) / 60000
      : null;

    const orderContext =
      recentOrder && recentOrderMinutesAgo !== null && recentOrderMinutesAgo < 180
        ? `[SYSTEM: An order (subtotal Rs.${recentOrder.subtotal}, type: ${recentOrder.type}, status: ${recentOrder.status}) was ALREADY PLACED for this conversation ${Math.round(recentOrderMinutesAgo)} minute(s) ago. DO NOT call place_order again for the same order. If the user asks about their order, confirm it has been placed and give them the query phone number. Only place a NEW order if the user explicitly requests one.]`
        : null;

    // 5. Get AI Reply (with Tool Calling) — pass isOpenNow so AI cannot hallucinate open/closed
    const hasHistory = (historyRows ?? []).some(r => r.role === "assistant");
    const aiResponse = await getAIReply(history, menuString ?? undefined, orderContext, isOpenNow, hasHistory, settings);

    // 6. Handle Tool Calls — with strict deduplication guard
    const deliveryPhone = process.env.NEXT_PUBLIC_APP_PHONE_DELIVERY || "";
    let orderWasJustPlaced = false;

    if (aiResponse.tool_calls) {
      for (const tool of aiResponse.tool_calls) {
        if (tool.function.name === "place_order") {
          // Guard: Prevent placing a duplicate order within the last 5 minutes
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const { data: veryRecentOrder } = await supabaseAdmin
            .from("orders")
            .select("id")
            .eq("conversation_id", conversation.id)
            .gte("created_at", fiveMinutesAgo)
            .maybeSingle();

          if (veryRecentOrder) {
            console.log("⛔ Duplicate order PREVENTED — order already placed within 5 mins:", veryRecentOrder.id);
          } else {
            const args = JSON.parse(tool.function.arguments);
            try {
              await handlePlaceOrder(conversation.id, args);
              orderWasJustPlaced = true;
              console.log("✅ Order placed successfully for conversation:", conversation.id);
            } catch (orderErr: any) {
              console.error("handlePlaceOrder failed:", orderErr.message);
              aiResponse.content = `Sorry, we couldn't process your order — one of the items may have been removed from our menu. Please check the menu and try again, or call ${deliveryPhone}.`;
            }
          }
        }
      }
    }

    // 7. Determine the final reply content
    //    CRITICAL: If the AI placed an order but returned no text (empty content),
    //    inject a hardcoded confirmation so the history stays complete.
    //    An incomplete history is the ROOT CAUSE of duplicate orders on follow-up messages.
    let finalContent = aiResponse.content?.trim() || null;
    if (orderWasJustPlaced && !finalContent) {
      finalContent = `✅ Your order has been placed! We'll be with you shortly. For queries call ${deliveryPhone}`;
    }

    // 8. Send reply to WhatsApp & persist to DB
    if (finalContent) {
      await sendWhatsAppMessage(from, finalContent);
      await supabaseAdmin.from("messages").insert({
        conversation_id: conversation.id,
        role: "assistant",
        content: finalContent,
      });
    }

    // 9. Update conversation timestamp
    await supabaseAdmin
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversation.id);

  } catch (err) {
    console.error("processWebhook error:", err);
    
    // Recovery Phase: Try to gracefully notify the user if possible
    try {
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const messages = value?.messages;
      if (messages && messages.length > 0) {
        const from = messages[0].from;
        if (from) {
          console.log("Sending fallback message to", from);
          const fallbackPhone = process.env.NEXT_PUBLIC_APP_PHONE_DELIVERY || "our support line";
          await sendWhatsAppMessage(from, `⚠️ Mujhay kuch technical masla aa raha hai (System busy). Baraye meharbani thodi der baad try karein ya call karein: ${fallbackPhone}.`);
        }
      }
    } catch (fallbackErr) {
      console.error("Fallback handler also failed:", fallbackErr);
    }
  }
}

/**
 * Tool Handler: place_order
 */
async function handlePlaceOrder(conversationId: string, args: any) {
  // 0. Fetch authoritative settings for delivery fee
  const { getRestaurantSettings } = await import("@/lib/settings");
  const settings = await getRestaurantSettings();

  // delivery_enabled = true  → charge the configured fee
  // delivery_enabled = false → free delivery (fee = 0)
  // Delivery orders are ALWAYS accepted either way.
  const authorizedDeliveryFee = args.type === "delivery" && settings.delivery_enabled && settings.delivery_fee > 0
    ? Number(settings.delivery_fee)
    : 0;

  // 1. Fetch available menu items for price validation
  const { data: menuItems } = await supabaseAdmin
    .from("menu_items")
    .select("name, price")
    .eq("is_available", true);

  let validatedSubtotal = 0;
  const validatedItems = (args.items || []).map((item: any) => {
    // 1. Try exact (lowercase)
    let dbItem = (menuItems || []).find(m => m.name.toLowerCase() === item.name.toLowerCase());
    
    // 2. Try fuzzy: match if it significantly overlaps
    if (!dbItem) {
      const candidates = (menuItems || []).filter(m => 
        m.name.toLowerCase().includes(item.name.toLowerCase()) || 
        item.name.toLowerCase().includes(m.name.toLowerCase())
      );
      
      if (candidates.length > 0) {
        // Find the shortest match or the one that starts with the same word
        dbItem = candidates.reduce((a, b) => a.name.length < b.name.length ? a : b);
      }
    }

    // 3. Strict guard: MUST found in DB
    if (!dbItem) {
      throw new Error(`AI attempted to order an item not found in the database: ${item.name}`);
    }

    const finalPrice = Number(dbItem.price);
    validatedSubtotal += finalPrice * item.qty;
    
    return {
      name: dbItem.name,
      qty: item.qty,
      price: finalPrice,
    };
  });

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .insert({
      conversation_id: conversationId,
      type: args.type,
      subtotal: validatedSubtotal,
      delivery_fee: authorizedDeliveryFee,
      address: args.address || null,
      guests: args.guests || null,
      reservation_time: args.time || null,
      status: "received",
    })
    .select().single();

  if (orderError || !order) {
    throw new Error("Failed to create order record.");
  }

  if (validatedItems.length > 0) {
    const { error: itemsError } = await supabaseAdmin.from("order_items").insert(
      validatedItems.map((item: any) => ({
        order_id: order.id,
        name: item.name,
        qty: item.qty,
        price: item.price,
      }))
    );

    if (itemsError) {
      await supabaseAdmin.from("orders").delete().eq("id", order.id);
      throw new Error("Failed to save order items — order rolled back.");
    }
  }
}

