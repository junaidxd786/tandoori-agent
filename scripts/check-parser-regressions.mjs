import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const target = path.join(root, "lib", "order-engine.ts");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function mustInclude(source, token, message) {
  if (!source.includes(token)) {
    fail(message);
    return false;
  }
  pass(message.replace("Missing", "Found"));
  return true;
}

if (!fs.existsSync(target)) {
  fail(`Missing target file: ${target}`);
  process.exit();
}

const source = fs.readFileSync(target, "utf8");

// 1) Ice-cream alias normalization should stay in place.
mustInclude(
  source,
  ".replace(/\\bice[\\s-]?cream\\b/g, \"ice cream\")",
  "Missing ice-cream alias normalization.",
);

// 2) Confirmation parser should reject modify/remove style phrases.
mustInclude(
  source,
  "if (\n    /\\b(add|remove|delete|without|minus|qty|quantity|change|modify|update|replace|aur|bhi|plus|kam kar|kam kr|kar do|kr do)\\b/.test(",
  "Missing modify/remove guard in explicit-yes parser.",
);

// 3) Inline add extraction must be skipped for remove/edit messages.
mustInclude(
  source,
  "const shouldSkipInlineAddExtraction = isLikelyRemovalOrEditMessage(rawText);",
  "Missing skip-inline-add guard for remove/edit messages.",
);
mustInclude(
  source,
  "function isLikelyRemovalOrEditMessage(rawText: string): boolean {",
  "Missing remove/edit classifier helper.",
);

// 4) Delivery shortcut must not trigger on charge/price questions.
mustInclude(
  source,
  "if (/\\b(price|fee|charges?|cost|kitna|kitne|kya|how much)\\b/.test(normalizedText)) {",
  "Missing order-type shortcut guard for price/charges questions.",
);

// 5) Inline item extraction should be conservative single-best match (avoid mass adds).
mustInclude(
  source,
  "if (best.score < 0.74) return [];",
  "Missing conservative threshold in inline item extraction.",
);
mustInclude(
  source,
  "if (broadQuery && best.score < 0.9) return [];",
  "Missing broad-query protection for inline item extraction.",
);
mustInclude(
  source,
  "return [\n    {\n      name: best.item.name,",
  "Missing single-best-match return shape for inline item extraction.",
);

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

