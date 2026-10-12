// The PDF helper: turns a chain's official nutrition PDF into a draft chain file.
//
// poppler's `pdftotext -bbox-layout` gives every word with its position. From those:
//   1. Words on the same baseline form a line.
//   2. The header is the line (with up to two lines either side, for wrapped headers) that
//      names protein and at least two of energy, fat and carbohydrate. Words stacked in one
//      column ("Energy" over "(kcal)") form one column label.
//   3. Each later line becomes a row: words left of the first figure column are the name, and
//      each figure goes to the column it sits under.
//   4. Every item is a draft, with the PDF as its source. A person checks each figure against
//      the PDF and changes it to "verified"; the data rules run straight away.
//
// It never makes a figure up: a cell it can't read is left out (null), and every guess it does
// make (the course, a "<0.1" read as 0.1, a combined kJ/kcal cell) is listed for review.

import type { Chain, ChainType, Course, Item, Region } from "./types.ts";

export interface Word {
  text: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface Page {
  width: number;
  height: number;
  words: Word[];
}

/** Parses `pdftotext -bbox-layout` output. */
export function parseBboxLayout(xhtml: string): Page[] {
  const pages: Page[] = [];
  const pagePattern = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
  const wordPattern = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g;
  for (const page of xhtml.matchAll(pagePattern)) {
    const words: Word[] = [];
    for (const word of page[3].matchAll(wordPattern)) {
      words.push({
        xMin: Number(word[1]),
        yMin: Number(word[2]),
        xMax: Number(word[3]),
        yMax: Number(word[4]),
        text: decodeEntities(word[5]),
      });
    }
    pages.push({ width: Number(page[1]), height: Number(page[2]), words });
  }
  return pages;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export interface Line {
  words: Word[];
  yMin: number;
  yMax: number;
}

/** Groups words into visual lines, top to bottom, each left to right. */
export function lines(words: Word[]): Line[] {
  const sorted = [...words].sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
  const result: Line[] = [];
  for (const word of sorted) {
    const centre = (word.yMin + word.yMax) / 2;
    const line = result.find((candidate) => centre >= candidate.yMin && centre <= candidate.yMax);
    if (line) {
      line.words.push(word);
      line.yMin = Math.min(line.yMin, word.yMin);
      line.yMax = Math.max(line.yMax, word.yMax);
    } else {
      result.push({ words: [word], yMin: word.yMin, yMax: word.yMax });
    }
  }
  for (const line of result) line.words.sort((a, b) => a.xMin - b.xMin);
  return result.sort((a, b) => a.yMin - b.yMin);
}

export type Nutrient = "kcal" | "proteinG" | "carbsG" | "fatG" | "fibreG" | "saltG";

export interface Column {
  label: string;
  xMin: number;
  xMax: number;
  nutrient: Nutrient | null;
  /** "kJ/kcal" in one cell: the kcal figure is the second number. */
  combinedEnergy: boolean;
  per100: boolean;
}

export interface Header {
  columns: Column[];
  /** The bottom of the header, so rows start below it. */
  yMax: number;
  /** Where figures start: anything left of this is the item's name. */
  nameLimit: number;
}

/** What a header label means. */
export function classify(label: string): { nutrient: Nutrient | null; combinedEnergy: boolean; per100: boolean } {
  const text = label.toLowerCase();
  const per100 = /100\s*(g|ml)/.test(text);
  if (/kj\s*\/\s*kcal|kcal\s*\/\s*kj/.test(text)) return { nutrient: "kcal", combinedEnergy: true, per100 };
  if (/of which|saturate|sugar|mono|poly|trans/.test(text)) return { nutrient: null, combinedEnergy: false, per100 };
  if (/kcal|calorie/.test(text)) return { nutrient: "kcal", combinedEnergy: false, per100 };
  if (/protein/.test(text)) return { nutrient: "proteinG", combinedEnergy: false, per100 };
  if (/carb/.test(text)) return { nutrient: "carbsG", combinedEnergy: false, per100 };
  if (/\bfat\b|^fat/.test(text)) return { nutrient: "fatG", combinedEnergy: false, per100 };
  if (/fibre|fiber/.test(text)) return { nutrient: "fibreG", combinedEnergy: false, per100 };
  if (/salt/.test(text)) return { nutrient: "saltG", combinedEnergy: false, per100 };
  return { nutrient: null, combinedEnergy: false, per100 };
}

/** Finds the table header on a page, or null when the page has none. */
export function findHeader(pageLines: Line[]): Header | null {
  for (let index = 0; index < pageLines.length; index += 1) {
    if (!pageLines[index].words.some((word) => /protein/i.test(word.text))) continue;
    // Wrapped headers: up to two lines above and below the line naming protein, as long as
    // they're close and hold words rather than figures.
    const band = pageLines.slice(Math.max(0, index - 2), index + 3).filter((line) => {
      if (line === pageLines[index]) return true;
      const gap = Math.min(Math.abs(line.yMin - pageLines[index].yMax), Math.abs(pageLines[index].yMin - line.yMax));
      // "per 100g" is a header; a run of bare numbers is a row.
      const figures = line.words.filter((word) => /^<?\d+([.,]\d+)?$/.test(word.text)).length;
      return gap < 2 * (pageLines[index].yMax - pageLines[index].yMin) && figures < 2;
    });
    const columns = stackColumns(band.flatMap((line) => line.words));
    const found = new Set(columns.map((column) => column.nutrient).filter((nutrient) => nutrient !== null));
    const others = ["kcal", "fatG", "carbsG"].filter((nutrient) => found.has(nutrient as Nutrient)).length;
    if (!found.has("proteinG") || others < 2) continue;
    const figureColumns = columns.filter((column) => column.nutrient !== null || /kj|energy/i.test(column.label));
    const nameLimit = Math.min(...figureColumns.map((column) => column.xMin));
    return {
      columns: preferPerPortion(columns),
      yMax: Math.max(...band.map((line) => line.yMax)),
      nameLimit: nameLimit - 2,
    };
  }
  return null;
}

/** Words whose horizontal spans overlap belong to one column label, read top to bottom. */
function stackColumns(words: Word[]): Column[] {
  const groups: Word[][] = [];
  for (const word of [...words].sort((a, b) => a.xMin - b.xMin)) {
    const group = groups.find((candidate) =>
      candidate.some((other) => word.xMin < other.xMax + 1 && other.xMin < word.xMax + 1 && Math.abs(word.yMin - other.yMin) > 1),
    ) ?? groups.find((candidate) => candidate.some((other) => Math.abs(word.yMin - other.yMin) <= 1 && word.xMin - other.xMax < 6));
    if (group) group.push(word);
    else groups.push([word]);
  }
  return groups
    .map((group) => {
      const ordered = [...group].sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
      const label = ordered.map((word) => word.text).join(" ");
      return {
        label,
        xMin: Math.min(...group.map((word) => word.xMin)),
        xMax: Math.max(...group.map((word) => word.xMax)),
        ...classify(label),
      };
    })
    .sort((a, b) => a.xMin - b.xMin);
}

/** When a nutrient appears per 100 g and per portion, the portion is what someone eats. */
function preferPerPortion(columns: Column[]): Column[] {
  return columns.map((column) => {
    if (column.nutrient === null || !column.per100) return column;
    const portion = columns.some((other) => other !== column && other.nutrient === column.nutrient && !other.per100);
    return portion ? { ...column, nutrient: null } : column;
  });
}

export interface DraftRow {
  name: string;
  values: Partial<Record<Nutrient, number | null>>;
  notes: string[];
  page: number;
}

export interface Extraction {
  rows: DraftRow[];
  /** Lines that looked like section headings ("Breakfast", "Sandwiches"). */
  headings: string[];
  /** Lines with figures but no readable kcal, which were left out. */
  skipped: string[];
  pagesWithoutHeader: number[];
}

/** Reads every page's table. A page without a header continues the previous page's columns. */
export function extract(pages: Page[]): Extraction {
  const result: Extraction = { rows: [], headings: [], skipped: [], pagesWithoutHeader: [] };
  let header: Header | null = null;
  pages.forEach((page, pageIndex) => {
    const pageLines = lines(page.words);
    const pageHeader = findHeader(pageLines);
    if (pageHeader) header = pageHeader;
    else result.pagesWithoutHeader.push(pageIndex + 1);
    if (!header) return;
    const active: Header = header;
    const top = pageHeader ? pageHeader.yMax : -Infinity;
    let pendingName: string[] = [];
    let pendingLine: Line | null = null;
    let previous: { row: DraftRow; line: Line } | null = null;
    /** Two lines are one name when the gap between them is less than most of a line. */
    const tight = (upper: Line, lower: Line) => lower.yMin - upper.yMax < 0.8 * (upper.yMax - upper.yMin);

    for (const line of pageLines) {
      if (line.yMin <= top) continue;
      const nameWords = line.words.filter((word) => word.xMax <= active.nameLimit);
      const figureWords = line.words.filter((word) => word.xMax > active.nameLimit);
      const name = nameWords.map((word) => word.text).join(" ").trim();
      const values = readFigures(figureWords, active);

      if (figureWords.length === 0) {
        if (!name) continue;
        // A name line tight under an item continues that item's name.
        if (previous && pendingName.length === 0 && tight(previous.line, line)) {
          previous.row.name = `${previous.row.name} ${name}`;
          previous.line = line;
          continue;
        }
        if (pendingLine && !tight(pendingLine, line)) {
          result.headings.push(...pendingName);
          pendingName = [];
        }
        pendingName.push(name);
        pendingLine = line;
        continue;
      }

      if (values.values.kcal === undefined || values.values.kcal === null) {
        result.skipped.push([name, ...figureWords.map((word) => word.text)].join(" ").trim());
        pendingName = [];
        pendingLine = null;
        continue;
      }
      // Name lines just above the figures are the start of this item's name; ones further up
      // are a heading.
      const startsName = pendingLine !== null && tight(pendingLine, line);
      let rowName = name;
      if (startsName) {
        rowName = [...pendingName, name].filter((part) => part.length > 0).join(" ");
      } else if (pendingName.length > 0) {
        if (rowName) result.headings.push(...pendingName);
        else rowName = pendingName.join(" ");
      }
      pendingName = [];
      pendingLine = null;
      if (!rowName) {
        result.skipped.push(figureWords.map((word) => word.text).join(" "));
        continue;
      }
      const row: DraftRow = { name: rowName, values: values.values, notes: values.notes, page: pageIndex + 1 };
      result.rows.push(row);
      previous = { row, line };
    }
    result.headings.push(...pendingName);
  });
  return result;
}

function readFigures(words: Word[], header: Header): { values: Partial<Record<Nutrient, number | null>>; notes: string[] } {
  const values: Partial<Record<Nutrient, number | null>> = {};
  const notes: string[] = [];
  // Cells can hold two words ("12.3 g", "2163 / 516"), so join words under the same column.
  const cells = new Map<Column, string[]>();
  for (const word of words) {
    const centre = (word.xMin + word.xMax) / 2;
    const column = nearestColumn(header.columns, centre);
    if (!column) continue;
    cells.set(column, [...(cells.get(column) ?? []), word.text]);
  }
  for (const [column, parts] of cells) {
    if (column.nutrient === null) continue;
    const text = parts.join(" ");
    const parsed = parseFigure(text, column.combinedEnergy);
    if (parsed.note) notes.push(`${column.label}: ${parsed.note}`);
    if (values[column.nutrient] === undefined) values[column.nutrient] = parsed.value;
  }
  return { values, notes };
}

/** The column a figure sits under: the one it overlaps, else the nearest within half a column. */
function nearestColumn(columns: Column[], centre: number): Column | null {
  const inside = columns.find((column) => centre >= column.xMin - 4 && centre <= column.xMax + 4);
  if (inside) return inside;
  let best: Column | null = null;
  let bestDistance = Infinity;
  for (const column of columns) {
    const distance = Math.min(Math.abs(centre - column.xMin), Math.abs(centre - column.xMax));
    if (distance < bestDistance) {
      best = column;
      bestDistance = distance;
    }
  }
  return bestDistance <= 30 ? best : null;
}

/** A cell as a number, or null when it holds no figure. Never guesses a figure. */
export function parseFigure(text: string, combinedEnergy = false): { value: number | null; note?: string } {
  let cell = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (cell === "" || /^(-|–|—|n\/a|na|n\/k|nk)$/.test(cell)) return { value: null };
  if (/^(tr|trace)$/.test(cell)) return { value: 0, note: `"${text}" read as 0` };
  if (combinedEnergy) {
    const parts = cell.split("/").map((part) => part.trim());
    if (parts.length !== 2) return { value: null, note: `"${text}" isn't a kJ/kcal pair` };
    cell = parts[1];
  }
  let note: string | undefined;
  if (cell.startsWith("<")) {
    note = `"${text}" read as ${cell.slice(1).trim()}`;
    cell = cell.slice(1).trim();
  }
  cell = cell.replace(/(kcal|kj|g|mg)$/, "").trim();
  if (/^\d+,\d+$/.test(cell)) cell = cell.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(cell)) return { value: null, note: `"${text}" isn't a number` };
  return { value: Number(cell), note };
}

/** A guess at the course from the name, for the reviewer to check. */
export function guessCourse(name: string): Course {
  const text = name.toLowerCase();
  if (/\b(latte|cappuccino|flat white|americano|espresso|mocha|coffee|tea|hot chocolate|cola|lemonade|juice|water|smoothie|shake|frappe|frappuccino|lager|ale|cider|beer|wine|pint|spritz|soda|squash|milk)\b/.test(text)) return "drink";
  if (/\b(cake|cookie|muffin|brownie|doughnut|donut|ice cream|sundae|cheesecake|tart|pudding|crumble|flapjack|pastry|croissant|pain au)\b/.test(text)) return "dessert";
  if (/\b(fries|chips|wedges|side|coleslaw|onion rings|garlic bread|corn|rice|slaw|dip)\b/.test(text)) return "side";
  if (/\b(crisps|popcorn|nuts|bar|pot|fruit)\b/.test(text)) return "snack";
  return "main";
}

export function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export interface DraftOptions {
  chainID: string;
  name: string;
  type: ChainType;
  sourceUrl: string;
  allergenInfoUrl: string;
  regions: Region[];
  today: string;
  pdfName: string;
}

/** The draft chain file, every item a draft for a person to check. */
export function draftChain(extraction: Extraction, options: DraftOptions): { chain: Chain; review: string[] } {
  const review: string[] = [];
  const used = new Set<string>();
  const items: Item[] = extraction.rows.map((row) => {
    let id = slug(row.name) || "item";
    for (let n = 2; used.has(id); n += 1) id = `${slug(row.name)}-${n}`;
    used.add(id);
    const course = guessCourse(row.name);
    review.push(`${id}: course guessed as "${course}"${row.notes.length > 0 ? `; ${row.notes.join("; ")}` : ""}`);
    const item: Item = {
      id,
      name: row.name,
      course,
      kcal: row.values.kcal as number,
      proteinG: row.values.proteinG ?? null,
      carbsG: row.values.carbsG ?? null,
      fatG: row.values.fatG ?? null,
      dietTags: [],
      sourceUrl: options.sourceUrl,
      lastChecked: options.today,
      reviewStatus: "draft",
    };
    if (typeof row.values.fibreG === "number") item.fibreG = row.values.fibreG;
    if (typeof row.values.saltG === "number") item.saltG = row.values.saltG;
    return item;
  });
  for (const heading of extraction.headings) review.push(`Heading, not an item: "${heading}"`);
  for (const skipped of extraction.skipped) review.push(`Left out, no readable kcal: "${skipped}"`);
  for (const page of extraction.pagesWithoutHeader) review.push(`Page ${page} has no header row; read with the previous page's columns`);
  const chain: Chain = {
    $schema: "../../schema/chain.schema.json",
    schemaVersion: 1,
    id: options.chainID,
    name: options.name,
    aliases: [options.name],
    type: options.type,
    regions: options.regions,
    sourceUrl: options.sourceUrl,
    allergenInfoUrl: options.allergenInfoUrl,
    lastChecked: options.today,
    isPlaceholder: false,
    notes: `Draft from ${options.pdfName} by the PDF helper on ${options.today}. Check every figure against the PDF, then change each item to "verified". Diet tags and availability still need adding.`,
    items,
  };
  return { chain, review };
}
