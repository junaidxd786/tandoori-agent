import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/conversations
export async function GET() {
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
      messages (
        content,
        role,
        created_at
      )
    `)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false, foreignTable: "messages" })
    .limit(1, { foreignTable: "messages" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
