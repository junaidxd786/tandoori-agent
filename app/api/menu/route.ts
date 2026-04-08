import { NextRequest, NextResponse } from "next/server";
import { applyMenuCatalog, sanitizeMenuItems } from "@/lib/menu";
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

    const sanitized = sanitizeMenuItems(items);
    if (sanitized.issues.length > 0) {
      return NextResponse.json(
        {
          error: "Menu validation failed",
          issues: sanitized.issues,
        },
        { status: 400 },
      );
    }

    await applyMenuCatalog(sanitized.items, replaceAll);
    return NextResponse.json({
      success: true,
      replaceAll,
      applied: sanitized.items.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Menu update failed";
    console.error("[menu route] PUT failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
