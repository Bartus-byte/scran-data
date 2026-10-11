import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_SHARES,
  STANDARD_CONFIG,
  mealBudget,
  rankChain,
  resolveSlots,
  sizeFit,
  sortMenu,
  type MealBudget,
} from "../src/ranking.ts";
import type { Chain } from "../src/types.ts";
import { goldenText } from "./golden-document.ts";
import { chainCases, chains, mealDealCases, runChainCase, runMealDealCase } from "./scenarios.ts";

const golden = join(import.meta.dirname, "golden", "ranking.json");

test("golden vectors match the current formula", () => {
  assert.equal(readFileSync(golden, "utf8"), goldenText(), "run: node scripts/golden.ts");
});

test("the meal budget follows the documented formula", () => {
  // 2,250 − 520 eaten − 820 planned = 910 available; lunch gets 0.35 ÷ (0.35 + 0.05).
  const budget = mealBudget({
    targetKcal: 2250,
    targetProteinG: 150,
    eatenKcal: 520,
    eatenProteinG: 38,
    reservedKcal: 820,
    reservedProteinG: 45,
    shares: DEFAULT_SHARES,
    current: "lunch",
    open: ["lunch", "snack"],
  });
  assert.ok(Math.abs(budget.kcal - 796.25) < 1e-9);
  assert.ok(Math.abs(budget.proteinG - 58.625) < 1e-9);
  assert.equal(budget.idealKcal, budget.kcal);
});

test("eating past the target leaves a zero budget, never negative", () => {
  const budget = mealBudget({
    targetKcal: 2000,
    targetProteinG: 120,
    eatenKcal: 2300,
    eatenProteinG: 130,
    reservedKcal: 500,
    reservedProteinG: 30,
    shares: DEFAULT_SHARES,
    current: "dinner",
    open: ["dinner", "snack"],
  });
  assert.equal(budget.kcal, 0);
  assert.equal(budget.proteinG, 0);
});

test("a planned meal removes its slot and a logged meal closes its slot", () => {
  const slots = resolveSlots({ minuteOfDay: 12 * 60, doneSlots: ["breakfast"], plannedSlots: ["dinner"] });
  assert.deepEqual(slots, { current: "lunch", open: ["lunch", "snack"], serving: "lunch" });
  const after = resolveSlots({ minuteOfDay: 13 * 60, doneSlots: ["breakfast", "lunch"], plannedSlots: [] });
  assert.equal(after.current, "snack");
});

test("size fit has full credit from 60% of the ideal and falls past it", () => {
  assert.equal(sizeFit(600, 1000, STANDARD_CONFIG), 1);
  assert.equal(sizeFit(300, 1000, STANDARD_CONFIG), 0.5);
  assert.equal(sizeFit(1500, 1000, STANDARD_CONFIG), 0.5);
  assert.equal(sizeFit(100, 0, STANDARD_CONFIG), 0);
});

test("results have distinct mains and fit the budget", () => {
  for (const c of chainCases) {
    const result = runChainCase(c);
    const groups = result.orders.map((order) => order.group);
    assert.equal(new Set(groups).size, groups.length, c.name);
    assert.ok(result.orders.length <= STANDARD_CONFIG.resultsPerChain, c.name);
    for (const order of result.orders) {
      if (order.fits) assert.ok(order.kcal <= c.budget.kcal, c.name);
      else assert.ok(order.overByKcal > 0, c.name);
    }
  }
});

test("fitting orders always come before over-budget ones", () => {
  for (const c of [...chainCases.map(runChainCase), ...mealDealCases.map(runMealDealCase)]) {
    const firstOver = c.orders.findIndex((order) => !order.fits);
    if (firstOver >= 0) assert.ok(c.orders.slice(firstOver).every((order) => !order.fits));
  }
});

test("diet filters apply to every item in an order", () => {
  for (const c of chainCases.filter((c) => c.dietTags.length > 0)) {
    const chain = chains.get(c.chain) as Chain;
    for (const order of runChainCase(c).orders) {
      for (const id of order.itemIds) {
        const item = chain.items.find((i) => i.id === id);
        assert.ok(item && c.dietTags.every((tag) => item.dietTags.includes(tag)), `${c.name}: ${id}`);
      }
    }
  }
});

test("breakfast-only items appear only at breakfast", () => {
  for (const c of chainCases) {
    const ids = runChainCase(c).orders.flatMap((order) => order.itemIds);
    if (c.serving !== "breakfast") assert.ok(!ids.includes("egg-and-bacon-roll") && !ids.includes("full-breakfast"), c.name);
  }
});

test("draft items are never ranked", () => {
  for (const c of chainCases) {
    assert.ok(!runChainCase(c).orders.some((order) => order.itemIds.includes("pumpkin-spice-latte")), c.name);
  }
  assert.ok(!sortMenu((chains.get("bakehouse-and-co") as Chain).items).some((item) => item.id === "pumpkin-spice-latte"));
});

test("a swap that makes an order fit is used and its saving reported", () => {
  const c = chainCases.find((c) => c.name === "pub dinner, swap needed to fit");
  assert.ok(c);
  const fish = runChainCase(c).orders.find((order) => order.group === "fish-and-chips");
  assert.ok(fish && fish.fits);
  assert.deepEqual(fish.swapIds, ["salad-instead-of-chips"]);
  assert.equal(fish.swapSavingKcal, 405);
});

test("nothing fits: the closest options, lightest first, labelled with the overage", () => {
  const c = chainCases.find((c) => c.name === "bakery lunch, nothing fits");
  assert.ok(c);
  const result = runChainCase(c);
  assert.ok(result.nothingFits);
  const overs = result.orders.map((order) => order.overByKcal);
  assert.deepEqual([...overs].sort((a, b) => a - b), overs);
  assert.ok(overs.every((value) => value > 0));
});

test("a proper meal beats padding the order with a sugary drink", () => {
  const c = chainCases.find((c) => c.name === "pub dinner");
  assert.ok(c);
  const top = runChainCase(c).orders[0];
  assert.deepEqual(top.itemIds, ["grilled-chicken-salad"]);
});

test("a favourite becomes the pick for its main", () => {
  const plain = runChainCase(chainCases.find((c) => c.name === "bakery lunch with a planned dinner")!);
  const withFavourite = runChainCase(chainCases.find((c) => c.name === "bakery lunch, a favourite order")!);
  const tuna = (orders: typeof plain.orders) => orders.find((order) => order.group === "tuna-crunch-baguette");
  assert.notDeepEqual(tuna(plain.orders)?.itemIds, ["tuna-crunch-baguette"]);
  assert.deepEqual(tuna(withFavourite.orders)?.itemIds, ["tuna-crunch-baguette"]);
});

test("the result doesn't depend on the order of items in the file", () => {
  const chain = chains.get("bakehouse-and-co") as Chain;
  const reversed: Chain = { ...chain, items: [...chain.items].reverse(), swaps: [...(chain.swaps ?? [])].reverse() };
  const budget: MealBudget = chainCases[0].budget;
  const context = { budget, serving: "lunch" as const, dietTags: [], favourites: [], config: STANDARD_CONFIG };
  assert.deepEqual(rankChain(reversed, context).orders, rankChain(chain, context).orders);
});

test("meal deals use one item from every slot and respect the premium switch", () => {
  for (const c of mealDealCases) {
    const result = runMealDealCase(c);
    assert.ok(result.orders.length <= STANDARD_CONFIG.resultsPerMealDeal, c.name);
    for (const order of result.orders) assert.equal(order.itemIds.length, 3, c.name);
    if (!c.includePremium) assert.ok(!result.orders.some((order) => order.premium), c.name);
  }
});
