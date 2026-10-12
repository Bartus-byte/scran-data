// Builds the static website published with the data bundle.
//
//   node scripts/build-site.ts <data dir> <out dir> [--now ISO-8601]
//
// Writes index.html, robots.txt and sitemap.xml into <out dir>. Only verified, non-placeholder
// data is shown (see src/site.ts).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadDataSet } from "../src/load.ts";
import { publishableChains, renderSite } from "../src/site.ts";

const args = process.argv.slice(2);
const nowIndex = args.indexOf("--now");
const now = nowIndex >= 0 ? new Date(args[nowIndex + 1] ?? "") : new Date();
if (Number.isNaN(now.getTime())) {
  console.error("--now needs an ISO 8601 date, such as 2026-10-12T09:00:00Z");
  process.exit(1);
}
const positional = args.filter((arg, index) => !arg.startsWith("--") && !(nowIndex >= 0 && index === nowIndex + 1));
const [root = "data", out = "public"] = positional;

const data = loadDataSet(root);
const style = readFileSync(join(import.meta.dirname, "..", "site", "style.css"), "utf8");

for (const file of renderSite(data, { now, style })) {
  const path = join(out, file.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.contents);
}
console.log(`Built the website in ${out}: ${publishableChains(data).length} chains listed.`);
