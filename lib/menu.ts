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

export type MenuValidationIssue = {
  code: "duplicate_name" | "invalid_name" | "invalid_price";
  message: string;
  name: string | null;
  index: number;
};

export type SanitizedMenuItem = {
  name: string;
  price: number;
  category: string | null;
  description: string | null;
  is_available: boolean;
  sort_order: number;
};

export type MenuCatalogItem = {
  id: string;
  name: string;
  price: number;
  category: string | null;
  is_available: boolean;
};

const MENU_CACHE_TTL_MS = 30 * 1000;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeMenuCategory(category?: string | null): string | null {
  const normalized = normalizeWhitespace(category ?? "");
  if (!normalized) return null;

  return normalized
    .split(" ")
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "bbq") return "BBQ";
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function getMenuNameKey(name: string): string {
  return normalizeWhitespace(name).toLowerCase();
}

export function sanitizeMenuItems(items: MenuItem[]) {
  const sanitized: SanitizedMenuItem[] = [];
  const issues: MenuValidationIssue[] = [];
  const seenNames = new Set<string>();

  items.forEach((item, index) => {
    const name = normalizeWhitespace(item.name ?? "");
    const numericPrice = Number(item.price);

    if (!name) {
      issues.push({
        code: "invalid_name",
        message: "Item name cannot be empty.",
        name: null,
        index,
      });
      return;
    }

    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      issues.push({
        code: "invalid_price",
        message: `Price for ${name} must be a non-negative number.`,
        name,
        index,
      });
      return;
    }

    const nameKey = getMenuNameKey(name);
    if (seenNames.has(nameKey)) {
      issues.push({
        code: "duplicate_name",
        message: `Duplicate item detected: ${name}.`,
        name,
        index,
      });
      return;
    }

    seenNames.add(nameKey);
    sanitized.push({
      name,
      price: numericPrice,
      category: normalizeMenuCategory(item.category),
      description: item.description ? normalizeWhitespace(item.description) : null,
      is_available: item.is_available ?? true,
      sort_order: sanitized.length,
    });
  });

  return { items: sanitized, issues };
}

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

function getMenuCatalogCacheKey(branchId: string) {
  return `menu_catalog:${branchId}`;
}

function getMenuAiCacheKey(branchId: string) {
  return `menu_ai:${branchId}`;
}

export async function getMenuCatalog(branchId: string): Promise<MenuCatalogItem[]> {
  const cacheKey = getMenuCatalogCacheKey(branchId);
  const cached = getCached<MenuCatalogItem[]>(cacheKey);
  if (cached) return cached;

  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select("id, name, price, category, is_available")
    .eq("branch_id", branchId)
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

  setCached(cacheKey, items, MENU_CACHE_TTL_MS);
  return items;
}

export async function getMenuForAI(branchId: string): Promise<string | null> {
  const cacheKey = getMenuAiCacheKey(branchId);
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;

  const items = await getMenuCatalog(branchId);
  const formatted = formatMenuForAI(items);
  if (formatted) {
    setCached(cacheKey, formatted, MENU_CACHE_TTL_MS);
  }
  return formatted;
}

export function invalidateMenuCache(branchId?: string): void {
  if (!branchId) return;
  invalidateCache(getMenuCatalogCacheKey(branchId));
  invalidateCache(getMenuAiCacheKey(branchId));
}

export async function applyMenuCatalog(branchId: string, items: MenuItem[], replaceAll = false) {
  const sanitized = sanitizeMenuItems(items);
  if (sanitized.issues.length > 0) {
    const message = sanitized.issues.map((issue) => issue.message).join(" ");
    throw new Error(message);
  }

  const { error } = await supabaseAdmin.rpc("apply_menu_catalog", {
    branch_uuid: branchId,
    menu_payload: sanitized.items,
    replace_all: replaceAll,
  });
  if (error) throw error;

  invalidateMenuCache(branchId);
}

export async function updateMenuFromExtraction(branchId: string, items: MenuItem[]) {
  await applyMenuCatalog(branchId, items, true);
}

export async function createMenuUpload(branchId: string, imageUrl: string) {
  const { data, error } = await supabaseAdmin
    .from("menu_uploads")
    .insert({ branch_id: branchId, image_url: imageUrl, status: "pending" })
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
