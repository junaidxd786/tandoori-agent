import { NextRequest, NextResponse } from "next/server";
import { resolveRequestBranch } from "@/lib/branch-request";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/orders
export async function GET(req: NextRequest) {
  const auth = await resolveRequestBranch(req, { allowAllForAdmin: true });
  if (auth.response) {
    return auth.response;
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
  const offset = Math.max(Number.parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

  let query = supabaseAdmin
    .from("orders")
    .select(`
      id,
      branch_id,
      order_number,
      type,
      status,
      subtotal,
      delivery_fee,
      address,
      guests,
      reservation_time,
      assigned_to,
      status_notified_at,
      status_notification_status,
      status_notification_error,
      created_at,
      branches (id, name, slug),
      order_items (id, name, qty, price),
      conversations (phone, name)
    `)
    .order("created_at", { ascending: false });

  if (auth.branchId) {
    query = query.eq("branch_id", auth.branchId);
  }

  const { data, error } = await query.range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
