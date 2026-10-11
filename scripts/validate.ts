// Runs the data rules over a data directory.
//
//   node scripts/validate.ts <data dir> [--release] [--today YYYY-MM-DD]
//
// Exits 1 on any error. Warnings are printed for review and don't fail.
// The JSON Schema check runs separately (scripts/validate-schema.ts) and runs first in CI.

import { loadDataSet } from "../src/load.ts";
import { validate } from "../src/rules.ts";

const args = process.argv.slice(2);
const root = args.find((arg) => !arg.startsWith("--")) ?? "data";
const release = args.includes("--release");
const todayIndex = args.indexOf("--today");
const today = todayIndex >= 0 ? args[todayIndex + 1] : new Date().toISOString().slice(0, 10);

const data = loadDataSet(root);
const issues = validate(data, { release, today });
for (const issue of issues) {
  console.log(`${issue.level.toUpperCase()}  ${issue.file}  ${issue.where}: ${issue.message}`);
}
const errors = issues.filter((issue) => issue.level === "error").length;
const warnings = issues.length - errors;
const items = data.chains.reduce((sum, chain) => sum + chain.value.items.length, 0);
console.log(
  `${data.chains.length} chains, ${items} items, ${data.mealDeals.length} meal deals: ${errors} errors, ${warnings} warnings${release ? " (release rules)" : ""}`,
);
process.exit(errors > 0 ? 1 : 0);
