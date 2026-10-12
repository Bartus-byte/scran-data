import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadDataSet } from "../src/load.ts";
import { escapeHtml, publishableChains, renderSite } from "../src/site.ts";
import type { DataSet } from "../src/types.ts";

const examples = loadDataSet(join(import.meta.dirname, "..", "examples"));
const style = readFileSync(join(import.meta.dirname, "..", "site", "style.css"), "utf8");
const now = new Date("2026-10-12T09:00:00Z");

function page(data: DataSet): string {
  const home = renderSite(data, { now, style }).find((file) => file.path === "index.html");
  assert.ok(home);
  return home.contents;
}

test("placeholder data never reaches the website", () => {
  assert.equal(publishableChains(examples).length, 0);
  const html = page(examples);
  assert.match(html, /No chains are published yet/);
  for (const { value } of examples.chains) assert.ok(!html.includes(value.name), value.name);
});

test("only verified items are counted", () => {
  const real: DataSet = structuredClone(examples);
  for (const { value } of real.chains) value.isPlaceholder = false;
  for (const { value } of real.chains) for (const item of value.items) item.isPlaceholder = false;
  const bakery = real.chains.find((c) => c.value.id === "bakehouse-and-co")?.value;
  assert.ok(bakery);
  const verified = bakery.items.filter((item) => item.reviewStatus === "verified").length;
  assert.ok(verified < bakery.items.length, "the example bakery should include a draft");
  const listed = publishableChains(real).find((chain) => chain.id === "bakehouse-and-co");
  assert.equal(listed?.items.length, verified);
  assert.match(page(real), new RegExp(`${verified} items`));
});

test("names are escaped", () => {
  assert.equal(escapeHtml(`Fish & "Chips" <b>'s`), "Fish &amp; &quot;Chips&quot; &lt;b&gt;&#39;s");
  const real: DataSet = structuredClone(examples);
  const chain = real.chains[0]?.value;
  assert.ok(chain);
  chain.isPlaceholder = false;
  for (const item of chain.items) item.isPlaceholder = false;
  chain.name = "Bread & <Butter>";
  const html = page(real);
  assert.ok(html.includes("Bread &amp; &lt;Butter&gt;"));
  assert.ok(!html.includes("<Butter>"));
});

test("robots.txt points at the sitemap", () => {
  const files = renderSite(examples, { now, style });
  assert.deepEqual(files.map((file) => file.path).sort(), ["index.html", "robots.txt", "sitemap.xml"]);
  assert.match(files.find((file) => file.path === "robots.txt")?.contents ?? "", /Sitemap: https:\/\/bartus-byte\.github\.io\/scran-data\/sitemap\.xml/);
  assert.match(files.find((file) => file.path === "sitemap.xml")?.contents ?? "", /<lastmod>2026-10-12<\/lastmod>/);
});
