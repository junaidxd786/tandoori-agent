import { supabaseAdmin } from "./supabase-admin";

export interface BranchRecord {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BranchSummary {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string;
}

function normalizeBranchValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isBranchChangeRequest(messageText: string): boolean {
  const normalized = normalizeBranchValue(messageText);
  return [
    "change branch",
    "switch branch",
    "select branch",
    "branch change",
    "choose branch",
    "different branch",
    "another branch",
    "branch badal",
    "branch change karna",
    "branch badal do",
  ].some((pattern) => normalized.includes(pattern));
}

export async function getActiveBranches(): Promise<BranchRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("branches")
    .select("id, slug, name, city, address, is_active, created_at, updated_at")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("[branches] Failed to load active branches:", error);
    return [];
  }

  return data ?? [];
}

export async function getBranchById(branchId: string): Promise<BranchRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("branches")
    .select("id, slug, name, city, address, is_active, created_at, updated_at")
    .eq("id", branchId)
    .maybeSingle();

  if (error) {
    console.error("[branches] Failed to load branch:", error);
    return null;
  }

  return data ?? null;
}

export function getBranchSelectionPrompt(branches: BranchSummary[], prefersRomanUrdu: boolean): string {
  if (branches.length === 0) {
    return prefersRomanUrdu
      ? "Maazrat, is waqt koi branch available nahi hai. Thori dair baad dobara try karein."
      : "Sorry, there are no branches available right now. Please try again shortly.";
  }

  const intro = prefersRomanUrdu
    ? "Order shuru karne se pehle apni branch select karein:"
    : "Before we start your order, please choose your branch:";
  const closing = prefersRomanUrdu
    ? "Reply mein branch number ya branch ka naam bhej dein."
    : "Reply with the branch number or the branch name.";

  return [
    intro,
    ...branches.map((branch, index) => `${index + 1}. ${branch.name}${branch.address ? ` - ${branch.address}` : ""}`),
    closing,
  ].join("\n");
}

export function findBranchSelection(input: string, branches: BranchSummary[]): BranchSummary | null {
  const raw = input.trim();
  const normalized = normalizeBranchValue(raw);
  if (!normalized) return null;

  const byId = branches.find((branch) => branch.id.toLowerCase() === raw.toLowerCase());
  if (byId) return byId;

  // Handle interactive list selection
  const optionMatch = raw.match(/^branch[_\s-]?option[_\s-]?(\d+)$/i);
  if (optionMatch) {
    const index = Number.parseInt(optionMatch[1], 10) - 1;
    if (index >= 0 && index < branches.length) {
      return branches[index];
    }
  }

  const numberMatch = normalized.match(/\b(\d{1,2})\b/);
  if (numberMatch) {
    const index = Number.parseInt(numberMatch[1], 10) - 1;
    if (index >= 0 && index < branches.length) {
      return branches[index];
    }
  }

  const exact = branches.find((branch) => {
    const values = [branch.name, branch.slug, branch.address].map((value) => normalizeBranchValue(value));
    return values.some((value) => value === normalized);
  });
  if (exact) return exact;

  const fuzzy = branches.find((branch) => {
    const values = [branch.name, branch.slug, branch.address].map((value) => normalizeBranchValue(value));
    return values.some((value) => value.includes(normalized) || normalized.includes(value));
  });

  return fuzzy ?? null;
}
