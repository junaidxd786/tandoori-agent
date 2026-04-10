import { NextRequest, NextResponse } from "next/server";
import { resolveRequestBranch } from "@/lib/branch-request";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const auth = await resolveRequestBranch(req, { allowAllForAdmin: true });
  if (auth.response) {
    return auth.response;
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get("limit") ?? "40", 10) || 40, 1), 100);
  const offset = Math.max(Number.parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

  let query = supabaseAdmin
    .from("conversations")
    .select(`
      id,
      branch_id,
      phone,
      name,
      mode,
      has_unread,
      updated_at,
      created_at,
      branches (id, name, slug, address),
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
    .order("updated_at", { ascending: false });

  if (auth.branchId) {
    query = query.eq("branch_id", auth.branchId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false, foreignTable: "messages" })
    .limit(1, { foreignTable: "messages" })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
