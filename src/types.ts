// Types for the data files. They mirror schema/*.schema.json; the schema is the source of truth.

export type Course = "main" | "side" | "drink" | "snack" | "dessert";
export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";
export type DietTag = "vegetarian" | "vegan" | "halal" | "dairy-free";
export type Region = "GB-ENG" | "GB-SCT" | "GB-WLS" | "GB-NIR" | "IE";
export type ReviewStatus = "draft" | "verified";
export type ChainType = "restaurant" | "cafe" | "pub" | "bakery" | "supermarket";

export interface Item {
  id: string;
  name: string;
  portion?: string;
  course: Course;
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fibreG?: number;
  saltG?: number;
  alcoholG?: number;
  abvPercent?: number;
  volumeMl?: number;
  dietTags: DietTag[];
  availability?: { slots?: MealSlot[]; seasonal?: boolean; note?: string };
  gtins?: string[];
  energyCheckException?: string;
  sourceUrl: string;
  lastChecked: string;
  reviewStatus: ReviewStatus;
  isPlaceholder?: boolean;
}

export interface NutrientDelta {
  kcal: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fibreG?: number;
  saltG?: number;
}

export interface Swap {
  id: string;
  label: string;
  delta: NutrientDelta;
  appliesTo: string[];
  derivedFrom?: { remove: string; add?: string };
  sourceUrl: string;
  lastChecked: string;
  reviewStatus: ReviewStatus;
  isPlaceholder?: boolean;
}

export interface Chain {
  $schema?: string;
  schemaVersion: 1;
  id: string;
  name: string;
  aliases: string[];
  type: ChainType;
  regions: Region[];
  sourceUrl: string;
  allergenInfoUrl: string;
  lastChecked: string;
  isPlaceholder: boolean;
  notes?: string;
  items: Item[];
  swaps?: Swap[];
}

export interface MealDealSlot {
  items: string[];
  premium?: string[];
}

export interface MealDeal {
  $schema?: string;
  schemaVersion: 1;
  id: string;
  retailerId: string;
  name: string;
  regions: Region[];
  slots: { main: MealDealSlot; snack: MealDealSlot; drink: MealDealSlot };
  sourceUrl: string;
  lastChecked: string;
  isPlaceholder: boolean;
  reviewStatus: ReviewStatus;
  notes?: string;
}

export interface ManifestFile {
  kind: "chain" | "mealDeal";
  id: string;
  path: string;
  sha256: string;
  bytes: number;
  contentBytes: number;
  lastChecked: string;
}

export interface Manifest {
  manifestVersion: 1;
  dataSchemaVersion: 1;
  version: number;
  generatedAt: string;
  isRelease: boolean;
  files: ManifestFile[];
}

/** A data file as loaded from disk, with the path it came from for error messages. */
export interface Loaded<T> {
  file: string;
  value: T;
}

export interface DataSet {
  chains: Loaded<Chain>[];
  mealDeals: Loaded<MealDeal>[];
}
