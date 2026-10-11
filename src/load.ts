// Reads a data directory laid out as chains/<id>.json and meal-deals/<id>.json.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Chain, DataSet, Loaded, MealDeal } from "./types.ts";

export function loadDataSet(root: string): DataSet {
  return {
    chains: readJsonFiles<Chain>(join(root, "chains")),
    mealDeals: readJsonFiles<MealDeal>(join(root, "meal-deals")),
  };
}

function readJsonFiles<T>(directory: string): Loaded<T>[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const file = join(directory, name);
      return { file, value: JSON.parse(readFileSync(file, "utf8")) as T };
    });
}
