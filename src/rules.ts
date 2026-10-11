// Validation rules that JSON Schema can't express. The schema check runs first; these assume
// files that already match the schema.

import { alcoholGrams, checkEnergy } from "./energy.ts";
import type { Chain, DataSet, Item, MealDeal, Swap } from "./types.ts";

export type Level = "error" | "warning";

export interface Issue {
  level: Level;
  file: string;
  where: string;
  message: string;
}

export interface RuleOptions {
  /** Release bundles may not contain placeholder data. */
  release: boolean;
  /** "Today" for date checks, YYYY-MM-DD. */
  today: string;
  /** Warn when lastChecked is older than this many days. */
  staleAfterDays?: number;
}

const ALCOHOL_TOLERANCE_G = 0.5;
const DERIVED_TOLERANCE = { kcal: 2, grams: 0.15 };

export function validate(data: DataSet, options: RuleOptions): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Level, file: string, where: string, message: string) =>
    issues.push({ level, file, where, message });

  const chainsById = new Map<string, Chain>();
  for (const { file, value: chain } of data.chains) {
    if (chainsById.has(chain.id)) add("error", file, chain.id, `duplicate chain id "${chain.id}"`);
    chainsById.set(chain.id, chain);
    checkFileName(file, chain.id, add);
    checkChain(file, chain, options, add);
  }

  const dealIds = new Set<string>();
  for (const { file, value: deal } of data.mealDeals) {
    if (dealIds.has(deal.id)) add("error", file, deal.id, `duplicate meal deal id "${deal.id}"`);
    dealIds.add(deal.id);
    checkFileName(file, deal.id, add);
    checkMealDeal(file, deal, chainsById.get(deal.retailerId), options, add);
  }
  return issues;
}

type Add = (level: Level, file: string, where: string, message: string) => void;

function checkFileName(file: string, id: string, add: Add) {
  const base = file.split("/").pop() ?? file;
  if (base !== `${id}.json`) add("error", file, id, `file name should be ${id}.json`);
}

function checkChain(file: string, chain: Chain, options: RuleOptions, add: Add) {
  if (options.release && chain.isPlaceholder) {
    add("error", file, chain.id, "placeholder data can't go in a release bundle");
  }
  checkDate(file, chain.id, chain.lastChecked, options, add);

  const items = new Map<string, Item>();
  const gtinOwners = new Map<string, string>();
  for (const item of chain.items) {
    const where = `${chain.id}/${item.id}`;
    if (items.has(item.id)) add("error", file, where, `duplicate item id "${item.id}"`);
    items.set(item.id, item);
    if (options.release && item.isPlaceholder) add("error", file, where, "placeholder item in a release bundle");
    checkDate(file, where, item.lastChecked, options, add);
    checkItem(file, where, item, add);
    for (const gtin of item.gtins ?? []) {
      if (!hasValidCheckDigit(gtin)) add("error", file, where, `GTIN ${gtin} has a wrong check digit`);
      const owner = gtinOwners.get(gtin);
      if (owner) add("error", file, where, `GTIN ${gtin} is also on "${owner}"`);
      gtinOwners.set(gtin, item.id);
    }
  }

  const swapIds = new Set<string>();
  for (const swap of chain.swaps ?? []) {
    const where = `${chain.id}/swaps/${swap.id}`;
    if (swapIds.has(swap.id)) add("error", file, where, `duplicate swap id "${swap.id}"`);
    swapIds.add(swap.id);
    if (options.release && swap.isPlaceholder) add("error", file, where, "placeholder swap in a release bundle");
    checkDate(file, where, swap.lastChecked, options, add);
    checkSwap(file, where, swap, items, add);
  }
}

function checkItem(file: string, where: string, item: Item, add: Add) {
  // Tag consistency: vegan implies vegetarian, and vegan implies no dairy.
  const tags = new Set(item.dietTags);
  if (tags.has("vegan") && !tags.has("vegetarian")) add("error", file, where, "vegan items must also be tagged vegetarian");
  if (tags.has("vegan") && !tags.has("dairy-free")) add("error", file, where, "vegan items must also be tagged dairy-free");

  // Alcohol from ABV and volume.
  if (item.abvPercent !== undefined && item.volumeMl !== undefined) {
    const expected = alcoholGrams(item.volumeMl, item.abvPercent);
    if (item.alcoholG === undefined || Math.abs(item.alcoholG - expected) > ALCOHOL_TOLERANCE_G) {
      add("error", file, where, `alcoholG should be ${expected.toFixed(1)} (${item.volumeMl} ml × ${item.abvPercent}% × 0.789)`);
    }
  }
  if (item.alcoholG !== undefined && item.alcoholG > 0 && item.course !== "drink") {
    add("warning", file, where, "alcohol on an item that isn't a drink");
  }

  // Energy against the UK label factors.
  const verdict = checkEnergy(item);
  if (verdict.kind === "error" || verdict.kind === "warning") {
    add(
      verdict.kind,
      file,
      where,
      `declared ${item.kcal} kcal, macros give ${verdict.computed.toFixed(1)} kcal (off by ${verdict.difference.toFixed(1)})`,
    );
  }
}

function checkSwap(file: string, where: string, swap: Swap, items: Map<string, Item>, add: Add) {
  for (const id of swap.appliesTo) {
    const item = items.get(id);
    if (!item) {
      add("error", file, where, `appliesTo refers to unknown item "${id}"`);
      continue;
    }
    // A swap can't take any figure below zero.
    const after: [string, number | null | undefined, number | undefined][] = [
      ["kcal", item.kcal, swap.delta.kcal],
      ["proteinG", item.proteinG, swap.delta.proteinG],
      ["carbsG", item.carbsG, swap.delta.carbsG],
      ["fatG", item.fatG, swap.delta.fatG],
      ["fibreG", item.fibreG, swap.delta.fibreG],
      ["saltG", item.saltG, swap.delta.saltG],
    ];
    for (const [name, base, delta] of after) {
      if (delta === undefined || base === null || base === undefined) continue;
      if (base + delta < -1e-9) add("error", file, where, `on "${id}" it takes ${name} below zero`);
    }
  }

  if (swap.derivedFrom) {
    const removed = items.get(swap.derivedFrom.remove);
    const added = swap.derivedFrom.add ? items.get(swap.derivedFrom.add) : undefined;
    if (!removed) add("error", file, where, `derivedFrom.remove refers to unknown item "${swap.derivedFrom.remove}"`);
    if (swap.derivedFrom.add && !added) add("error", file, where, `derivedFrom.add refers to unknown item "${swap.derivedFrom.add}"`);
    if (removed && (added || !swap.derivedFrom.add)) {
      const pairs: [string, number, number | null | undefined, number | null | undefined, number][] = [
        ["kcal", swap.delta.kcal, added?.kcal ?? 0, removed.kcal, DERIVED_TOLERANCE.kcal],
        ["proteinG", swap.delta.proteinG ?? 0, added ? added.proteinG : 0, removed.proteinG, DERIVED_TOLERANCE.grams],
        ["carbsG", swap.delta.carbsG ?? 0, added ? added.carbsG : 0, removed.carbsG, DERIVED_TOLERANCE.grams],
        ["fatG", swap.delta.fatG ?? 0, added ? added.fatG : 0, removed.fatG, DERIVED_TOLERANCE.grams],
        ["fibreG", swap.delta.fibreG ?? 0, added?.fibreG ?? 0, removed.fibreG ?? 0, DERIVED_TOLERANCE.grams],
        ["saltG", swap.delta.saltG ?? 0, added?.saltG ?? 0, removed.saltG ?? 0, DERIVED_TOLERANCE.grams],
      ];
      for (const [name, delta, a, r, tolerance] of pairs) {
        if (a === null || a === undefined || r === null || r === undefined) continue;
        const expected = a - r;
        if (Math.abs(delta - expected) > tolerance) {
          add("error", file, where, `delta.${name} should be ${round1(expected)} (added − removed)`);
        }
      }
    }
  }
}

function checkMealDeal(file: string, deal: MealDeal, retailer: Chain | undefined, options: RuleOptions, add: Add) {
  if (options.release && deal.isPlaceholder) add("error", file, deal.id, "placeholder data can't go in a release bundle");
  checkDate(file, deal.id, deal.lastChecked, options, add);
  if (!retailer) {
    add("error", file, deal.id, `retailerId "${deal.retailerId}" has no chain file`);
    return;
  }
  if (retailer.type !== "supermarket") add("error", file, deal.id, `retailer "${retailer.id}" isn't a supermarket`);
  const items = new Map(retailer.items.map((item) => [item.id, item]));
  const expected = { main: ["main"], snack: ["snack", "side", "dessert"], drink: ["drink"] } as const;
  for (const slotName of ["main", "snack", "drink"] as const) {
    const slot = deal.slots[slotName];
    for (const id of slot.items) {
      const item = items.get(id);
      if (!item) {
        add("error", file, `${deal.id}/${slotName}`, `unknown item "${id}" in ${retailer.id}`);
      } else if (!(expected[slotName] as readonly string[]).includes(item.course)) {
        add("warning", file, `${deal.id}/${slotName}`, `"${id}" is a ${item.course}, listed as a ${slotName}`);
      }
    }
    for (const id of slot.premium ?? []) {
      if (!slot.items.includes(id)) add("error", file, `${deal.id}/${slotName}`, `premium item "${id}" isn't in items`);
    }
  }
}

function checkDate(file: string, where: string, day: string, options: RuleOptions, add: Add) {
  const parsed = parseDay(day);
  if (!parsed) {
    add("error", file, where, `"${day}" isn't a real date`);
    return;
  }
  if (day > options.today) add("error", file, where, `lastChecked ${day} is in the future`);
  const staleAfter = options.staleAfterDays ?? 180;
  const today = parseDay(options.today);
  if (today && (today.getTime() - parsed.getTime()) / 86_400_000 > staleAfter) {
    add("warning", file, where, `last checked ${day}, more than ${staleAfter} days ago`);
  }
}

function parseDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const value = new Date(Date.UTC(year, month - 1, date));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== date) return null;
  return value;
}

/** GS1 mod-10 check digit, for GTIN-8, -12, -13 and -14. */
export function hasValidCheckDigit(gtin: string): boolean {
  if (!/^\d+$/.test(gtin)) return false;
  const digits = gtin.split("").map(Number);
  const check = digits.pop();
  let sum = 0;
  digits.reverse().forEach((digit, index) => {
    sum += digit * (index % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === check;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
