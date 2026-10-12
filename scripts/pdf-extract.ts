// The PDF helper: turns a chain's official nutrition PDF into a draft chain file for review.
//
//   node scripts/pdf-extract.ts <pdf> <chain-id> --name "Chain name" --source-url <PDF URL>
//        [--allergen-url <URL>] [--type restaurant|cafe|pub|bakery|supermarket]
//        [--regions GB-ENG,GB-SCT,GB-WLS,GB-NIR] [--out data/chains/<chain-id>.json]
//        [--today YYYY-MM-DD] [--force]
//
// Needs poppler's pdftotext (brew install poppler, or apt install poppler-utils).
//
// Every item comes out as a draft, with the PDF as its source. Check each figure against the
// PDF, add diet tags and availability, and change the item to "verified". Release bundles
// leave drafts out, so nothing reaches the app until a person has checked it. An existing file
// is never overwritten without --force, so a reviewed file can't be lost to a re-run.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { draftChain, extract, parseBboxLayout } from "../src/pdf.ts";
import { validate } from "../src/rules.ts";
import type { ChainType, Region } from "../src/types.ts";

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}
const positional = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
const [pdf, chainID] = positional;
const name = option("name");
const sourceUrl = option("source-url");
if (!pdf || !chainID || !name || !sourceUrl) {
  console.error('Usage: node scripts/pdf-extract.ts <pdf> <chain-id> --name "Chain name" --source-url <PDF URL> [options]');
  process.exit(2);
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(chainID)) {
  console.error(`The chain id "${chainID}" must be a lower-case slug, such as "greggs" or "pret-a-manger".`);
  process.exit(2);
}
const today = option("today") ?? new Date().toISOString().slice(0, 10);
const out = option("out") ?? `data/chains/${chainID}.json`;
const type = (option("type") ?? "restaurant") as ChainType;
const regions = (option("regions") ?? "GB-ENG,GB-SCT,GB-WLS,GB-NIR").split(",") as Region[];

if (existsSync(out) && !args.includes("--force")) {
  console.error(`${out} already exists. Re-run with --force to replace it, but check you're not discarding reviewed figures.`);
  process.exit(1);
}

let xhtml: string;
try {
  xhtml = execFileSync("pdftotext", ["-bbox-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
} catch (error) {
  console.error(`pdftotext couldn't read ${pdf}. Is poppler installed? ${(error as Error).message}`);
  process.exit(1);
}

const extraction = extract(parseBboxLayout(xhtml));
if (extraction.rows.length === 0) {
  console.error("No nutrition table found: no header row naming protein and at least two of energy, fat and carbohydrate.");
  process.exit(1);
}
const { chain, review } = draftChain(extraction, {
  chainID,
  name,
  type,
  sourceUrl,
  allergenInfoUrl: option("allergen-url") ?? sourceUrl,
  regions,
  today,
  pdfName: basename(pdf),
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(chain, null, 2)}\n`);
console.log(`Wrote ${out}: ${chain.items.length} draft items from ${basename(pdf)}.`);

console.log("\nFor review:");
for (const line of review) console.log(`  ${line}`);

const issues = validate({ chains: [{ file: out, value: chain }], mealDeals: [] }, { release: false, today });
if (issues.length > 0) {
  console.log("\nThe data rules found:");
  for (const issue of issues) console.log(`  ${issue.level.toUpperCase()}  ${issue.where}: ${issue.message}`);
}
console.log("\nNext: check every figure against the PDF, then run npm run validate-data.");
