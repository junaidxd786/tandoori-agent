import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/conversations/[id]/messages
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
  const beforeSeq = Number.parseInt(searchParams.get("before_seq") ?? "", 10);

  let query = supabaseAdmin
    .from("messages")
    .select("id, ingest_seq, conversation_id, role, sender_kind, content, whatsapp_msg_id, created_at, delivery_status, delivery_error")
    .eq("conversation_id", id)
    .order("ingest_seq", { ascending: false })
    .limit(limit + 1);

  if (Number.isFinite(beforeSeq)) {
    query = query.lt("ingest_seq", beforeSeq);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const messages = (hasMore ? rows.slice(0, limit) : rows).reverse();

  return NextResponse.json({
    messages,
    hasMore,
    nextBeforeSeq: messages[0]?.ingest_seq ?? null,
  });
}
