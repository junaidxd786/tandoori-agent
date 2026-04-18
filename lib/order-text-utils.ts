const MENU_TOKEN_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "please",
  "pls",
  "with",
  "without",
  "and",
  "or",
  "my",
  "for",
  "item",
  "items",
  "dish",
  "food",
  "menu",
  "order",
  "add",
  "remove",
  "qty",
  "quantity",
]);

export function normalizeText(value: string): string {
  const withAliasExpansion = value
    .toLowerCase()
    .replace(/\bice[\s-]?cream\b/g, "ice cream");
  return withAliasExpansion
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCompact(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

export function tokenizeForMenuMatching(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !MENU_TOKEN_STOP_WORDS.has(token));
}

export function tokenOverlapScore(left: string, right: string): number {
  const leftTokens = tokenizeForMenuMatching(left);
  const rightTokens = tokenizeForMenuMatching(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    const hasExact = rightTokens.includes(token);
    const hasNear = rightTokens.some((candidate) => {
      const minLength = Math.min(token.length, candidate.length);
      if (minLength < 4) return false;
      return token.includes(candidate) || candidate.includes(token);
    });
    if (hasExact || hasNear) overlap += 1;
  }

  return overlap / Math.max(leftTokens.length, rightTokens.length);
}

export function itemSimilarityScore(left: string, right: string): number {
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.85;

  const leftCompact = normalizeCompact(left);
  const rightCompact = normalizeCompact(right);
  if (leftCompact && rightCompact) {
    if (leftCompact === rightCompact && leftCompact.length >= 4) return 0.92;
    const minCompactLength = Math.min(leftCompact.length, rightCompact.length);
    if (minCompactLength >= 5 && (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact))) {
      return 0.74;
    }
  }

  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = union > 0 ? intersection / union : 0;
  const compactBonus = normalizeCompact(left) === normalizeCompact(right) ? 0.2 : 0;
  return Math.min(1, jaccard + compactBonus);
}
