// The energy check: declared kcal against the UK label factors.
//
//   kcal ≈ 4 × protein + 4 × carbohydrate + 9 × fat + 2 × fibre + 7 × alcohol
//
// Factors from the UK and EU food information rules (Regulation (EU) No 1169/2011, Annex XIV,
// retained in UK law). Without the alcohol term every alcoholic drink fails: a pint of 4% lager
// carries about 18 g of alcohol, about 125 kcal.
//
// Tolerance. Labels round each figure, and some chains count fibre differently, so an exact
// match isn't expected:
//   pass     difference ≤ max(15 kcal, 5% of declared)
//   warning  difference ≤ max(30 kcal, 10% of declared)   printed for review, doesn't fail
//   error    anything larger                               fails the build
// Whole-gram rounding of three macros moves the result by at most 8.5 kcal; counting fibre at
// 4 instead of 2 adds 2 kcal per gram. Both stay inside "pass" for normal meals, while a
// mistyped figure (45 g fat entered as 4.5 g is 365 kcal) is caught. Revisit the bands against
// the first real chain PDFs and log any change in DECISIONS.md.

import type { Item } from "./types.ts";

export const ENERGY_FACTORS = { protein: 4, carbs: 4, fat: 9, fibre: 2, alcohol: 7 } as const;
export const ETHANOL_DENSITY_G_PER_ML = 0.789;

export const ENERGY_TOLERANCE = {
  passKcal: 15,
  passFraction: 0.05,
  warnKcal: 30,
  warnFraction: 0.1,
} as const;

export type EnergyVerdict =
  | { kind: "pass"; computed: number; difference: number }
  | { kind: "warning"; computed: number; difference: number }
  | { kind: "error"; computed: number; difference: number }
  | { kind: "skipped"; reason: string };

/** Energy from the macros with the UK label factors, before rounding. */
export function computedKcal(item: Pick<Item, "proteinG" | "carbsG" | "fatG" | "fibreG" | "alcoholG">): number | null {
  if (item.proteinG === null || item.carbsG === null || item.fatG === null) return null;
  return (
    ENERGY_FACTORS.protein * item.proteinG +
    ENERGY_FACTORS.carbs * item.carbsG +
    ENERGY_FACTORS.fat * item.fatG +
    ENERGY_FACTORS.fibre * (item.fibreG ?? 0) +
    ENERGY_FACTORS.alcohol * (item.alcoholG ?? 0)
  );
}

export function checkEnergy(item: Item): EnergyVerdict {
  if (item.energyCheckException) {
    return { kind: "skipped", reason: `exception: ${item.energyCheckException}` };
  }
  const computed = computedKcal(item);
  if (computed === null) {
    return { kind: "skipped", reason: "protein, carbohydrate or fat not published" };
  }
  const difference = Math.abs(item.kcal - computed);
  const pass = Math.max(ENERGY_TOLERANCE.passKcal, ENERGY_TOLERANCE.passFraction * item.kcal);
  const warn = Math.max(ENERGY_TOLERANCE.warnKcal, ENERGY_TOLERANCE.warnFraction * item.kcal);
  if (difference <= pass) return { kind: "pass", computed, difference };
  if (difference <= warn) return { kind: "warning", computed, difference };
  return { kind: "error", computed, difference };
}

/** Grams of alcohol from volume and ABV: ml × ABV% ÷ 100 × 0.789. */
export function alcoholGrams(volumeMl: number, abvPercent: number): number {
  return (volumeMl * abvPercent) / 100 * ETHANOL_DENSITY_G_PER_ML;
}
