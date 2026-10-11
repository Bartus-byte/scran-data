// Ranking prototype. The Swift RankingEngine package implements the same formula in Phase 1 and
// must reproduce test/golden/ranking.json exactly. Everything here is deterministic: no clocks,
// no randomness, and only + − × ÷ on doubles, so TypeScript and Swift get identical results.
//
// The formula is documented in docs/architecture/ranking.md.

import type { Chain, DietTag, Item, MealDeal, MealSlot, Swap } from "./types.ts";

// ---------------------------------------------------------------------------------------------
// Configuration

export interface RankingConfig {
  /** Weight of protein density, protein per 100 kcal. */
  densityWeight: number;
  /** Weight of how much of this meal's protein budget the order covers. */
  proteinWeight: number;
  /** Weight of how close the order is to the ideal meal size. */
  fitWeight: number;
  /** Bonus for an order the user saved as a favourite. */
  favouriteWeight: number;
  /** Penalty per item beyond the first, so simpler orders win ties. */
  extraItemPenalty: number;
  /** Penalty per swap, so an order as served wins a near-tie with a modified one. */
  swapPenalty: number;
  /** Protein density (g per 100 kcal) that scores 0.5 on the density curve. */
  densityHalfSaturation: number;
  /** The ideal meal is at most this multiple of the slot's normal share of the daily target. */
  idealSizeCap: number;
  /**
   * Orders of at least this fraction of the ideal size get full fit credit. Below it, credit
   * falls in proportion. Without the plateau, padding a meal with a sugary drink to fill the
   * budget would score better than the meal alone.
   */
  fullFitFraction: number;
  /** Items with less protein than this sort after the rest in the full menu. */
  menuMinimumProteinG: number;
  resultsPerChain: number;
  resultsPerMealDeal: number;
}

export const STANDARD_CONFIG: RankingConfig = {
  densityWeight: 0.45,
  proteinWeight: 0.3,
  fitWeight: 0.2,
  favouriteWeight: 0.05,
  extraItemPenalty: 0.02,
  swapPenalty: 0.01,
  densityHalfSaturation: 5,
  idealSizeCap: 1.25,
  fullFitFraction: 0.6,
  menuMinimumProteinG: 5,
  resultsPerChain: 3,
  resultsPerMealDeal: 5,
};

/** For users who picked the high-protein diet style: protein counts for more, size for less. */
export const HIGH_PROTEIN_CONFIG: RankingConfig = {
  ...STANDARD_CONFIG,
  densityWeight: 0.5,
  proteinWeight: 0.35,
  fitWeight: 0.1,
};

// ---------------------------------------------------------------------------------------------
// Meal slots and the meal budget

export interface Shares {
  breakfast: number;
  lunch: number;
  dinner: number;
  snack: number;
}

/** Minutes since local midnight; end is exclusive. */
export interface MealWindow {
  start: number;
  end: number;
}

export interface MealWindows {
  breakfast: MealWindow;
  lunch: MealWindow;
  dinner: MealWindow;
}

export const DEFAULT_SHARES: Shares = { breakfast: 0.25, lunch: 0.35, dinner: 0.35, snack: 0.05 };
export const DEFAULT_WINDOWS: MealWindows = {
  breakfast: { start: 5 * 60, end: 11 * 60 },
  lunch: { start: 11 * 60, end: 15 * 60 },
  dinner: { start: 17 * 60, end: 22 * 60 },
};

const MAIN_SLOTS = ["breakfast", "lunch", "dinner"] as const;
type MainSlot = (typeof MAIN_SLOTS)[number];

export interface DayState {
  /** Minutes since local midnight. */
  minuteOfDay: number;
  /** Main meals already logged today. */
  doneSlots: MealSlot[];
  /** Main meals covered by a plan for later today. */
  plannedSlots: MealSlot[];
}

export interface ResolvedSlots {
  /** The meal being chosen now. */
  current: MealSlot;
  /** Meals still to come today, including the current one. Their shares split what's left. */
  open: MealSlot[];
  /** The serving window the clock is in, for item availability; "snack" between windows. */
  serving: MealSlot;
}

/**
 * Works out which meal this is.
 * - Open: every main meal not yet logged, not planned, and whose window hasn't ended; plus snack.
 * - Current: the main meal whose window contains now, if it's open; otherwise snack.
 */
export function resolveSlots(state: DayState, windows: MealWindows = DEFAULT_WINDOWS): ResolvedSlots {
  const now = state.minuteOfDay;
  const isOpen = (slot: MainSlot) =>
    !state.doneSlots.includes(slot) && !state.plannedSlots.includes(slot) && now < windows[slot].end;
  const open: MealSlot[] = MAIN_SLOTS.filter(isOpen);
  open.push("snack");
  const serving: MealSlot = MAIN_SLOTS.find((slot) => windows[slot].start <= now && now < windows[slot].end) ?? "snack";
  const current: MealSlot = serving !== "snack" && open.includes(serving) ? serving : "snack";
  return { current, open, serving };
}

export interface BudgetInput {
  targetKcal: number;
  targetProteinG: number;
  /** Already max(Apple Health total, local log total), per nutrient. */
  eatenKcal: number;
  eatenProteinG: number;
  /** Total of meals planned for later today and not yet logged. */
  reservedKcal: number;
  reservedProteinG: number;
  shares: Shares;
  current: MealSlot;
  open: MealSlot[];
}

export interface MealBudget {
  slot: MealSlot;
  /** The most this meal can be without eating into other meals or plans. Orders above it don't fit. */
  kcal: number;
  proteinG: number;
  /** The size the fit score aims for. */
  idealKcal: number;
  availableKcal: number;
  availableProteinG: number;
}

/**
 *   available = max(target − eaten, 0) − reserved, floored at 0
 *   budget    = available × share(current) ÷ Σ share(open)
 *   ideal     = min(budget, idealSizeCap × share(current) × target)
 */
export function mealBudget(input: BudgetInput, config: RankingConfig = STANDARD_CONFIG): MealBudget {
  const availableKcal = Math.max(Math.max(input.targetKcal - input.eatenKcal, 0) - input.reservedKcal, 0);
  const availableProteinG = Math.max(Math.max(input.targetProteinG - input.eatenProteinG, 0) - input.reservedProteinG, 0);
  let shareSum = 0;
  for (const slot of input.open) shareSum += input.shares[slot];
  const fraction = shareSum > 0 ? input.shares[input.current] / shareSum : 1;
  const kcal = availableKcal * fraction;
  const proteinG = availableProteinG * fraction;
  const idealKcal = Math.min(kcal, config.idealSizeCap * input.shares[input.current] * input.targetKcal);
  return { slot: input.current, kcal, proteinG, idealKcal, availableKcal, availableProteinG };
}

// ---------------------------------------------------------------------------------------------
// Scoring

export interface Totals {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** False when an item's protein, carbohydrate or fat isn't published (counted as 0). */
  complete: boolean;
}

export interface ScoreParts {
  density: number;
  protein: number;
  fit: number;
  favourite: number;
  penalty: number;
}

export function proteinPer100Kcal(totals: Pick<Totals, "kcal" | "proteinG">): number {
  return totals.kcal > 0 ? (100 * totals.proteinG) / totals.kcal : 0;
}

/**
 * How well the order's size suits the meal, 0 to 1:
 *   kcal ≤ ideal:  min(kcal ÷ (fullFitFraction × ideal), 1)   full credit from 60% of ideal
 *   kcal > ideal:  max(0, 1 − (kcal − ideal) ÷ ideal)         only when the budget is above the cap
 */
export function sizeFit(kcal: number, idealKcal: number, config: RankingConfig): number {
  if (idealKcal <= 0) return 0;
  if (kcal <= idealKcal) return Math.min(kcal / (config.fullFitFraction * idealKcal), 1);
  return Math.max(0, 1 - (kcal - idealKcal) / idealKcal);
}

/**
 *   score = wD · D ÷ (D + h)                     D = protein per 100 kcal
 *         + wP · min(protein ÷ protein budget, 1)
 *         + wF · sizeFit(kcal, ideal)
 *         + wFav · favourite
 *         − (0.02 · (items − 1) + 0.01 · swaps)
 *
 * Evaluated left to right exactly as written; the Swift engine uses the same order.
 */
export function scoreValue(
  kcal: number,
  proteinG: number,
  itemCount: number,
  swapCount: number,
  isFavourite: boolean,
  budget: MealBudget,
  config: RankingConfig,
): number {
  const d = kcal > 0 ? (100 * proteinG) / kcal : 0;
  const density = d / (d + config.densityHalfSaturation);
  const protein = budget.proteinG > 0 ? Math.min(proteinG / budget.proteinG, 1) : 1;
  const fit = sizeFit(kcal, budget.idealKcal, config);
  const favourite = isFavourite ? 1 : 0;
  const penalty = config.extraItemPenalty * (itemCount - 1) + config.swapPenalty * swapCount;
  return (
    config.densityWeight * density +
    config.proteinWeight * protein +
    config.fitWeight * fit +
    config.favouriteWeight * favourite -
    penalty
  );
}

/** The score and its parts, for display and tests. */
export function score(
  totals: Totals,
  itemCount: number,
  swapCount: number,
  isFavourite: boolean,
  budget: MealBudget,
  config: RankingConfig,
): { score: number; parts: ScoreParts } {
  const d = proteinPer100Kcal(totals);
  const parts: ScoreParts = {
    density: d / (d + config.densityHalfSaturation),
    protein: budget.proteinG > 0 ? Math.min(totals.proteinG / budget.proteinG, 1) : 1,
    fit: sizeFit(totals.kcal, budget.idealKcal, config),
    favourite: isFavourite ? 1 : 0,
    penalty: config.extraItemPenalty * (itemCount - 1) + config.swapPenalty * swapCount,
  };
  return { score: scoreValue(totals.kcal, totals.proteinG, itemCount, swapCount, isFavourite, budget, config), parts };
}

/** Scores compare at nine decimal places, so float noise can't reorder results. */
export function quantise(value: number): number {
  return Math.floor(value * 1e9 + 0.5);
}

// ---------------------------------------------------------------------------------------------
// Results

export interface RankedOrder {
  /** Item ids, then "|" and swap ids when there are swaps. Unique per order; the final tie-break. */
  key: string;
  /** The order's main item (or single item for a snack); results never repeat a group. */
  group: string;
  itemIds: string[];
  swapIds: string[];
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  complete: boolean;
  proteinPer100Kcal: number;
  score: number;
  parts: ScoreParts;
  fits: boolean;
  /** 0 when the order fits. */
  overByKcal: number;
  /** kcal the swaps save, as a positive number. */
  swapSavingKcal: number;
  premium?: boolean;
}

export interface RankResult {
  orders: RankedOrder[];
  /** True when no order fits the budget and every result is labelled "Over by". */
  nothingFits: boolean;
  /** How many orders were scored. */
  evaluated: number;
}

/** Score descending, then kcal ascending, then key. */
export function compareOrders(a: RankedOrder, b: RankedOrder): number {
  const sa = quantise(a.score);
  const sb = quantise(b.score);
  if (sa !== sb) return sb - sa;
  if (a.kcal !== b.kcal) return a.kcal - b.kcal;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Smallest overage first, then the normal order. */
export function compareOverBudget(a: RankedOrder, b: RankedOrder): number {
  if (a.kcal !== b.kcal) return a.kcal - b.kcal;
  return compareOrders(a, b);
}

// ---------------------------------------------------------------------------------------------
// Chains

export interface RankContext {
  budget: MealBudget;
  /** The serving window, for item availability. */
  serving: MealSlot;
  /** Every item in an order must carry all of these. */
  dietTags: DietTag[];
  /** Saved orders as lists of item ids. */
  favourites: string[][];
  config: RankingConfig;
}

/** One way to have an item: as served, or with one swap. */
interface Choice {
  item: Item;
  swap: Swap | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  complete: boolean;
}

export function isAvailable(item: Item, serving: MealSlot): boolean {
  const slots = item.availability?.slots;
  return !slots || slots.includes(serving);
}

/** Draft figures haven't been checked by a person, so they're never ranked. */
export function isRankable(entry: { reviewStatus: string }): boolean {
  return entry.reviewStatus === "verified";
}

export function matchesDiet(item: Item, tags: DietTag[]): boolean {
  return tags.every((tag) => item.dietTags.includes(tag));
}

/** The item as served, then once with each swap that applies to it. */
function choicesFor(item: Item, swaps: Swap[]): Choice[] {
  const base: Choice = {
    item,
    swap: null,
    kcal: item.kcal,
    proteinG: item.proteinG ?? 0,
    carbsG: item.carbsG ?? 0,
    fatG: item.fatG ?? 0,
    complete: item.proteinG !== null && item.carbsG !== null && item.fatG !== null,
  };
  const result = [base];
  for (const swap of swaps) {
    if (!swap.appliesTo.includes(item.id)) continue;
    result.push({
      item,
      swap,
      kcal: base.kcal + swap.delta.kcal,
      proteinG: base.proteinG + (swap.delta.proteinG ?? 0),
      carbsG: base.carbsG + (swap.delta.carbsG ?? 0),
      fatG: base.fatG + (swap.delta.fatG ?? 0),
      complete: base.complete,
    });
  }
  return result;
}

/** Lightest first, then by item id and swap id, so the search order is fixed. */
function byKcal(a: Choice, b: Choice): number {
  if (a.kcal !== b.kcal) return a.kcal - b.kcal;
  if (a.item.id !== b.item.id) return a.item.id < b.item.id ? -1 : 1;
  const sa = a.swap?.id ?? "";
  const sb = b.swap?.id ?? "";
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function orderKey(parts: Choice[]): string {
  const items = parts.map((part) => part.item.id).join("+");
  const swaps = parts.filter((part) => part.swap).map((part) => (part.swap as Swap).id).sort();
  return swaps.length > 0 ? `${items}|${swaps.join("+")}` : items;
}

/** Favourites as sorted item-id keys, plus every item id they mention for a quick reject. */
class Favourites {
  private keys: Set<string>;
  private items: Set<string>;
  constructor(favourites: string[][]) {
    this.keys = new Set(favourites.map((ids) => [...ids].sort().join("+")));
    this.items = new Set(favourites.flat());
  }
  matches(parts: Choice[]): boolean {
    if (this.keys.size === 0 || !this.items.has(parts[0].item.id)) return false;
    return this.keys.has(parts.map((part) => part.item.id).sort().join("+"));
  }
}

/** The final, presented form of an order. */
function materialise(parts: Choice[], group: string, context: RankContext, favourites: Favourites): RankedOrder {
  let kcal = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  let complete = true;
  let swapSavingKcal = 0;
  let swapCount = 0;
  for (const part of parts) {
    kcal += part.kcal;
    proteinG += part.proteinG;
    carbsG += part.carbsG;
    fatG += part.fatG;
    complete = complete && part.complete;
    if (part.swap) {
      swapCount += 1;
      swapSavingKcal -= part.swap.delta.kcal;
    }
  }
  const totals = { kcal, proteinG, carbsG, fatG, complete };
  const scored = score(totals, parts.length, swapCount, favourites.matches(parts), context.budget, context.config);
  const fits = kcal <= context.budget.kcal;
  return {
    key: orderKey(parts),
    group,
    itemIds: parts.map((part) => part.item.id),
    swapIds: parts.filter((part) => part.swap).map((part) => (part.swap as Swap).id).sort(),
    kcal,
    proteinG,
    carbsG,
    fatG,
    complete,
    proteinPer100Kcal: proteinPer100Kcal(totals),
    score: scored.score,
    parts: scored.parts,
    fits,
    overByKcal: fits ? 0 : Math.ceil(kcal - context.budget.kcal),
    swapSavingKcal,
  };
}

/**
 * Searches one group (one main, or one snack item) for its best fitting order.
 *
 * `first` is the group's own item in each of its choices; `rest` lists the optional add-ons in
 * order (side, then drink), each sorted lightest first and starting with null for "none".
 * Because add-ons are sorted by kcal, each loop stops at the first add-on that can't fit.
 * Meal deals pass add-on lists without null, which makes every slot required.
 * Scores are compared as numbers; an order object is only built for the winner.
 */
function bestInGroup(
  first: Choice[],
  rest: (Choice | null)[][],
  group: string,
  context: RankContext,
  favourites: Favourites,
  counter: { evaluated: number },
): RankedOrder | null {
  const limit = context.budget.kcal;
  const config = context.config;
  let bestParts: Choice[] | null = null;
  let bestQ = 0;
  let bestKcal = 0;
  let bestKey: string | null = null;
  const parts: Choice[] = [];

  // Lightest possible total of the add-ons from each level on, for pruning.
  const minAfter: number[] = new Array(rest.length + 1).fill(0);
  for (let level = rest.length - 1; level >= 0; level -= 1) {
    const lightest = rest[level][0];
    minAfter[level] = minAfter[level + 1] + (lightest ? lightest.kcal : 0);
  }
  // Pruning compares with a margin, so float rounding can never drop an order that fits;
  // consider() applies the exact test.
  const pruneAbove = limit + 1e-6;

  const consider = () => {
    let kcal = 0;
    let proteinG = 0;
    let swapCount = 0;
    for (const part of parts) {
      kcal += part.kcal;
      proteinG += part.proteinG;
      if (part.swap) swapCount += 1;
    }
    if (kcal > limit) return;
    counter.evaluated += 1;
    const value = scoreValue(kcal, proteinG, parts.length, swapCount, favourites.matches(parts), context.budget, config);
    const q = quantise(value);
    if (bestParts !== null) {
      if (q < bestQ) return;
      if (q === bestQ) {
        if (kcal > bestKcal) return;
        if (kcal === bestKcal) {
          const key = orderKey(parts);
          bestKey ??= orderKey(bestParts);
          if (key >= bestKey) return;
          bestKey = key;
        } else {
          bestKey = null;
        }
      } else {
        bestKey = null;
      }
    }
    bestParts = [...parts];
    bestQ = q;
    bestKcal = kcal;
  };

  const walk = (level: number, kcalSoFar: number) => {
    if (level === rest.length) {
      consider();
      return;
    }
    for (const addOn of rest[level]) {
      const kcal = kcalSoFar + (addOn ? addOn.kcal : 0);
      // Add-ons are sorted lightest first, so nothing later at this level fits either.
      if (kcal + minAfter[level + 1] > pruneAbove) break;
      if (addOn) parts.push(addOn);
      walk(level + 1, kcal);
      if (addOn) parts.pop();
    }
  };

  for (const choice of first) {
    if (choice.kcal + minAfter[0] > pruneAbove) continue;
    parts.push(choice);
    walk(0, choice.kcal);
    parts.pop();
  }
  return bestParts ? materialise(bestParts, group, context, favourites) : null;
}

/** When nothing in a group fits, its closest option is the group's item alone, lightest first. */
function closestInGroup(first: Choice[], group: string, context: RankContext, favourites: Favourites): RankedOrder {
  const options = first.map((choice) => materialise([choice], group, context, favourites));
  options.sort(compareOverBudget);
  return options[0];
}

/** The top fitting groups, topped up with the closest over-budget groups when fewer fit. */
function collect(fitting: RankedOrder[], over: RankedOrder[], limit: number, evaluated: number): RankResult {
  const top = fitting.sort(compareOrders).slice(0, limit);
  const rest = over.sort(compareOverBudget).slice(0, limit - top.length);
  return { orders: [...top, ...rest], nothingFits: top.length === 0 && rest.length > 0, evaluated };
}

/**
 * Ranks a chain's orders for this meal.
 * - Main meals: one main, plus an optional side, plus an optional drink.
 * - Snacks: any one food item, or a drink alone, plus an optional drink.
 * Each item may take at most one swap. Results have distinct mains (distinct items for snacks).
 */
export function rankChain(chain: Chain, context: RankContext): RankResult {
  const swaps = (chain.swaps ?? []).filter(isRankable);
  const usable = chain.items.filter(
    (item) => isRankable(item) && isAvailable(item, context.serving) && matchesDiet(item, context.dietTags),
  );
  const groupsOf = (courses: string[]) =>
    usable.filter((item) => courses.includes(item.course)).map((item) => choicesFor(item, swaps));
  const addOns = (courses: string[]): (Choice | null)[] => [null, ...groupsOf(courses).flat().sort(byKcal)];
  const favourites = new Favourites(context.favourites);
  const counter = { evaluated: 0 };
  const fitting: RankedOrder[] = [];
  const over: RankedOrder[] = [];

  const search = (groups: Choice[][], rest: (Choice | null)[][]) => {
    for (const first of groups) {
      const group = first[0].item.id;
      const best = bestInGroup(first, rest, group, context, favourites, counter);
      if (best) fitting.push(best);
      else over.push(closestInGroup(first, group, context, favourites));
    }
  };

  const drinks = addOns(["drink"]);
  if (context.budget.slot === "snack") {
    search(groupsOf(["main", "side", "snack", "dessert"]), [drinks]);
    search(groupsOf(["drink"]), []);
  } else {
    search(groupsOf(["main"]), [addOns(["side"]), drinks]);
  }
  return collect(fitting, over, context.config.resultsPerChain, counter.evaluated);
}

/**
 * The full menu, highest protein per kcal first. Items with under menuMinimumProteinG of protein
 * (black coffee, a side salad) come after the rest, so a near-zero item doesn't top the list on
 * a meaningless ratio. Items without published protein go last. Drafts are left out.
 */
export function sortMenu(items: Item[], config: RankingConfig = STANDARD_CONFIG): Item[] {
  const band = (item: Item) => (item.proteinG === null ? 2 : item.proteinG < config.menuMinimumProteinG ? 1 : 0);
  const density = (item: Item) => (item.proteinG === null ? 0 : proteinPer100Kcal({ kcal: item.kcal, proteinG: item.proteinG }));
  return items.filter(isRankable).sort((a, b) => {
    if (band(a) !== band(b)) return band(a) - band(b);
    const da = quantise(density(a));
    const db = quantise(density(b));
    if (da !== db) return db - da;
    if (a.kcal !== b.kcal) return a.kcal - b.kcal;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------------------------
// Meal deals

export interface MealDealContext extends RankContext {
  includePremium: boolean;
}

/**
 * Every main × snack × drink combination, best combination per main, top five by score.
 * Snacks and drinks are walked in kcal order, so the loops stop as soon as a combination
 * can't fit. All three slots are required. Swaps don't apply to packaged products.
 */
export function rankMealDeal(deal: MealDeal, retailer: Chain, context: MealDealContext): RankResult {
  const items = new Map(retailer.items.map((item) => [item.id, item]));
  const favourites = new Favourites(context.favourites);
  const pick = (slot: MealDeal["slots"]["main"]) =>
    slot.items
      .map((id) => items.get(id))
      .filter((item): item is Item => item !== undefined)
      .filter((item) => isRankable(item) && matchesDiet(item, context.dietTags))
      .filter((item) => context.includePremium || !(slot.premium ?? []).includes(item.id))
      .map((item) => choicesFor(item, []));
  const mains = pick(deal.slots.main);
  const snacks = pick(deal.slots.snack).flat().sort(byKcal);
  const drinks = pick(deal.slots.drink).flat().sort(byKcal);
  const premium = new Set(deal.slots.main.premium ?? []);
  const counter = { evaluated: 0 };
  const fitting: RankedOrder[] = [];
  const over: RankedOrder[] = [];
  if (snacks.length === 0 || drinks.length === 0) return collect(fitting, over, context.config.resultsPerMealDeal, 0);

  const mark = (order: RankedOrder) => ({ ...order, premium: premium.has(order.itemIds[0]) });
  for (const main of mains) {
    const group = main[0].item.id;
    const best = bestInGroup(main, [snacks, drinks], group, context, favourites, counter);
    if (best) {
      fitting.push(mark(best));
    } else {
      // The lightest combination with this main is its closest option.
      over.push(mark(materialise([main[0], snacks[0], drinks[0]], group, context, favourites)));
    }
  }
  return collect(fitting, over, context.config.resultsPerMealDeal, counter.evaluated);
}


// ---------------------------------------------------------------------------------------------
// Plan ahead

/**
 * The budget a plan reserves: the kcal and protein of the best order at that chain for that
 * meal on an empty day, rounded up to the next 10 kcal and whole gram.
 */
export function typicalOrder(
  chain: Chain,
  slot: MealSlot,
  targetKcal: number,
  targetProteinG: number,
  shares: Shares,
  config: RankingConfig = STANDARD_CONFIG,
): { kcal: number; proteinG: number; order: RankedOrder } | null {
  const open: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];
  const budget = mealBudget(
    { targetKcal, targetProteinG, eatenKcal: 0, eatenProteinG: 0, reservedKcal: 0, reservedProteinG: 0, shares, current: slot, open },
    config,
  );
  const result = rankChain(chain, { budget, serving: slot, dietTags: [], favourites: [], config });
  const top = result.orders[0];
  if (!top) return null;
  return { kcal: Math.ceil(top.kcal / 10) * 10, proteinG: Math.ceil(top.proteinG), order: top };
}
