// Writes test/golden/ranking.json: the expected output of every ranking scenario.
//
//   node scripts/golden.ts            write the file
//   node scripts/golden.ts --check    exit 1 if the file is out of date
//
// Regenerate only when the formula or the example data changes on purpose, and say why in
// DECISIONS.md. The Swift RankingEngine tests load this file and must match it.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { goldenText } from "../test/golden-document.ts";

const target = join(import.meta.dirname, "..", "test", "golden", "ranking.json");
const text = goldenText();

if (process.argv.includes("--check")) {
  const current = readFileSync(target, "utf8");
  if (current !== text) {
    console.error("test/golden/ranking.json is out of date. Run: node scripts/golden.ts");
    process.exit(1);
  }
  console.log("Golden vectors are up to date.");
} else {
  writeFileSync(target, text);
  console.log(`Wrote ${target}`);
}
