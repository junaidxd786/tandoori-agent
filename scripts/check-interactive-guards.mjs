import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const orderEnginePath = path.join(root, "lib", "order-engine.ts");
const branchesPath = path.join(root, "lib", "branches.ts");

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

if (!fs.existsSync(orderEnginePath)) {
  fail(`Missing file: ${orderEnginePath}`);
  process.exit();
}

if (!fs.existsSync(branchesPath)) {
  fail(`Missing file: ${branchesPath}`);
  process.exit();
}

const orderEngine = fs.readFileSync(orderEnginePath, "utf8");
const branches = fs.readFileSync(branchesPath, "utf8");

const staleUuidGuard =
  "if (isUuidLike(rawText.trim()) && (!state.last_presented_options || state.last_presented_options.length === 0)) {";
const uuidHelper = "function isUuidLike(value: string): boolean {";
const controlPayloadGuardFragment = "city[_\\s-]?option";
const branchUuidComment = "Guard against UUID-like payloads from other interactive lists";
const strictBranchNumberMatch = "const numberMatch = normalized.match(/^(?:branch|option|number)?\\s*(\\d{1,2})$/);";
const urduQuestionRegex = "if (/[?\\u061F]/.test(rawText)) return true;";

mustInclude(orderEngine, staleUuidGuard, "Missing stale UUID guard in order engine.");
mustInclude(orderEngine, uuidHelper, "Missing UUID helper in order engine.");
mustInclude(orderEngine, controlPayloadGuardFragment, "Missing control payload guard for city/branch/category options.");
mustInclude(orderEngine, urduQuestionRegex, "Missing Urdu/English question regex guard.");

if (orderEngine.includes("ØŸ")) {
  fail("Detected mojibake token 'ØŸ' in order engine.");
} else {
  pass("No mojibake token found in order engine.");
}

mustInclude(branches, branchUuidComment, "Missing UUID guard comment/context in branch parser.");
mustInclude(branches, strictBranchNumberMatch, "Missing strict branch number parser regex.");

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
