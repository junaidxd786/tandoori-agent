import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select("*")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const items = Array.isArray(body) ? body : body.items;
    const replaceAll = body.replaceAll === true;

    if (!Array.isArray(items)) {
      return NextResponse.json({ error: "Invalid data format" }, { status: 400 });
    }

    // 1. Delete if replaceAll is true
    if (replaceAll) {
      await supabaseAdmin.from("menu_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }
    
    // 2. Insert (without IDs, let Postgres generate new ones)
    if (items.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from("menu_items")
        .insert(items.map((i: any, index: number) => ({
          name: i.name,
          price: i.price,
          category: i.category || null,
          is_available: i.is_available ?? true
        })));

      if (insertError) throw insertError;
    }

    const { invalidateCacheByPrefix } = await import("@/lib/cache");
    invalidateCacheByPrefix("menu_");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Menu update error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
