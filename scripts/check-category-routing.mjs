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

if (!fs.existsSync(target)) {
  fail(`Missing target file: ${target}`);
  process.exit();
}

const source = fs.readFileSync(target, "utf8");

const guardOption = "if (/^category\\s+option\\s+\\d{1,2}$/.test(text)) return false;";
const guardMore = "if (/^category\\s+more\\s+\\d{1,2}$/.test(text)) return false;";
const genericMatcher =
  "return /(menu|show.*menu|what.*have|list.*items?|kya.*hai|dikhao|category|categories|price|rates?)/.test(text);";

const optionIndex = source.indexOf(guardOption);
const moreIndex = source.indexOf(guardMore);
const genericIndex = source.indexOf(genericMatcher);

if (optionIndex === -1) {
  fail("Missing guard for category_option_* interactive commands.");
} else {
  pass("Found category_option_* guard.");
}

if (moreIndex === -1) {
  fail("Missing guard for category_more_* interactive commands.");
} else {
  pass("Found category_more_* guard.");
}

if (genericIndex === -1) {
  fail("Missing generic menu request matcher.");
} else {
  pass("Found generic menu matcher.");
}

if (optionIndex !== -1 && genericIndex !== -1 && optionIndex > genericIndex) {
  fail("category_option_* guard appears after generic matcher and will not work.");
} else if (optionIndex !== -1 && genericIndex !== -1) {
  pass("category_option_* guard is ordered before generic matcher.");
}

if (moreIndex !== -1 && genericIndex !== -1 && moreIndex > genericIndex) {
  fail("category_more_* guard appears after generic matcher and will not work.");
} else if (moreIndex !== -1 && genericIndex !== -1) {
  pass("category_more_* guard is ordered before generic matcher.");
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
