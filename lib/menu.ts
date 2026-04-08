import { getCached, invalidateCache, setCached } from "./cache";
import { supabaseAdmin } from "./supabase-admin";

export type MenuItem = {
  id?: string;
  name: string;
  price: number;
  category?: string | null;
  description?: string | null;
  is_available?: boolean;
};

export type MenuCatalogItem = {
  id: string;
  name: string;
  price: number;
  category: string | null;
  is_available: boolean;
};

const MENU_CATALOG_CACHE_KEY = "menu_catalog";
const MENU_AI_CACHE_KEY = "menu_ai";
const MENU_CACHE_TTL_MS = 30 * 1000;

function formatMenuForAI(items: MenuCatalogItem[]): string | null {
  if (items.length === 0) return null;

  const grouped = items.reduce<Record<string, string[]>>((accumulator, item) => {
    const category = item.category?.trim() || "General";
    if (!accumulator[category]) accumulator[category] = [];
    accumulator[category].push(`- ${item.name} - Rs. ${Number(item.price)}`);
    return accumulator;
  }, {});

  return Object.entries(grouped)
    .map(([category, lines]) => `### ${category}\n${lines.join("\n")}`)
    .join("\n\n");
}

export async function getMenuCatalog(): Promise<MenuCatalogItem[]> {
  const cached = getCached<MenuCatalogItem[]>(MENU_CATALOG_CACHE_KEY);
  if (cached) return cached;

  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select("id, name, price, category, is_available")
    .eq("is_available", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error || !data) {
    console.error("[getMenuCatalog] Failed to load menu:", error);
    return [];
  }

  const items = data.map((item) => ({
    id: item.id,
    name: item.name,
    price: Number(item.price),
    category: item.category ?? null,
    is_available: item.is_available ?? true,
  }));

  setCached(MENU_CATALOG_CACHE_KEY, items, MENU_CACHE_TTL_MS);
  return items;
}

export async function getMenuForAI(): Promise<string | null> {
  const cached = getCached<string>(MENU_AI_CACHE_KEY);
  if (cached) return cached;

  const items = await getMenuCatalog();
  const formatted = formatMenuForAI(items);
  if (formatted) {
    setCached(MENU_AI_CACHE_KEY, formatted, MENU_CACHE_TTL_MS);
  }
  return formatted;
}

export function invalidateMenuCache(): void {
  invalidateCache(MENU_CATALOG_CACHE_KEY);
  invalidateCache(MENU_AI_CACHE_KEY);
}

export async function updateMenuFromExtraction(items: MenuItem[]) {
  const payload = items.map((item, index) => ({
    name: item.name,
    price: Number(item.price),
    category: item.category ?? null,
    description: item.description ?? null,
    is_available: item.is_available ?? true,
    sort_order: index,
  }));

  const { error } = await supabaseAdmin.rpc("replace_menu_items", {
    menu_payload: payload,
  });
  if (error) throw error;

  invalidateMenuCache();
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
  errorMessage?: string,
) {
  const { error } = await supabaseAdmin
    .from("menu_uploads")
    .update({ status, error_message: errorMessage || null })
    .eq("id", id);

  if (error) throw error;
}
