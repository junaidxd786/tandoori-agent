import { getCached, invalidateCache, setCached } from "./cache";
import { syncMenuEmbeddingsForBranch } from "./semantic-menu";
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
  const availableItems = items.filter((item) => item.is_available);
  if (availableItems.length === 0) return null;

  const grouped = availableItems.reduce<Record<string, string[]>>((accumulator, item) => {
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

  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("menu_items")
    .select("id, name")
    .eq("branch_id", branchId);
  if (existingError) throw existingError;

  const existingByName = new Map<string, { id: string; name: string }>();
  for (const row of existingRows ?? []) {
    existingByName.set(getMenuNameKey(row.name), row);
  }

  for (const item of sanitized.items) {
    const normalizedName = getMenuNameKey(item.name);
    const existing = existingByName.get(normalizedName);
    const payload = {
      name: item.name,
      price: item.price,
      category: item.category,
      is_available: item.is_available,
    };

    if (existing) {
      const { error: updateError } = await supabaseAdmin.from("menu_items").update(payload).eq("id", existing.id);
      if (updateError) throw updateError;
      continue;
    }

    const { error: insertError } = await supabaseAdmin.from("menu_items").insert({
      branch_id: branchId,
      ...payload,
    });
    if (insertError) throw insertError;
  }

  if (replaceAll) {
    const incomingNames = new Set(sanitized.items.map((item) => getMenuNameKey(item.name)));
    const idsToDelete = (existingRows ?? [])
      .filter((row) => !incomingNames.has(getMenuNameKey(row.name)))
      .map((row) => row.id);

    if (idsToDelete.length > 0) {
      const { error: deleteError } = await supabaseAdmin.from("menu_items").delete().in("id", idsToDelete);
      if (deleteError) throw deleteError;
    }
  }

  invalidateMenuCache(branchId);
  await syncMenuEmbeddingsForBranch(branchId).catch((error) => {
    console.error("[menu] Failed to sync semantic embeddings:", error);
  });
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
