// Ranking scenarios over the placeholder example data. scripts/golden.ts turns them into
// test/golden/ranking.json, which the Swift RankingEngine must reproduce.

import { join } from "node:path";
import { loadDataSet } from "../src/load.ts";
import {
  DEFAULT_SHARES,
  HIGH_PROTEIN_CONFIG,
  STANDARD_CONFIG,
  mealBudget,
  rankChain,
  rankMealDeal,
  resolveSlots,
  sortMenu,
  typicalOrder,
  type BudgetInput,
  type DayState,
  type MealBudget,
  type RankResult,
  type RankingConfig,
} from "../src/ranking.ts";
import type { Chain, DietTag, MealDeal, MealSlot } from "../src/types.ts";

const examples = join(import.meta.dirname, "..", "examples");
const data = loadDataSet(examples);
export const chains = new Map<string, Chain>(data.chains.map(({ value }) => [value.id, value]));
export const mealDeals = new Map<string, MealDeal>(data.mealDeals.map(({ value }) => [value.id, value]));

export const configs: Record<string, RankingConfig> = { standard: STANDARD_CONFIG, highProtein: HIGH_PROTEIN_CONFIG };

const TARGET = { kcal: 2250, proteinG: 150 };

function budgetFor(minuteOfDay: number, done: MealSlot[], planned: MealSlot[], eaten: [number, number], reserved: [number, number], config = STANDARD_CONFIG) {
  const slots = resolveSlots({ minuteOfDay, doneSlots: done, plannedSlots: planned });
  const input: BudgetInput = {
    targetKcal: TARGET.kcal,
    targetProteinG: TARGET.proteinG,
    eatenKcal: eaten[0],
    eatenProteinG: eaten[1],
    reservedKcal: reserved[0],
    reservedProteinG: reserved[1],
    shares: DEFAULT_SHARES,
    current: slots.current,
    open: slots.open,
  };
  return { slots, input, budget: mealBudget(input, config) };
}

export interface SlotCase {
  name: string;
  state: DayState;
}

export const slotCases: SlotCase[] = [
  { name: "early morning before breakfast", state: { minuteOfDay: 4 * 60 + 30, doneSlots: [], plannedSlots: [] } },
  { name: "breakfast time", state: { minuteOfDay: 8 * 60 + 15, doneSlots: [], plannedSlots: [] } },
  { name: "lunch with breakfast logged and dinner planned", state: { minuteOfDay: 12 * 60 + 41, doneSlots: ["breakfast"], plannedSlots: ["dinner"] } },
  { name: "lunch already logged", state: { minuteOfDay: 13 * 60 + 30, doneSlots: ["breakfast", "lunch"], plannedSlots: [] } },
  { name: "afternoon gap", state: { minuteOfDay: 15 * 60 + 40, doneSlots: ["breakfast", "lunch"], plannedSlots: [] } },
  { name: "dinner time, nothing logged", state: { minuteOfDay: 19 * 60, doneSlots: [], plannedSlots: [] } },
  { name: "late evening", state: { minuteOfDay: 22 * 60 + 30, doneSlots: ["breakfast", "lunch", "dinner"], plannedSlots: [] } },
];

export interface BudgetCase {
  name: string;
  input: BudgetInput;
  config: string;
}

export const budgetCases: BudgetCase[] = [
  { name: "lunch with a planned dinner", input: budgetFor(12 * 60 + 41, ["breakfast"], ["dinner"], [520, 38], [820, 45]).input, config: "standard" },
  { name: "breakfast on an empty day", input: budgetFor(8 * 60 + 15, [], [], [0, 0], [0, 0]).input, config: "standard" },
  { name: "dinner after a big day", input: budgetFor(19 * 60, ["breakfast", "lunch"], [], [1900, 120], [0, 0]).input, config: "standard" },
  { name: "over target already", input: budgetFor(19 * 60, ["breakfast", "lunch"], [], [2400, 160], [0, 0]).input, config: "standard" },
  { name: "dinner skipped lunch, big leftover", input: budgetFor(19 * 60, ["breakfast"], [], [400, 30], [0, 0]).input, config: "standard" },
  { name: "afternoon snack", input: budgetFor(15 * 60 + 40, ["breakfast", "lunch"], [], [1300, 85], [0, 0]).input, config: "standard" },
];

export interface ChainCase {
  name: string;
  chain: string;
  budget: MealBudget;
  serving: MealSlot;
  dietTags: DietTag[];
  favourites: string[][];
  config: string;
}

function chainCase(name: string, chain: string, scenario: ReturnType<typeof budgetFor>, extra: Partial<ChainCase> = {}): ChainCase {
  return {
    name,
    chain,
    budget: scenario.budget,
    serving: scenario.slots.serving,
    dietTags: [],
    favourites: [],
    config: "standard",
    ...extra,
  };
}

const lunch = budgetFor(12 * 60 + 41, ["breakfast"], ["dinner"], [520, 38], [820, 45]);
const tightLunch = budgetFor(12 * 60, ["breakfast"], [], [1600, 90], [0, 0]);
const breakfast = budgetFor(8 * 60 + 15, [], [], [0, 0], [0, 0]);
const snack = budgetFor(15 * 60 + 40, ["breakfast", "lunch"], [], [1300, 85], [0, 0]);
const dinner = budgetFor(19 * 60 + 30, ["breakfast", "lunch"], [], [1400, 80], [0, 0]);
const smallDinner = budgetFor(19 * 60 + 30, ["breakfast", "lunch"], [], [1600, 95], [0, 0]);
const noneLeft = budgetFor(19 * 60 + 30, ["breakfast", "lunch"], [], [2300, 150], [0, 0]);

export const chainCases: ChainCase[] = [
  chainCase("bakery lunch with a planned dinner", "bakehouse-and-co", lunch),
  chainCase("bakery lunch, high-protein style", "bakehouse-and-co", lunch, { config: "highProtein" }),
  chainCase("bakery lunch, vegan", "bakehouse-and-co", lunch, { dietTags: ["vegan"] }),
  chainCase("bakery lunch, a favourite order", "bakehouse-and-co", lunch, { favourites: [["tuna-crunch-baguette"]] }),
  chainCase("bakery lunch, nothing fits", "bakehouse-and-co", tightLunch),
  chainCase("bakery breakfast", "bakehouse-and-co", breakfast),
  chainCase("bakery afternoon snack", "bakehouse-and-co", snack),
  chainCase("pub dinner", "the-red-lion", dinner),
  chainCase("pub dinner, vegan", "the-red-lion", dinner, { dietTags: ["vegan"] }),
  chainCase("pub dinner, swap needed to fit", "the-red-lion", smallDinner),
  chainCase("pub dinner, budget used up", "the-red-lion", noneLeft),
];

export interface MealDealCase {
  name: string;
  deal: string;
  budget: MealBudget;
  dietTags: DietTag[];
  includePremium: boolean;
  config: string;
}

export const mealDealCases: MealDealCase[] = [
  { name: "meal deal at lunch", deal: "corner-express-meal-deal", budget: lunch.budget, dietTags: [], includePremium: true, config: "standard" },
  { name: "meal deal, no premium", deal: "corner-express-meal-deal", budget: lunch.budget, dietTags: [], includePremium: false, config: "standard" },
  { name: "meal deal, vegan", deal: "corner-express-meal-deal", budget: lunch.budget, dietTags: ["vegan"], includePremium: true, config: "standard" },
  { name: "meal deal, tight budget", deal: "corner-express-meal-deal", budget: tightLunch.budget, dietTags: [], includePremium: true, config: "standard" },
];

export function runChainCase(c: ChainCase): RankResult {
  const chain = chains.get(c.chain);
  if (!chain) throw new Error(`no example chain ${c.chain}`);
  return rankChain(chain, { budget: c.budget, serving: c.serving, dietTags: c.dietTags, favourites: c.favourites, config: configs[c.config] });
}

export function runMealDealCase(c: MealDealCase): RankResult {
  const deal = mealDeals.get(c.deal);
  if (!deal) throw new Error(`no example deal ${c.deal}`);
  const retailer = chains.get(deal.retailerId);
  if (!retailer) throw new Error(`no example retailer ${deal.retailerId}`);
  return rankMealDeal(deal, retailer, {
    budget: c.budget,
    serving: "lunch",
    dietTags: c.dietTags,
    favourites: [],
    includePremium: c.includePremium,
    config: configs[c.config],
  });
}

export function menuOrder(chainId: string): string[] {
  const chain = chains.get(chainId);
  if (!chain) throw new Error(`no example chain ${chainId}`);
  return sortMenu(chain.items).map((item) => item.id);
}

export function planCases() {
  const cases: { chain: string; slot: MealSlot }[] = [
    { chain: "the-red-lion", slot: "dinner" },
    { chain: "bakehouse-and-co", slot: "lunch" },
  ];
  return cases.map((c) => {
    const chain = chains.get(c.chain);
    if (!chain) throw new Error(`no example chain ${c.chain}`);
    const result = typicalOrder(chain, c.slot, TARGET.kcal, TARGET.proteinG, DEFAULT_SHARES);
    return { ...c, targetKcal: TARGET.kcal, targetProteinG: TARGET.proteinG, reserved: result && { kcal: result.kcal, proteinG: result.proteinG, key: result.order.key } };
  });
}
