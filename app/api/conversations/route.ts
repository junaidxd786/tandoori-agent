import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get("limit") ?? "40", 10) || 40, 1), 100);
  const offset = Math.max(Number.parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      phone,
      name,
      mode,
      has_unread,
      updated_at,
      created_at,
      conversation_states (
        workflow_step,
        order_type,
        address,
        guests,
        reservation_time,
        cart,
        last_error
      ),
      messages (
        content,
        role,
        sender_kind,
        delivery_status,
        created_at
      )
    `)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false, foreignTable: "messages" })
    .limit(1, { foreignTable: "messages" })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
