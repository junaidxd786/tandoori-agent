import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/orders
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
  const offset = Math.max(Number.parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(`
      *,
      order_items (*),
      conversations (phone, name)
    `)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
