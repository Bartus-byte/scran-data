// Synthetic full-size menus for the benchmark and the full-size golden cases. Generated in memory
// from fixed seeds and never written anywhere: they're test inputs, not nutrition data.
//
// The Swift RankingEngine tests port this generator exactly, so keep it simple: a 32-bit linear
// congruential generator and whole-step rounding of positive numbers.

import { STANDARD_CONFIG, mealBudget, type MealBudget } from "../src/ranking.ts";
import type { Chain, Course, Item, MealDeal, Swap } from "../src/types.ts";

/** Numerical Recipes' LCG: state = state × 1664525 + 1013904223 mod 2³², returned as state ÷ 2³². */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Rounds to one decimal place. Inputs are never negative, so Math.round's ties never matter. */
function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function syntheticItem(next: () => number, course: Course, index: number): Item {
  const protein = tenth(next() * 40);
  const carbs = tenth(next() * 80);
  const fat = tenth(next() * 35);
  const scale = course === "main" ? 1 : course === "drink" ? 0.3 : 0.4;
  const p = tenth(protein * scale);
  const c = tenth(carbs * scale);
  const f = tenth(fat * scale);
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

export interface SyntheticChainSpec {
  mains: number;
  sides: number;
  drinks: number;
  swaps: number;
  /** One generator, seeded with this, makes the mains, then the sides, then the drinks. */
  seed: number;
}

export function syntheticChain(spec: SyntheticChainSpec): Chain {
  const next = random(spec.seed);
  const items: Item[] = [
    ...Array.from({ length: spec.mains }, (_, i) => syntheticItem(next, "main", i)),
    ...Array.from({ length: spec.sides }, (_, i) => syntheticItem(next, "side", i)),
    ...Array.from({ length: spec.drinks }, (_, i) => syntheticItem(next, "drink", i)),
  ];
  const swaps: Swap[] = Array.from({ length: spec.swaps }, (_, s) => ({
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

export interface SyntheticDealSpec {
  /** The retailer: mains and drinks from one generator with this seed, no sides, no swaps. */
  mains: number;
  drinks: number;
  seed: number;
  /** Snack i comes from its own generator seeded with snackSeed + i. */
  snacks: number;
  snackSeed: number;
}

export function syntheticMealDeal(spec: SyntheticDealSpec): { retailer: Chain; deal: MealDeal } {
  const retailer = syntheticChain({ mains: spec.mains, sides: 0, drinks: spec.drinks, swaps: 0, seed: spec.seed });
  const snacks = Array.from({ length: spec.snacks }, (_, i) => syntheticItem(random(spec.snackSeed + i), "snack", i));
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
  return { retailer, deal };
}

/** A lunch budget of exactly this size on an otherwise empty day. */
export function syntheticBudget(kcal: number, proteinG: number): MealBudget {
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

/** The full-size cases: the benchmark's sizes, which the spec's 50 ms per chain target is about. */
export const syntheticChainSpec: SyntheticChainSpec = { mains: 50, sides: 20, drinks: 40, swaps: 2, seed: 42 };
export const syntheticDealSpec: SyntheticDealSpec = { mains: 60, drinks: 60, seed: 42, snacks: 80, snackSeed: 7 };
export const syntheticChainBudgets = [500, 800, 1600];
export const syntheticDealBudgets = [500, 800, 5000];
export const syntheticProteinG = 45;
