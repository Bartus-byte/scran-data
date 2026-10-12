// Times the ranking prototype on synthetic menus at the sizes the spec mentions.
//
//   node scripts/bench.ts
//
// The synthetic menus (test/synthetic.ts) are generated in memory from fixed seeds and never
// written anywhere. Node timings are indicative only; the Swift engine has its own
// performance test.

import { STANDARD_CONFIG, rankChain, rankMealDeal } from "../src/ranking.ts";
import {
  syntheticBudget,
  syntheticChain,
  syntheticChainBudgets,
  syntheticChainSpec,
  syntheticDealBudgets,
  syntheticDealSpec,
  syntheticMealDeal,
  syntheticProteinG,
} from "../test/synthetic.ts";

function time(label: string, run: () => { evaluated: number }) {
  run(); // warm up
  const runs = 5;
  const start = performance.now();
  let evaluated = 0;
  for (let i = 0; i < runs; i += 1) evaluated = run().evaluated;
  const ms = (performance.now() - start) / runs;
  console.log(`${label.padEnd(58)} ${evaluated.toLocaleString("en-GB").padStart(9)} orders scored  ${ms.toFixed(1).padStart(7)} ms`);
}

const chain = syntheticChain(syntheticChainSpec);
const { mains, sides, drinks, swaps } = syntheticChainSpec;
for (const kcal of syntheticChainBudgets) {
  time(`chain: ${mains} mains × ${sides + 1} sides × ${drinks + 1} drinks, ${swaps} swaps, ${kcal} kcal`, () =>
    rankChain(chain, { budget: syntheticBudget(kcal, syntheticProteinG), serving: "lunch", dietTags: [], favourites: [], config: STANDARD_CONFIG }),
  );
}

const { retailer, deal } = syntheticMealDeal(syntheticDealSpec);
const combinations = syntheticDealSpec.mains * syntheticDealSpec.snacks * syntheticDealSpec.drinks;
for (const kcal of syntheticDealBudgets) {
  time(`meal deal: ${syntheticDealSpec.mains} × ${syntheticDealSpec.snacks} × ${syntheticDealSpec.drinks} = ${combinations.toLocaleString("en-GB")} combinations, ${kcal} kcal`, () =>
    rankMealDeal(deal, retailer, { budget: syntheticBudget(kcal, syntheticProteinG), serving: "lunch", dietTags: [], favourites: [], includePremium: true, config: STANDARD_CONFIG }),
  );
}
