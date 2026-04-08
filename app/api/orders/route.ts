import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/orders
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(`
      *,
      order_items (*),
      conversations (phone, name)
    `)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
