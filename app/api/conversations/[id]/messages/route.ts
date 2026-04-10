import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/branch-request";
import { canAccessConversation } from "@/lib/record-access";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/conversations/[id]/messages
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const accessibleConversation = await canAccessConversation(auth.session, id);
  if (!accessibleConversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
  const beforeSeq = Number.parseInt(searchParams.get("before_seq") ?? "", 10);

  let query = supabaseAdmin
    .from("messages")
    .select("id, ingest_seq, conversation_id, role, sender_kind, content, whatsapp_msg_id, created_at, delivery_status, delivery_error")
    .eq("conversation_id", accessibleConversation.id)
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
  const messages = (hasMore ? rows.slice(0, limit) : rows).sort((left, right) => {
    const leftTime = new Date(left.created_at).getTime();
    const rightTime = new Date(right.created_at).getTime();
    const leftValid = Number.isFinite(leftTime);
    const rightValid = Number.isFinite(rightTime);

    if (leftValid && rightValid && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    if (leftValid && !rightValid) return -1;
    if (!leftValid && rightValid) return 1;

    return left.ingest_seq - right.ingest_seq;
  });

  return NextResponse.json({
    messages,
    hasMore,
    nextBeforeSeq: messages[0]?.ingest_seq ?? null,
  });
}
