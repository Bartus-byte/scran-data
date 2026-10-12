// Renders the static website from a data set. Only what a release bundle would publish is shown:
// chains that aren't placeholders, and their verified, non-placeholder items.
//
// For now that's the home page, robots.txt and sitemap.xml. The per-chain and per-meal-deal pages
// ("Best high-protein orders at <Chain>") follow once real chain data is in data/.

import type { Chain, DataSet } from "./types.ts";

export const SITE_URL = "https://bartus-byte.github.io/scran-data/";

export interface SiteFile {
  path: string;
  contents: string;
}

export interface SiteOptions {
  now: Date;
  /** The stylesheet inlined into every page (site/style.css). */
  style: string;
}

/** The chains and items the website may show, sorted by name. */
export function publishableChains(data: DataSet): Chain[] {
  return data.chains
    .map(({ value }) => value)
    .filter((chain) => !chain.isPlaceholder)
    .map((chain) => ({
      ...chain,
      items: chain.items.filter((item) => item.reviewStatus === "verified" && !item.isPlaceholder),
    }))
    .filter((chain) => chain.items.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
}

export function renderSite(data: DataSet, options: SiteOptions): SiteFile[] {
  const day = options.now.toISOString().slice(0, 10);
  const chains = publishableChains(data);
  return [
    { path: "index.html", contents: homePage(chains, day, options.style) },
    { path: "robots.txt", contents: `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n` },
    {
      path: "sitemap.xml",
      contents:
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        `  <url><loc>${SITE_URL}</loc><lastmod>${day}</lastmod></url>\n` +
        `</urlset>\n`,
    },
  ];
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function chainRow(chain: Chain): string {
  const items = chain.items.length === 1 ? "1 item" : `${chain.items.length} items`;
  return (
    `<li><strong>${escapeHtml(chain.name)}</strong> · ${items} · last checked ${escapeHtml(chain.lastChecked)}` +
    ` · <a href="${escapeHtml(chain.allergenInfoUrl)}">allergen information</a></li>`
  );
}

function homePage(chains: Chain[], day: string, style: string): string {
  const body =
    chains.length === 0
      ? `<p>No chains are published yet. Nutrition data appears here once each chain's figures have been checked against its official information.</p>`
      : `<h2>Chains</h2>\n<ul>\n${chains.map(chainRow).join("\n")}\n</ul>`;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scran: high-protein orders at UK chains</title>
<meta name="description" content="What to order at UK chains and supermarket meal deals for your calories and protein, from each chain's official nutrition information.">
<link rel="canonical" href="${SITE_URL}">
<style>
${style.trim()}
</style>
</head>
<body>
<main>
<h1>Scran</h1>
<p>What to order at UK chains and supermarket meal deals for the calories and protein you have left, ranked from each chain's own nutrition information.</p>
<div class="card">
${body}
</div>
<p class="note">Figures come from each chain's published nutrition information, and every item links to its source. Allergen information can change, so always check with the restaurant. Not medical advice.</p>
<p class="note">Updated ${escapeHtml(day)}.</p>
</main>
</body>
</html>
`;
}
