import { NextRequest, NextResponse } from "next/server";
import { invalidateMenuCache } from "@/lib/menu";
import { supabaseAdmin } from "@/lib/supabase-admin";

type IncomingMenuItem = {
  name: string;
  price: number;
  category?: string | null;
  is_available?: boolean;
};

type MenuPutBody = {
  items?: IncomingMenuItem[];
  replaceAll?: boolean;
};

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select("*")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as MenuPutBody | IncomingMenuItem[];
    const replaceAll = !Array.isArray(body) && body.replaceAll === true;
    const items = Array.isArray(body) ? body : body.items ?? [];

    if (!Array.isArray(items)) {
      return NextResponse.json({ error: "Invalid data format" }, { status: 400 });
    }

    if (replaceAll) {
      const { error: deleteError } = await supabaseAdmin
        .from("menu_items")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      if (deleteError) throw deleteError;
    }

    if (items.length > 0) {
      const normalizedItems = items
        .filter((item) => item.name.trim().length > 0)
        .map((item) => ({
          name: item.name.trim(),
          price: Number(item.price),
          category: item.category?.trim() || null,
          is_available: item.is_available ?? true,
        }));

      const { error: insertError } = await supabaseAdmin.from("menu_items").insert(normalizedItems);
      if (insertError) throw insertError;
    }

    invalidateMenuCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Menu update failed";
    console.error("[menu route] PUT failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
