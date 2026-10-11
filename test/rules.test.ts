import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { alcoholGrams, checkEnergy } from "../src/energy.ts";
import { loadDataSet } from "../src/load.ts";
import { hasValidCheckDigit, validate, type Issue } from "../src/rules.ts";
import type { Chain, DataSet, Item, MealDeal } from "../src/types.ts";

const examples = loadDataSet(join(import.meta.dirname, "..", "examples"));
const options = { release: false, today: "2026-10-11" };

/** A deep copy of the examples with one change applied. */
function variant(change: (data: DataSet) => void): DataSet {
  const copy: DataSet = structuredClone(examples);
  change(copy);
  return copy;
}

function chain(data: DataSet, id: string): Chain {
  const found = data.chains.find((c) => c.value.id === id);
  assert.ok(found, id);
  return found.value;
}

function item(data: DataSet, chainId: string, itemId: string): Item {
  const found = chain(data, chainId).items.find((i) => i.id === itemId);
  assert.ok(found, itemId);
  return found;
}

function errors(issues: Issue[]): string[] {
  return issues.filter((issue) => issue.level === "error").map((issue) => `${issue.where}: ${issue.message}`);
}

test("the examples pass", () => {
  assert.deepEqual(errors(validate(examples, options)), []);
});

test("release rules refuse placeholder data", () => {
  const found = errors(validate(examples, { ...options, release: true }));
  assert.ok(found.some((message) => message.includes("placeholder")));
});

test("the energy check uses the UK factors including fibre and alcohol", () => {
  const lager = item(examples, "the-red-lion", "lager-pint");
  assert.equal(checkEnergy(lager).kind, "pass");
  // Without the alcohol term the pint would be ~125 kcal short.
  assert.equal(checkEnergy({ ...lager, alcoholG: 0 }).kind, "error");
  assert.ok(Math.abs(alcoholGrams(568, 4) - 17.926) < 0.001);
});

test("a mistyped fat figure fails the energy check", () => {
  const data = variant((d) => {
    item(d, "the-red-lion", "fish-and-chips").fatG = 4.5;
  });
  assert.ok(errors(validate(data, options)).some((message) => message.includes("fish-and-chips") && message.includes("macros give")));
});

test("rounding differences inside the tolerance pass", () => {
  const roll = item(examples, "bakehouse-and-co", "sausage-roll");
  assert.equal(checkEnergy({ ...roll, kcal: roll.kcal + 12 }).kind, "pass");
  assert.equal(checkEnergy({ ...roll, kcal: roll.kcal + 25 }).kind, "warning");
  assert.equal(checkEnergy({ ...roll, kcal: roll.kcal + 60 }).kind, "error");
});

test("unpublished macros skip the energy check", () => {
  assert.equal(checkEnergy(item(examples, "the-red-lion", "house-cocktail")).kind, "skipped");
});

test("vegan implies vegetarian and dairy-free", () => {
  const data = variant((d) => {
    item(d, "the-red-lion", "veggie-chilli").dietTags = ["vegan"];
  });
  const found = errors(validate(data, options));
  assert.ok(found.some((message) => message.includes("vegetarian")));
  assert.ok(found.some((message) => message.includes("dairy-free")));
});

test("alcohol must match volume × ABV × 0.789", () => {
  const data = variant((d) => {
    item(d, "the-red-lion", "lager-pint").alcoholG = 10;
  });
  assert.ok(errors(validate(data, options)).some((message) => message.includes("alcoholG should be 17.9")));
});

test("duplicate ids are caught", () => {
  const data = variant((d) => {
    const c = chain(d, "bakehouse-and-co");
    c.items.push({ ...c.items[0] });
  });
  assert.ok(errors(validate(data, options)).some((message) => message.includes("duplicate item id")));
});

test("GTIN check digits are verified", () => {
  assert.ok(hasValidCheckDigit("5000159407236"));
  assert.ok(!hasValidCheckDigit("5000159407237"));
  const data = variant((d) => {
    const first = chain(d, "corner-express").items[0];
    const gtin = (first.gtins ?? [])[0];
    first.gtins = [gtin.slice(0, -1) + String((Number(gtin.at(-1)) + 1) % 10)];
  });
  assert.ok(errors(validate(data, options)).some((message) => message.includes("check digit")));
});

test("swap deltas derived from two items must equal their difference", () => {
  const data = variant((d) => {
    const swap = (chain(d, "the-red-lion").swaps ?? [])[0];
    swap.delta.kcal = -300;
  });
  assert.ok(errors(validate(data, options)).some((message) => message.includes("delta.kcal should be -405")));
});

test("a swap can't take a figure below zero", () => {
  const data = variant((d) => {
    const swap = (chain(d, "bakehouse-and-co").swaps ?? []).find((s) => s.id === "skimmed-milk");
    assert.ok(swap);
    swap.delta.fatG = -50;
  });
  assert.ok(errors(validate(data, options)).some((message) => message.includes("below zero")));
});

test("meal deals must refer to items in a supermarket's file", () => {
  const data = variant((d) => {
    const deal = d.mealDeals[0].value as MealDeal;
    deal.slots.main.items.push("no-such-item");
  });
  assert.ok(errors(validate(data, options)).some((message) => message.includes("unknown item")));
});

test("dates in the future are refused", () => {
  const data = variant((d) => {
    item(d, "bakehouse-and-co", "latte").lastChecked = "2027-01-01";
  });
  assert.ok(errors(validate(data, options)).some((message) => message.includes("in the future")));
});
