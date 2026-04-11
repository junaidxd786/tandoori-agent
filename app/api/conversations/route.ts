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
  const unreadOnly = searchParams.get("unread_only") === "1";
  const lite = searchParams.get("lite") === "1";

  if (lite) {
    let query = supabaseAdmin.from("conversations").select(`
      id,
      branch_id,
      phone,
      name,
      mode,
      has_unread,
      updated_at,
      created_at,
      messages (
        content,
        created_at
      )
    `);

    query = query.order("updated_at", { ascending: false });
    if (auth.branchId) {
      query = query.eq("branch_id", auth.branchId);
    }
    if (unreadOnly) {
      query = query.eq("has_unread", true);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false, foreignTable: "messages" })
      .limit(1, { foreignTable: "messages" })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("API /conversations DB Error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  }

  let query = supabaseAdmin.from("conversations").select(`
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
      user_sessions (
        active_node,
        status,
        is_bot_active,
        invalid_step_count,
        escalation_reason,
        escalated_at
      ),
      messages (
        content,
        role,
        sender_kind,
        delivery_status,
        created_at
      )
    `);
  query = query.order("updated_at", { ascending: false });

  if (auth.branchId) {
    query = query.eq("branch_id", auth.branchId);
  }
  if (unreadOnly) {
    query = query.eq("has_unread", true);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false, foreignTable: "messages" })
    .limit(1, { foreignTable: "messages" })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("API /conversations DB Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
