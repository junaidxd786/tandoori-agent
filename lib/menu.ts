import { supabaseAdmin } from "./supabase-admin";
import { invalidateCacheByPrefix } from "./cache";

export type MenuItem = {
  id?: string;
  name: string;
  price: number;
  category?: string;
  description?: string;
  is_available?: boolean;
};

/**
 * Fetch all available menu items and format them for the AI context window.
 *
 * Format chosen deliberately:
 *   ### Category
 *     • Item Name — Rs. 850
 *
 * The bullet + em-dash (—) separator is visually distinctive and unambiguous.
 * The model cannot confuse "—" with a price range or a colon-separated key/value.
 *
 * Always fetches live from Supabase — no in-memory cache.
 * Next.js serverless route isolation means a cache set in one request cannot be
 * read by a different route handler, so caching here would silently serve stale data.
 */
export async function getMenuForAI(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select("name, price, category")
    .eq("is_available", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("[getMenuForAI] Supabase error:", error);
    return null;
  }

  if (!data || data.length === 0) return null;

  const grouped = data.reduce((acc: Record<string, string[]>, item) => {
    const cat = item.category?.trim() || "General";
    if (!acc[cat]) acc[cat] = [];
    // Rs. value stored as numeric — ensure no floating-point artefacts (e.g. 850.00 → 850)
    const price = Number.isInteger(item.price)
      ? item.price
      : parseFloat(item.price.toFixed(2));
    acc[cat].push(`  • ${item.name} — Rs. ${price}`);
    return acc;
  }, {});

  const lines = Object.entries(grouped).map(
    ([cat, items]) => `### ${cat}\n${items.join("\n")}`
  );

  return lines.join("\n\n");
}

/**
 * Replace the entire menu_items table with a new set of items.
 * Called after a successful image extraction in the dashboard.
 */
export async function updateMenuFromExtraction(items: MenuItem[]) {
  // Delete all rows (the neq trick avoids a missing WHERE clause error in Supabase)
  const { error: deleteError } = await supabaseAdmin
    .from("menu_items")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (deleteError) throw deleteError;

  const { error: insertError } = await supabaseAdmin
    .from("menu_items")
    .insert(items);

  if (insertError) throw insertError;

  // Bust any application-level caches keyed on "menu_"
  invalidateCacheByPrefix("menu_");
}

export async function createMenuUpload(imageUrl: string) {
  const { data, error } = await supabaseAdmin
    .from("menu_uploads")
    .insert({ image_url: imageUrl, status: "pending" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateMenuUploadStatus(
  id: string,
  status: "processing" | "completed" | "error",
  errorMessage?: string
) {
  const { error } = await supabaseAdmin
    .from("menu_uploads")
    .update({ status, error_message: errorMessage || null })
    .eq("id", id);

  if (error) throw error;
}