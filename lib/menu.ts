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
 * Fetch all available menu items formatted for the AI
 */
/**
 * Fetch all available menu items from Supabase.
 * Always fetches live — no in-memory cache (Next.js route isolation means
 * cache busting from menu/route.ts would never reach the webhook's cache instance).
 * Returns null if DB is empty or errored.
 */
export async function getMenuForAI(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select("name, price, category")
    .eq("is_available", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("Error fetching menu for AI:", error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  const groupedMenu = data.reduce((acc: any, item) => {
    const cat = item.category || "General";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(`${item.name}: Rs. ${item.price}`);
    return acc;
  }, {});

  return Object.entries(groupedMenu)
    .map(([cat, items]) => `### ${cat}\n${(items as string[]).join("\n")}`)
    .join("\n\n");
}


export async function updateMenuFromExtraction(items: MenuItem[]) {
  // 1. Delete all existing items (since this is a full menu update)
  const { error: deleteError } = await supabaseAdmin
    .from("menu_items")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000"); // Standard "delete all" trick

  if (deleteError) throw deleteError;

  const { error: insertError } = await supabaseAdmin
    .from("menu_items")
    .insert(items);

  if (insertError) throw insertError;

  // 3. Clear the cache
  invalidateCacheByPrefix("menu_");
}

/**
 * Log a new menu upload attempt
 */
export async function createMenuUpload(imageUrl: string) {
  const { data, error } = await supabaseAdmin
    .from("menu_uploads")
    .insert({ image_url: imageUrl, status: "pending" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update the status of a menu upload
 */
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
