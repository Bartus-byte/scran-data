// Times the ranking prototype on synthetic menus at the sizes the spec mentions.
//
//   node scripts/bench.ts
//
// The synthetic items are generated in memory from a fixed seed and never written anywhere.
// Node timings are indicative only; the Swift engine's performance test runs in Phase 1.

import { STANDARD_CONFIG, mealBudget, rankChain, rankMealDeal, type MealBudget } from "../src/ranking.ts";
import type { Chain, Course, Item, MealDeal, Swap } from "../src/types.ts";

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function syntheticItem(next: () => number, course: Course, index: number): Item {
  const protein = Math.round(next() * 40 * 10) / 10;
  const carbs = Math.round(next() * 80 * 10) / 10;
  const fat = Math.round(next() * 35 * 10) / 10;
  const scale = course === "main" ? 1 : course === "drink" ? 0.3 : 0.4;
  const p = Math.round(protein * scale * 10) / 10;
  const c = Math.round(carbs * scale * 10) / 10;
  const f = Math.round(fat * scale * 10) / 10;
  return {
    id: `${course}-${index}`,
    name: `${course} ${index}`,
    course,
    kcal: Math.round(4 * p + 4 * c + 9 * f),
    proteinG: p,
    carbsG: c,
    fatG: f,
    dietTags: [],
    sourceUrl: "https://example.com/synthetic",
    lastChecked: "2026-10-11",
    reviewStatus: "verified",
    isPlaceholder: true,
  };
}

function syntheticChain(mains: number, sides: number, drinks: number, swapsPerMain: number): Chain {
  const next = random(42);
  const items: Item[] = [
    ...Array.from({ length: mains }, (_, i) => syntheticItem(next, "main", i)),
    ...Array.from({ length: sides }, (_, i) => syntheticItem(next, "side", i)),
    ...Array.from({ length: drinks }, (_, i) => syntheticItem(next, "drink", i)),
  ];
  const swaps: Swap[] = Array.from({ length: swapsPerMain }, (_, s) => ({
    id: `swap-${s}`,
    label: `Swap ${s}`,
    delta: { kcal: -40 - 30 * s, fatG: -4 - 3 * s },
    appliesTo: items.filter((item) => item.course === "main" && item.kcal > 200 + 30 * s).map((item) => item.id),
    sourceUrl: "https://example.com/synthetic",
    lastChecked: "2026-10-11",
    reviewStatus: "verified",
  }));
  return {
    schemaVersion: 1,
    id: "synthetic",
    name: "Synthetic",
    aliases: ["Synthetic"],
    type: "supermarket",
    regions: ["GB-ENG"],
    sourceUrl: "https://example.com/synthetic",
    allergenInfoUrl: "https://example.com/synthetic",
    lastChecked: "2026-10-11",
    isPlaceholder: true,
    items,
    swaps,
  };
}

function budget(kcal: number, proteinG: number): MealBudget {
  return mealBudget(
    {
      targetKcal: kcal / 0.35,
      targetProteinG: proteinG / 0.35,
      eatenKcal: 0,
      eatenProteinG: 0,
      reservedKcal: 0,
      reservedProteinG: 0,
      shares: { breakfast: 0.25, lunch: 0.35, dinner: 0.35, snack: 0.05 },
      current: "lunch",
      open: ["breakfast", "lunch", "dinner", "snack"],
    },
    STANDARD_CONFIG,
  );
}

function time(label: string, run: () => { evaluated: number }) {
  run(); // warm up
  const runs = 5;
  const start = performance.now();
  let evaluated = 0;
  for (let i = 0; i < runs; i += 1) evaluated = run().evaluated;
  const ms = (performance.now() - start) / runs;
  console.log(`${label.padEnd(58)} ${evaluated.toLocaleString("en-GB").padStart(9)} orders scored  ${ms.toFixed(1).padStart(7)} ms`);
}

const chain = syntheticChain(50, 20, 40, 2);
for (const kcal of [500, 800, 1600]) {
  time(`chain: 50 mains × 21 sides × 41 drinks, 2 swaps, ${kcal} kcal`, () =>
    rankChain(chain, { budget: budget(kcal, 45), serving: "lunch", dietTags: [], favourites: [], config: STANDARD_CONFIG }),
  );
}

const retailer = syntheticChain(60, 0, 60, 0);
const snacks = Array.from({ length: 80 }, (_, i) => syntheticItem(random(7 + i), "snack", i));
retailer.items.push(...snacks);
const deal: MealDeal = {
  schemaVersion: 1,
  id: "synthetic-deal",
  retailerId: "synthetic",
  name: "Synthetic deal",
  regions: ["GB-ENG"],
  slots: {
    main: { items: retailer.items.filter((i) => i.course === "main").map((i) => i.id) },
    snack: { items: snacks.map((i) => i.id) },
    drink: { items: retailer.items.filter((i) => i.course === "drink").map((i) => i.id) },
  },
  sourceUrl: "https://example.com/synthetic",
  lastChecked: "2026-10-11",
  isPlaceholder: true,
  reviewStatus: "verified",
};
for (const kcal of [500, 800, 5000]) {
  time(`meal deal: 60 × 80 × 60 = 288,000 combinations, ${kcal} kcal`, () =>
    rankMealDeal(deal, retailer, { budget: budget(kcal, 45), serving: "lunch", dietTags: [], favourites: [], includePremium: true, config: STANDARD_CONFIG }),
  );
}
