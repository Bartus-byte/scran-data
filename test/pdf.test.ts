import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { draftChain, extract, guessCourse, parseBboxLayout, parseFigure, type Extraction } from "../src/pdf.ts";
import { makeNutritionTable, makePdf, type PdfText } from "./pdf-fixture.ts";

const hasPdftotext = spawnSync("pdftotext", ["-v"]).status === 0;
const skip = hasPdftotext ? false : "pdftotext isn't installed (brew install poppler, or apt install poppler-utils)";

const directory = mkdtempSync(join(tmpdir(), "pdf-helper-"));

function read(pages: PdfText[][]): Extraction {
  const file = join(directory, `${Math.random().toString(36).slice(2)}.pdf`);
  writeFileSync(file, makePdf(pages));
  return extract(parseBboxLayout(execFileSync("pdftotext", ["-bbox-layout", file, "-"], { encoding: "utf8" })));
}

const standardHeaders = [
  ["Product"],
  ["Energy", "(kJ)"],
  ["Energy", "(kcal)"],
  ["Fat", "(g)"],
  ["of which", "saturates (g)"],
  ["Carbohydrate", "(g)"],
  ["of which", "sugars (g)"],
  ["Fibre", "(g)"],
  ["Protein", "(g)"],
  ["Salt", "(g)"],
];
const standardColumns = [300, 360, 420, 470, 540, 610, 670, 720, 770];

test("reads a standard table: kcal not kJ, macros, fibre and salt, wrapped names", { skip }, () => {
  const result = read([
    makeNutritionTable({
      title: "Example Kitchen nutrition",
      headers: standardHeaders,
      columns: standardColumns,
      rows: [
        { name: ["Chicken & bacon baguette"], values: ["2163", "516", "17.9", "4.1", "56.2", "3.0", "3.1", "32.0", "2.4"] },
        { name: ["Tuna crunch baguette with", "red onion"], values: ["2201", "525", "18.0", "2.1", "61.1", "4.0", "3.5", "27.3", "2.0"] },
        { name: ["Latte (regular)"], values: ["556", "133", "4.8", "3.0", "13.1", "12.9", "0", "9.0", "<0.1"] },
      ],
    }),
  ]);
  assert.deepEqual(
    result.rows.map((row) => row.name),
    ["Chicken & bacon baguette", "Tuna crunch baguette with red onion", "Latte (regular)"],
  );
  assert.deepEqual(result.rows[0].values, { kcal: 516, fatG: 17.9, carbsG: 56.2, fibreG: 3.1, proteinG: 32, saltG: 2.4 });
  assert.equal(result.rows[2].values.saltG, 0.1);
  assert.match(result.rows[2].notes.join(" "), /<0\.1/);
  assert.deepEqual(result.headings, []);
});

test("reads kJ/kcal in one cell", { skip }, () => {
  const result = read([
    makeNutritionTable({
      title: "Combined energy",
      headers: [["Item"], ["Energy", "kJ/kcal"], ["Fat", "g"], ["Carbs", "g"], ["Protein", "g"]],
      columns: [300, 400, 460, 520],
      rows: [{ name: ["Falafel wrap"], values: ["1840/440", "15.2", "55.0", "14.1"] }],
    }),
  ]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].values.kcal, 440);
  assert.equal(result.rows[0].values.proteinG, 14.1);
});

test("with per 100 g and per portion columns, takes the portion", { skip }, () => {
  const result = read([
    makeNutritionTable({
      title: "Two bases",
      headers: [["Item"], ["kcal", "per 100g"], ["Protein", "per 100g"], ["Fat", "per 100g"], ["Carbs", "per 100g"], ["kcal", "per portion"], ["Protein", "per portion"], ["Fat", "per portion"], ["Carbs", "per portion"]],
      columns: [300, 360, 420, 480, 560, 620, 680, 740],
      rows: [{ name: ["Chicken bake"], values: ["271", "10.0", "15.0", "24.0", "461", "17.0", "25.5", "40.8"] }],
    }),
  ]);
  assert.equal(result.rows[0].values.kcal, 461);
  assert.equal(result.rows[0].values.proteinG, 17);
});

test("a page without a header continues the previous page's table", { skip }, () => {
  const first = makeNutritionTable({
    title: "Page one",
    headers: standardHeaders,
    columns: standardColumns,
    rows: [{ name: ["Sausage roll"], values: ["1460", "349", "23.0", "9.8", "24.0", "1.0", "1.4", "10.0", "1.3"] }],
  });
  const second: PdfText[] = [
    { x: 40, y: 540, text: "Vegan sausage roll" },
    ...["1305", "312", "20.0", "10.0", "24.0", "1.5", "3.0", "11.0", "1.4"].map((text, column) => ({ x: standardColumns[column], y: 540, text })),
  ];
  const result = read([first, second]);
  assert.deepEqual(result.rows.map((row) => [row.name, row.page]), [["Sausage roll", 1], ["Vegan sausage roll", 2]]);
  assert.deepEqual(result.pagesWithoutHeader, [2]);
});

test("section headings aren't items, and a name above its figures joins them", { skip }, () => {
  const texts = makeNutritionTable({
    title: "Headings",
    headers: standardHeaders,
    columns: standardColumns,
    rows: [],
  });
  const row = (y: number, values: string[]) => values.map((text, column) => ({ x: standardColumns[column], y, text }));
  texts.push({ x: 40, y: 480, text: "BREAKFAST" });
  texts.push({ x: 40, y: 455, text: "Bacon roll" }, ...row(455, ["1300", "310", "11.0", "4.0", "35.0", "2.0", "1.5", "17.0", "1.9"]));
  // A wrapped name with its figures on the second line.
  texts.push({ x: 40, y: 430, text: "Sausage, egg and" });
  texts.push({ x: 40, y: 417, text: "cheese muffin" }, ...row(417, ["1880", "450", "24.0", "10.0", "33.0", "3.0", "2.0", "25.0", "2.2"]));
  const result = read([texts]);
  assert.deepEqual(result.rows.map((item) => item.name), ["Bacon roll", "Sausage, egg and cheese muffin"]);
  assert.deepEqual(result.headings, ["BREAKFAST"]);
});

test("a row without a readable kcal figure is left out and reported", { skip }, () => {
  const result = read([
    makeNutritionTable({
      title: "Missing energy",
      headers: standardHeaders,
      columns: standardColumns,
      rows: [
        { name: ["Mystery bake"], values: ["", "-", "12.0", "", "30.0", "", "", "9.0", ""] },
        { name: ["Cheese toastie"], values: ["1700", "406", "18.0", "10.0", "40.0", "3.0", "2.0", "19.0", "2.1"] },
      ],
    }),
  ]);
  assert.deepEqual(result.rows.map((row) => row.name), ["Cheese toastie"]);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /Mystery bake/);
});

test("the draft is valid against the schema, and every item is a draft from the PDF", () => {
  const extraction: Extraction = {
    rows: [
      { name: "Chicken & bacon baguette", values: { kcal: 516, proteinG: 32, carbsG: 56.2, fatG: 17.9, fibreG: 3.1, saltG: 2.4 }, notes: [], page: 1 },
      { name: "Chicken & bacon baguette", values: { kcal: 600, proteinG: 35, carbsG: 60, fatG: 20 }, notes: [], page: 2 },
      { name: "Latte", values: { kcal: 133, proteinG: 9, carbsG: 13.1, fatG: 4.8 }, notes: ['Salt (g): "<0.1" read as 0.1'], page: 1 },
    ],
    headings: ["Hot drinks"],
    skipped: [],
    pagesWithoutHeader: [],
  };
  const { chain, review } = draftChain(extraction, {
    chainID: "example-kitchen",
    name: "Example Kitchen",
    type: "cafe",
    sourceUrl: "https://example.com/nutrition.pdf",
    allergenInfoUrl: "https://example.com/allergens",
    regions: ["GB-ENG"],
    today: "2026-10-12",
    pdfName: "nutrition.pdf",
  });
  assert.deepEqual(chain.items.map((item) => item.id), ["chicken-and-bacon-baguette", "chicken-and-bacon-baguette-2", "latte"]);
  assert.ok(chain.items.every((item) => item.reviewStatus === "draft" && item.sourceUrl === "https://example.com/nutrition.pdf"));
  assert.equal(chain.isPlaceholder, false);
  assert.equal(chain.items[2].course, "drink");
  assert.ok(review.some((line) => line.includes("Hot drinks")));

  const root = join(import.meta.dirname, "..", "schema");
  const require = createRequire(import.meta.url);
  const Ajv2020 = require("ajv/dist/2020").default;
  const addFormats = require("ajv-formats").default;
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  for (const name of ["common", "chain"]) {
    ajv.addSchema(JSON.parse(readFileSync(join(root, `${name}.schema.json`), "utf8")));
  }
  const schema = JSON.parse(readFileSync(join(root, "chain.schema.json"), "utf8"));
  const check = ajv.getSchema(schema.$id);
  assert.ok(check, "chain schema should load");
  assert.ok(check(chain), JSON.stringify(check.errors, null, 2));
});

test("figures parse as printed, and anything unclear is null", () => {
  assert.deepEqual(parseFigure("12.3"), { value: 12.3, note: undefined });
  assert.equal(parseFigure("12.3g").value, 12.3);
  assert.equal(parseFigure("12,3").value, 12.3);
  assert.equal(parseFigure("516kcal").value, 516);
  assert.equal(parseFigure("-").value, null);
  assert.equal(parseFigure("n/a").value, null);
  assert.equal(parseFigure("").value, null);
  assert.equal(parseFigure("Tr").value, 0);
  assert.equal(parseFigure("<0.5").value, 0.5);
  assert.match(parseFigure("<0.5").note ?? "", /<0\.5/);
  assert.equal(parseFigure("2163 / 516", true).value, 516);
  assert.equal(parseFigure("516", true).value, null);
  assert.equal(parseFigure("about 5").value, null);
});

test("the course is guessed from the name, for review", () => {
  assert.equal(guessCourse("Flat white (oat)"), "drink");
  assert.equal(guessCourse("Chocolate brownie"), "dessert");
  assert.equal(guessCourse("Skin-on fries"), "side");
  assert.equal(guessCourse("Chicken Caesar wrap"), "main");
});

test("the helper never overwrites a file without --force", { skip }, () => {
  const out = join(directory, "existing.json");
  writeFileSync(out, "{}\n");
  const pdf = join(directory, "table.pdf");
  writeFileSync(pdf, makePdf([makeNutritionTable({ title: "T", headers: standardHeaders, columns: standardColumns, rows: [{ name: ["Wrap"], values: ["1700", "406", "18.0", "10.0", "40.0", "3.0", "2.0", "19.0", "2.1"] }] })]));
  const script = join(import.meta.dirname, "..", "scripts", "pdf-extract.ts");
  const args = [script, pdf, "example-kitchen", "--name", "Example Kitchen", "--source-url", "https://example.com/n.pdf", "--out", out, "--today", "2026-10-12"];
  const refused = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.equal(readFileSync(out, "utf8"), "{}\n");
  const forced = spawnSync(process.execPath, [...args, "--force"], { encoding: "utf8" });
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).items.length, 1);
});
