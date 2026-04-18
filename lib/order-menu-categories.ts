type CategoryCapableMenuItem = {
  category: string | null;
};

export type CategoryListInteractivePayload = {
  body: string;
  buttonText: string;
  sectionTitle?: string;
  rows: Array<{ id: string; title: string; description?: string }>;
};

export function getMenuCategories(menuItems: CategoryCapableMenuItem[]): string[] {
  return [...new Set(menuItems.map((item) => item.category?.trim() || "General"))];
}

export function parseCategoryMorePage(text: string): number | null {
  const raw = text.trim();
  const moreMatch = raw.match(/^category[_\s-]?more[_\s-]?(\d+)$/i);
  if (!moreMatch) return null;

  const page = Number.parseInt(moreMatch[1], 10);
  if (!Number.isFinite(page) || page < 1) return null;
  return page;
}

export function buildCategoryListReply(
  menuItems: CategoryCapableMenuItem[],
  romanUrdu: boolean,
  page = 1,
): {
  text: string;
  interactiveList?: CategoryListInteractivePayload | null;
} {
  const categories = getMenuCategories(menuItems);
  if (categories.length === 0) {
    return {
      text: romanUrdu
        ? "Is branch ka menu filhal available nahi lag raha. *menu* dobara try karein ya branch confirm kar dein."
        : "I could not find a live menu for this branch right now. Please try *menu* again or confirm your branch.",
    };
  }

  const pageSize = 9;
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  const visibleCategories = categories.slice(start, start + pageSize);
  if (visibleCategories.length === 0) {
    return buildCategoryListReply(menuItems, romanUrdu, 1);
  }
  const hasMore = start + pageSize < categories.length;

  const text = [
    "Available categories:",
    ...visibleCategories.map((category, index) => `${start + index + 1}. ${category}`),
    ...(hasMore
      ? [
          romanUrdu
            ? "...mazeed categories ke liye *more* bhej dein."
            : "...for more categories, send *more*.",
        ]
      : []),
    romanUrdu
      ? "Category ka *number* ya *name* bhej dein."
      : "Reply with category *number* or *name*.",
  ].join("\n");

  let interactiveList: CategoryListInteractivePayload | null = null;

  if (visibleCategories.length >= 1) {
    const rows = visibleCategories.map((category, index) => {
      const absoluteIndex = start + index + 1;
      const truncatedTitle = category.length > 24 ? category.slice(0, 21) + "..." : category;
      return {
        id: `category_option_${absoluteIndex}`,
        title: truncatedTitle,
        description: undefined,
      };
    });
    if (hasMore) {
      rows.push({
        id: `category_more_${safePage + 1}`,
        title: romanUrdu ? "More Categories" : "More Categories",
        description: undefined,
      });
    }

    interactiveList = {
      body: romanUrdu
        ? "Menu categories se ek select karein."
        : "Choose a category from the menu.",
      buttonText: romanUrdu ? "Select Category" : "Select Category",
      sectionTitle: romanUrdu ? "Categories" : "Categories",
      rows,
    };
  }

  return { text, interactiveList };
}
