function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function normalizeText(value) {
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

function isLikelyRemovalOrEditMessage(rawText) {
  const normalized = normalizeText(rawText);
  if (!normalized) return false;
  return (
    /(remove|delete|without|minus|cancel|kam kar|kam kr|nikaal|nikal)/.test(normalized) ||
    /(qty|quantity|set|update|change|modify|replace|instead)/.test(normalized)
  );
}

function blocksExplicitYes(text) {
  return /\b(add|remove|delete|without|minus|qty|quantity|change|modify|update|replace|aur|bhi|plus|kam kar|kam kr|kar do|kr do)\b/.test(
    text,
  );
}

function parseOrderTypeShortcutWouldBlock(normalizedText) {
  return /\b(price|fee|charges?|cost|kitna|kitne|kya|how much)\b/.test(normalizedText);
}

const scenarios = [
  {
    phrase: "icecream bhi add kr do",
    expect: {
      normalizedIncludes: "ice cream",
      shouldBlockExplicitYes: true,
      shouldClassifyEditRemove: false,
      shouldBlockOrderTypeShortcut: false,
    },
  },
  {
    phrase: "cold coffee icecream remove krdo",
    expect: {
      normalizedIncludes: "ice cream",
      shouldBlockExplicitYes: true,
      shouldClassifyEditRemove: true,
      shouldBlockOrderTypeShortcut: false,
    },
  },
  {
    phrase: "delivery charges kitne hain?",
    expect: {
      normalizedIncludes: "delivery charges kitne hain",
      shouldBlockExplicitYes: false,
      shouldClassifyEditRemove: false,
      shouldBlockOrderTypeShortcut: true,
    },
  },
  {
    phrase: "yes confirm",
    expect: {
      normalizedIncludes: "yes confirm",
      shouldBlockExplicitYes: false,
      shouldClassifyEditRemove: false,
      shouldBlockOrderTypeShortcut: false,
    },
  },
  {
    phrase: "aik half chicken karahi",
    expect: {
      normalizedIncludes: "half chicken karahi",
      shouldBlockExplicitYes: false,
      shouldClassifyEditRemove: false,
      shouldBlockOrderTypeShortcut: false,
    },
  },
];

for (const scenario of scenarios) {
  const normalized = normalizeText(scenario.phrase);
  const explicitYesBlocked = blocksExplicitYes(normalized);
  const editRemove = isLikelyRemovalOrEditMessage(scenario.phrase);
  const orderTypeBlocked = parseOrderTypeShortcutWouldBlock(normalized);

  if (!normalized.includes(scenario.expect.normalizedIncludes)) {
    fail(`Normalization mismatch for "${scenario.phrase}" -> "${normalized}"`);
  } else {
    pass(`Normalization OK for "${scenario.phrase}"`);
  }

  if (explicitYesBlocked !== scenario.expect.shouldBlockExplicitYes) {
    fail(
      `Explicit-yes guard mismatch for "${scenario.phrase}" (expected ${scenario.expect.shouldBlockExplicitYes}, got ${explicitYesBlocked})`,
    );
  } else {
    pass(`Explicit-yes guard OK for "${scenario.phrase}"`);
  }

  if (editRemove !== scenario.expect.shouldClassifyEditRemove) {
    fail(
      `Edit/remove classifier mismatch for "${scenario.phrase}" (expected ${scenario.expect.shouldClassifyEditRemove}, got ${editRemove})`,
    );
  } else {
    pass(`Edit/remove classifier OK for "${scenario.phrase}"`);
  }

  if (orderTypeBlocked !== scenario.expect.shouldBlockOrderTypeShortcut) {
    fail(
      `Order-type shortcut guard mismatch for "${scenario.phrase}" (expected ${scenario.expect.shouldBlockOrderTypeShortcut}, got ${orderTypeBlocked})`,
    );
  } else {
    pass(`Order-type shortcut guard OK for "${scenario.phrase}"`);
  }
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

