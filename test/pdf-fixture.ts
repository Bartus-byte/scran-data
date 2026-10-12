// Writes small PDFs for the PDF helper's tests: text placed at exact positions, in the
// standard Helvetica font, which every PDF reader has. No PDF library needed.
//
// Every figure in these PDFs is invented; they test the reading, not any chain's data.

export interface PdfText {
  x: number;
  /** From the bottom of the page, as PDF coordinates run. */
  y: number;
  text: string;
  size?: number;
}

/** One page per entry, each A4 landscape (842 × 595 pt). */
export function makePdf(pages: PdfText[][]): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1: catalog, 2: pages, 3: font, then a page and a content stream per page.
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  let next = 4;
  for (const texts of pages) {
    const pageId = next;
    const contentId = next + 1;
    next += 2;
    pageIds.push(pageId);
    const content = texts
      .map(({ x, y, text, size = 9 }) => `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escape(text)}) Tj ET`)
      .join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(body, "latin1");
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** PDF string escapes; text is kept to Latin-1, which WinAnsi covers. */
function escape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** A nutrition table laid out the way chains' PDFs usually are: a header, then a row per item. */
export interface TableRow {
  name: string[];
  values: string[];
}

export function makeNutritionTable(options: {
  title: string;
  headers: string[][];
  rows: TableRow[];
  /** Left edge of each column after the name column. */
  columns: number[];
  top?: number;
  lineHeight?: number;
}): PdfText[] {
  const texts: PdfText[] = [{ x: 40, y: 560, text: options.title, size: 14 }];
  const lineHeight = options.lineHeight ?? 13;
  let y = options.top ?? 520;
  // Headers may wrap over two lines ("Energy" over "kcal").
  const headerLines = Math.max(...options.headers.map((header) => header.length));
  for (let line = 0; line < headerLines; line += 1) {
    options.headers.forEach((header, column) => {
      const text = header[line];
      if (text) texts.push({ x: column === 0 ? 40 : options.columns[column - 1], y, text });
    });
    y -= lineHeight;
  }
  y -= 4;
  for (const row of options.rows) {
    const lines = Math.max(row.name.length, 1);
    row.name.forEach((part, index) => texts.push({ x: 40, y: y - index * lineHeight, text: part }));
    row.values.forEach((value, column) => {
      if (value) texts.push({ x: options.columns[column], y, text: value });
    });
    y -= lines * lineHeight + 3;
  }
  return texts;
}
