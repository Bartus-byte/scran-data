import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { buildBundle, canonicalJson, sha256, versionNumber } from "../src/bundle.ts";
import { loadDataSet } from "../src/load.ts";
import type { DataSet, Manifest } from "../src/types.ts";

const root = join(import.meta.dirname, "..", "examples");
const examples = loadDataSet(root);
const now = new Date("2026-10-11T12:00:00Z");

test("every file round-trips through raw DEFLATE with a matching hash", () => {
  const bundle = buildBundle(examples, { release: false, now });
  assert.equal(bundle.files.length, 4);
  for (const file of bundle.files) {
    const json = inflateRawSync(file.compressed).toString("utf8");
    assert.equal(sha256(json), file.entry.sha256);
    assert.equal(Buffer.byteLength(json), file.entry.contentBytes);
    assert.equal(file.compressed.length, file.entry.bytes);
    assert.ok(!json.includes("$schema"));
  }
});

test("the committed example bundle is current", () => {
  const committed = JSON.parse(readFileSync(join(root, "bundle", "manifest.json"), "utf8")) as Manifest;
  const built = buildBundle(examples, { release: false, now }).manifest;
  assert.deepEqual(committed, built, "run: npm run example-bundle");
  for (const file of committed.files) {
    const json = inflateRawSync(readFileSync(join(root, "bundle", file.path))).toString("utf8");
    assert.equal(sha256(json), file.sha256, file.path);
  }
});

test("the version is the publish time in UTC", () => {
  assert.equal(versionNumber(now), 202610111200);
});

test("unchanged content keeps its hash", () => {
  const first = buildBundle(examples, { release: false, now });
  const later = buildBundle(examples, { release: false, now: new Date("2026-10-12T08:30:00Z") });
  assert.deepEqual(first.manifest.files.map((f) => f.sha256), later.manifest.files.map((f) => f.sha256));
  assert.notEqual(first.manifest.version, later.manifest.version);
});

test("a release bundle leaves out drafts and prunes references to them", () => {
  // Pretend the examples were real so the release path can run.
  const real: DataSet = structuredClone(examples);
  for (const { value } of real.chains) value.isPlaceholder = false;
  for (const { value } of real.mealDeals) value.isPlaceholder = false;
  const bakery = real.chains.find((c) => c.value.id === "bakehouse-and-co")?.value;
  assert.ok(bakery);
  const bundle = buildBundle(real, { release: true, now });
  assert.ok(bundle.excluded.some((line) => line.includes("pumpkin-spice-latte")));
  const file = bundle.files.find((f) => f.entry.id === "bakehouse-and-co");
  assert.ok(file);
  const published = JSON.parse(inflateRawSync(file.compressed).toString("utf8"));
  assert.ok(!published.items.some((i: { id: string }) => i.id === "pumpkin-spice-latte"));
  assert.equal(bundle.manifest.isRelease, true);
});

test("canonical JSON has no whitespace and keeps key order", () => {
  const chain = examples.chains[0].value;
  const json = canonicalJson(chain);
  assert.ok(!json.includes("\n"));
  assert.ok(json.startsWith('{"schemaVersion":1,"id":'));
});
