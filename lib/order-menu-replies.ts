import { getMenuCategories } from "./order-menu-categories";
import { itemSimilarityScore, normalizeText, tokenOverlapScore } from "./order-text-utils";

type MenuCatalogItemLike = {
  id: string;
  name: string;
  price: number;
  category: string | null;
  is_available: boolean;
};

const CATEGORY_INTENT_ALIAS_RULES: Array<{
  queryTokens: string[];
  categoryHints: string[];
}> = [
  {
    queryTokens: ["drink", "drinks", "beverage", "beverages", "cold drink", "soft drink", "juice", "shake", "shakes"],
    categoryHints: ["beverage", "drink", "cold beverage", "hot beverage", "juice", "shake"],
  },
  {
    queryTokens: ["dessert", "desserts", "sweet", "sweets", "meetha", "ice cream", "icecream", "kulfi"],
    categoryHints: ["dessert", "sweet", "ice cream", "icecream", "kulfi"],
  },
  {
    queryTokens: ["bbq", "barbecue", "grill", "tikka", "boti", "kabab", "kebab", "chargha"],
    categoryHints: ["bbq", "barbecue", "grill", "tikka", "boti", "kabab", "kebab", "chargha"],
  },
  {
    queryTokens: ["biryani", "rice", "pulao"],
    categoryHints: ["biryani", "rice", "pulao"],
  },
];

export function findCategoryRequest(text: string, menuItems: MenuCatalogItemLike[]): string | null {
  const raw = text.trim();
  const normalized = normalizeText(raw);
  const categories = getMenuCategories(menuItems);

  const optionMatch = raw.match(/^category[_\s-]?option[_\s-]?(\d+)$/i);
  if (optionMatch) {
    const index = Number.parseInt(optionMatch[1], 10) - 1;
    if (index >= 0 && index < categories.length) {
      return categories[index];
    }
  }

  const numberMatch = normalized.match(/^(?:category|cat|option|number)?\s*(\d{1,2})$/);
  if (numberMatch) {
    const index = Number.parseInt(numberMatch[1], 10) - 1;
    if (index >= 0 && index < categories.length) {
      return categories[index];
    }
  }

  for (const category of categories) {
    const normCategory = normalizeText(category);
    if (normCategory && normalized.includes(normCategory)) return category;
  }

  for (const rule of CATEGORY_INTENT_ALIAS_RULES) {
    const hasIntentToken = rule.queryTokens.some((token) => normalized.includes(normalizeText(token)));
    if (!hasIntentToken) continue;

    const rankedCandidates = categories
      .map((category, index) => {
        const normalizedCategory = normalizeText(category);
        const score = rule.categoryHints.reduce((total, hint) => {
          return normalizedCategory.includes(normalizeText(hint)) ? total + 1 : total;
        }, 0);
        return { category, index, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    if (rankedCandidates.length > 0) {
      return rankedCandidates[0].category;
    }
  }

  const fuzzyCategory = categories
    .map((category) => ({
      category,
      score: Math.max(
        itemSimilarityScore(normalized, normalizeText(category)),
        tokenOverlapScore(normalized, normalizeText(category)),
      ),
    }))
    .filter((entry) => entry.score >= 0.52)
    .sort((left, right) => right.score - left.score)[0];

  if (fuzzyCategory) return fuzzyCategory.category;

  return null;
}

export function buildCategoryItemsReply(
  category: string,
  menuItems: MenuCatalogItemLike[],
  romanUrdu: boolean,
): { text: string; selectableItems: MenuCatalogItemLike[] } {
  const target = normalizeText(category);
  const rows = menuItems.filter((item) => normalizeText(item.category ?? "General") === target);
  if (rows.length === 0) {
    return {
      text: romanUrdu
        ? "Is category mein items nahi mile. Kisi aur category ka number ya naam bhej dein."
        : "No items found in that category. Please send another category number or name.",
      selectableItems: [],
    };
  }

  const selectableItems = rows.slice(0, 10);
  const lines = selectableItems.map((item, index) => `${index + 1}. ${item.name} - Rs. ${item.price}`);
  if (rows.length > selectableItems.length) {
    lines.push(
      romanUrdu
        ? `...aur ${rows.length - selectableItems.length} items bhi hain. Naam bhej kar search karein.`
        : `...and ${rows.length - selectableItems.length} more. Send item name to search further.`,
    );
  }

  const text = [
    `*${category}* items:`,
    ...lines,
    romanUrdu
      ? "Number ya item name ke sath quantity bhej dein (misal: *2* ya *2 Chicken Karahi*)."
      : "Reply with number or item name and quantity (e.g., *2* or *2 Chicken Karahi*).",
  ].join("\n");

  return { text, selectableItems };
}

export function buildAmbiguousItemReply(query: string, options: MenuCatalogItemLike[], romanUrdu: boolean): string {
  const lines = options.slice(0, 3).map((item, index) => `${index + 1}. ${item.name} - Rs. ${item.price}`);
  return [
    romanUrdu
      ? `*${query}* se mutaliq kaunsa item chahiye?`
      : `Which item did you mean for *${query}*?`,
    ...lines,
    romanUrdu ? "Number bhej dein." : "Reply with the number.",
  ].join("\n");
}

export function buildItemMatchesReply(query: string, options: MenuCatalogItemLike[], romanUrdu: boolean): string {
  const lines = options.slice(0, 10).map((item, index) => `${index + 1}. ${item.name} - Rs. ${item.price}`);
  const topResultsHint =
    options.length >= 10
      ? romanUrdu
        ? "Top matches dikhaye gaye hain. Zyada exact result ke liye poora item name bhej dein."
        : "Showing top matches. Send a more specific item name for broader accuracy."
      : null;
  return [
    romanUrdu ? `*${query}* ke related items ye hain:` : `Here are matching items for *${query}*:`,
    ...lines,
    ...(topResultsHint ? [topResultsHint] : []),
    romanUrdu
      ? "Order ke liye number select karein ya item name + quantity bhej dein."
      : "Reply with a number, or send item name with quantity to order.",
  ].join("\n");
}
