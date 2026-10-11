// Checks every data file against the JSON Schemas (draft 2020-12).
//
//   node scripts/validate-schema.ts <data dir> [manifest.json ...]
//
// Uses ajv and ajv-formats, development-only dependencies approved on 11 October 2026.
// Run `npm ci` first.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { loadDataSet } from "../src/load.ts";

const require = createRequire(import.meta.url);
let Ajv2020: any;
let addFormats: any;
try {
  Ajv2020 = require("ajv/dist/2020").default;
  addFormats = require("ajv-formats").default;
} catch {
  console.error("ajv and ajv-formats aren't installed. Run npm ci first.");
  process.exit(2);
}

const schemaDir = join(import.meta.dirname, "..", "schema");
const load = (name: string) => JSON.parse(readFileSync(join(schemaDir, name), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
for (const name of ["common.schema.json", "chain.schema.json", "meal-deal.schema.json", "manifest.schema.json"]) {
  ajv.addSchema(load(name), name);
}

const args = process.argv.slice(2);
const [root = "data", ...manifests] = args;
const data = loadDataSet(root);
let failures = 0;
const check = (schema: string, file: string, value: unknown) => {
  const validator = ajv.getSchema(schema);
  if (!validator(value)) {
    failures += 1;
    for (const error of validator.errors ?? []) {
      console.log(`ERROR  ${file}  ${error.instancePath || "/"}: ${error.message}`);
    }
  }
};
for (const { file, value } of data.chains) check("chain.schema.json", file, value);
for (const { file, value } of data.mealDeals) check("meal-deal.schema.json", file, value);
for (const file of manifests) check("manifest.schema.json", file, JSON.parse(readFileSync(file, "utf8")));

const total = data.chains.length + data.mealDeals.length + manifests.length;
console.log(`${total} files checked against the schemas: ${failures} failed.`);
process.exit(failures > 0 ? 1 : 0);
