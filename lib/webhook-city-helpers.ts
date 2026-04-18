import type { BranchSummary } from "./branches";

type MenuCatalogCategoryItem = {
  category: string | null;
};

export type CityBranchGroup = {
  city: string;
  branches: BranchSummary[];
};

export function normalizeCityValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeCities(cities: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const city of cities) {
    const normalized = normalizeCityValue(city);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(city.trim());
  }

  return deduped;
}

export function buildInteractiveListForCities(
  cities: string[],
  prefersRomanUrdu: boolean,
):
  | {
    body: string;
    buttonText: string;
    sectionTitle?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }
  | null {
  const uniqueCities = dedupeCities(cities);
  if (uniqueCities.length < 1) {
    return null;
  }

  const rows = uniqueCities.slice(0, 10).map((city, index) => ({
    id: `city_option_${index + 1}`,
    title: city,
  }));

  return {
    body: prefersRomanUrdu
      ? "Welcome! Sab se pehle apna city select karein."
      : "Welcome! First, please choose your city.",
    buttonText: prefersRomanUrdu ? "Select City" : "Select City",
    sectionTitle: prefersRomanUrdu ? "Cities" : "Cities",
    rows,
  };
}

export function getCitySelectionPrompt(cities: string[], prefersRomanUrdu: boolean): string {
  const uniqueCities = dedupeCities(cities);
  if (uniqueCities.length === 0) {
    return prefersRomanUrdu
      ? "Maazrat, abhi city list available nahi hai. Thori dair baad try karein."
      : "Sorry, city options are not available right now. Please try again shortly.";
  }

  const intro = prefersRomanUrdu
    ? "Welcome! Sab se pehle apna city select karein:"
    : "Welcome! First, please choose your city:";
  const closing = prefersRomanUrdu
    ? "Reply mein city ka naam bhej dein."
    : "Reply with your city name.";

  return [intro, ...uniqueCities.map((city, index) => `${index + 1}. ${city}`), closing].join("\n");
}

export function findCitySelection(input: string, cities: string[]): string | null {
  const uniqueCities = dedupeCities(cities);
  const raw = input.trim();
  const normalizedInput = normalizeCityValue(raw);
  if (!normalizedInput || uniqueCities.length === 0) return null;

  const optionMatch = raw.match(/^city[_\s-]?option[_\s-]?(\d+)$/i);
  if (optionMatch) {
    const index = Number.parseInt(optionMatch[1], 10) - 1;
    if (index >= 0 && index < uniqueCities.length) {
      return uniqueCities[index];
    }
  }

  const numberMatch = normalizedInput.match(/\b(\d{1,2})\b/);
  if (numberMatch) {
    const index = Number.parseInt(numberMatch[1], 10) - 1;
    if (index >= 0 && index < uniqueCities.length) {
      return uniqueCities[index];
    }
  }

  const exact = uniqueCities.find((city) => normalizeCityValue(city) === normalizedInput);
  if (exact) return exact;

  const fuzzy = uniqueCities.find((city) => {
    const normalizedCity = normalizeCityValue(city);
    return normalizedCity.includes(normalizedInput) || normalizedInput.includes(normalizedCity);
  });

  return fuzzy ?? null;
}

export async function buildCityBranchGroups(branches: BranchSummary[]): Promise<CityBranchGroup[]> {
  if (branches.length === 0) return [];

  const grouped = new Map<string, CityBranchGroup>();
  for (const branch of branches) {
    const rawCity = branch.city?.trim() || deriveCityFromAddress(branch.address);
    const normalizedCity = normalizeCityValue(rawCity);
    if (!normalizedCity) continue;

    const existing = grouped.get(normalizedCity);
    if (existing) {
      existing.branches.push(branch);
      continue;
    }

    grouped.set(normalizedCity, {
      city: rawCity.trim(),
      branches: [branch],
    });
  }

  return Array.from(grouped.values()).sort((left, right) => left.city.localeCompare(right.city));
}

function deriveCityFromAddress(address: string | null | undefined): string {
  const fallbackCity = process.env.NEXT_PUBLIC_APP_CITY?.trim() || "Wah Cantt";
  if (!address) return fallbackCity;

  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts[parts.length - 1] : fallbackCity;
}

function getUniqueMenuCategories(menuItems: MenuCatalogCategoryItem[]): string[] {
  return [...new Set(menuItems.map((item) => item.category?.trim() || "General"))];
}

export function buildInteractiveCategoryList(
  menuItems: MenuCatalogCategoryItem[],
  prefersRomanUrdu: boolean,
  page: number,
):
  | {
    body: string;
    buttonText: string;
    sectionTitle?: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }
  | null {
  const categories = getUniqueMenuCategories(menuItems);
  if (categories.length < 2) return null;

  const pageSize = 9;
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  if (start >= categories.length) return null;

  const pageCategories = categories.slice(start, start + pageSize);
  const rows = pageCategories.map((category, index) => {
    const absoluteIndex = start + index + 1;
    const title = category.length > 24 ? `${category.slice(0, 21)}...` : category;
    return {
      id: `category_option_${absoluteIndex}`,
      title,
    };
  });

  const hasMore = start + pageSize < categories.length;
  if (hasMore) {
    rows.push({
      id: `category_more_${safePage + 1}`,
      title: prefersRomanUrdu ? "More Categories" : "More Categories",
    });
  }

  return {
    body: prefersRomanUrdu
      ? "Menu categories se ek select karein."
      : "Choose a category from the menu.",
    buttonText: prefersRomanUrdu ? "Select Category" : "Select Category",
    sectionTitle: prefersRomanUrdu ? "Categories" : "Categories",
    rows,
  };
}
