// Builds the data bundle into an output directory.
//
//   node scripts/build-bundle.ts <data dir> <out dir> [--release] [--now ISO-8601]
//
// Writes <out>/manifest.json, <out>/chains/*.json.deflate and <out>/meal-deals/*.json.deflate.
// Runs the data rules first and stops on any error.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildBundle } from "../src/bundle.ts";
import { loadDataSet } from "../src/load.ts";
import { validate } from "../src/rules.ts";

const args = process.argv.slice(2);
const positional = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--now");
const [root = "data", out = "build/data/v1"] = positional;
const release = args.includes("--release");
const nowIndex = args.indexOf("--now");
const now = nowIndex >= 0 ? new Date(args[nowIndex + 1]) : new Date();

const data = loadDataSet(root);
const errors = validate(data, { release, today: now.toISOString().slice(0, 10) }).filter((issue) => issue.level === "error");
if (errors.length > 0) {
  for (const issue of errors) console.error(`ERROR  ${issue.file}  ${issue.where}: ${issue.message}`);
  console.error(`Not built: ${errors.length} errors. Run scripts/validate.ts for details.`);
  process.exit(1);
}

const bundle = buildBundle(data, { release, now });
for (const built of bundle.files) {
  const path = join(out, built.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, built.compressed);
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "manifest.json"), JSON.stringify(bundle.manifest, null, 2) + "\n");

for (const line of bundle.excluded) console.log(`left out  ${line}`);
const total = bundle.files.reduce((sum, f) => sum + f.entry.bytes, 0);
console.log(`Built ${bundle.files.length} files, ${total} bytes compressed, version ${bundle.manifest.version}${release ? " (release)" : ""}.`);
