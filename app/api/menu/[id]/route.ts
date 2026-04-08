import { NextRequest, NextResponse } from "next/server";
import { invalidateMenuCache, normalizeMenuCategory } from "@/lib/menu";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/menu/[id] — update any field of a single menu item */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();

  const allowed = ["name", "price", "category", "is_available"] as const;
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if ("name" in updates) {
    const name = String(updates.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    updates.name = name;
  }

  if ("price" in updates) {
    const price = Number(updates.price);
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: "Price must be a non-negative number" }, { status: 400 });
    }
    updates.price = price;
  }

  if ("category" in updates) {
    updates.category = normalizeMenuCategory(String(updates.category ?? "")) ?? null;
  }

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("menu_items")
    .update(updates)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  invalidateMenuCache();

  return NextResponse.json({ success: true });
}

/** DELETE /api/menu/[id] — permanently remove a single menu item */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const { error } = await supabaseAdmin
    .from("menu_items")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  invalidateMenuCache();

  return NextResponse.json({ success: true });
}
