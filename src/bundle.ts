// Builds the published data bundle: one raw-DEFLATE file per chain and meal deal, plus a
// manifest with each file's SHA-256.
//
// Release bundles leave out draft items, swaps and meal deals (the log lists each one) and
// refuse placeholder data outright. The app's release build checks the same again.

import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import type { Chain, DataSet, Manifest, ManifestFile, MealDeal } from "./types.ts";

export interface BuiltFile {
  path: string;
  compressed: Buffer;
  entry: ManifestFile;
}

export interface Bundle {
  manifest: Manifest;
  files: BuiltFile[];
  /** What a release build left out, for the log. */
  excluded: string[];
}

export function buildBundle(data: DataSet, options: { release: boolean; now: Date }): Bundle {
  const excluded: string[] = [];
  const files: BuiltFile[] = [];
  const keptItems = new Map<string, Set<string>>();

  for (const { value } of data.chains) {
    const chain = options.release ? releaseChain(value, excluded) : value;
    if (!chain) continue;
    keptItems.set(chain.id, new Set(chain.items.map((item) => item.id)));
    files.push(file("chain", chain.id, `chains/${chain.id}.json.deflate`, chain, chain.lastChecked));
  }

  for (const { value } of data.mealDeals) {
    const deal = options.release ? releaseMealDeal(value, keptItems.get(value.retailerId), excluded) : value;
    if (!deal) continue;
    files.push(file("mealDeal", deal.id, `meal-deals/${deal.id}.json.deflate`, deal, deal.lastChecked));
  }

  files.sort((a, b) => (a.entry.kind === b.entry.kind ? compare(a.entry.id, b.entry.id) : a.entry.kind === "chain" ? -1 : 1));

  const manifest: Manifest = {
    manifestVersion: 1,
    dataSchemaVersion: 1,
    version: versionNumber(options.now),
    // Whole seconds, so ISO 8601 parsers without fractional-second support (Swift's .iso8601) read it.
    generatedAt: options.now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    isRelease: options.release,
    files: files.map((f) => f.entry),
  };
  return { manifest, files, excluded };
}

/** The JSON exactly as published: editor-only keys removed, no whitespace. */
export function canonicalJson(value: Chain | MealDeal): string {
  const { $schema: _schema, ...rest } = value;
  return JSON.stringify(rest);
}

/** Inverse of the app's NSData zlib decompression: raw DEFLATE, RFC 1951. */
export function compress(json: string): Buffer {
  return deflateRawSync(Buffer.from(json, "utf8"), { level: 9 });
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** YYYYMMDDHHmm in UTC. */
export function versionNumber(date: Date): number {
  const pad = (n: number) => String(n).padStart(2, "0");
  return Number(
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`,
  );
}

function file(kind: ManifestFile["kind"], id: string, path: string, value: Chain | MealDeal, lastChecked: string): BuiltFile {
  const json = canonicalJson(value);
  const compressed = compress(json);
  return {
    path,
    compressed,
    entry: { kind, id, path, sha256: sha256(json), bytes: compressed.length, contentBytes: Buffer.byteLength(json), lastChecked },
  };
}

function releaseChain(chain: Chain, excluded: string[]): Chain | null {
  const items = chain.items.filter((item) => {
    if (item.reviewStatus === "verified") return true;
    excluded.push(`${chain.id}/${item.id} (draft)`);
    return false;
  });
  if (items.length === 0) {
    excluded.push(`${chain.id} (no verified items)`);
    return null;
  }
  const kept = new Set(items.map((item) => item.id));
  const swaps = (chain.swaps ?? [])
    .filter((swap) => {
      if (swap.reviewStatus === "verified") return true;
      excluded.push(`${chain.id}/swaps/${swap.id} (draft)`);
      return false;
    })
    .map((swap) => ({ ...swap, appliesTo: swap.appliesTo.filter((id) => kept.has(id)) }))
    .filter((swap) => {
      if (swap.appliesTo.length > 0) return true;
      excluded.push(`${chain.id}/swaps/${swap.id} (applies to no verified item)`);
      return false;
    });
  return { ...chain, items, swaps };
}

function releaseMealDeal(deal: MealDeal, retailerItems: Set<string> | undefined, excluded: string[]): MealDeal | null {
  if (deal.reviewStatus !== "verified") {
    excluded.push(`${deal.id} (draft)`);
    return null;
  }
  if (!retailerItems) {
    excluded.push(`${deal.id} (retailer not in the bundle)`);
    return null;
  }
  const prune = (slot: MealDeal["slots"]["main"]) => ({
    items: slot.items.filter((id) => retailerItems.has(id)),
    ...(slot.premium ? { premium: slot.premium.filter((id) => retailerItems.has(id)) } : {}),
  });
  const slots = { main: prune(deal.slots.main), snack: prune(deal.slots.snack), drink: prune(deal.slots.drink) };
  if (slots.main.items.length === 0 || slots.snack.items.length === 0 || slots.drink.items.length === 0) {
    excluded.push(`${deal.id} (a slot has no verified items)`);
    return null;
  }
  return { ...deal, slots };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
