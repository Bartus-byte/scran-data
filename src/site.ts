// Renders the static website from a data set. Only what a release bundle would publish is shown:
// chains that aren't placeholders, and their verified, non-placeholder items.
//
// For now that's the home page, the app's privacy policy, robots.txt and sitemap.xml. The per-chain
// and per-meal-deal pages ("Best high-protein orders at <Chain>") follow once real chain data is
// in data/.

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
    { path: "privacy/index.html", contents: privacyPage(options.style) },
    { path: "robots.txt", contents: `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n` },
    {
      path: "sitemap.xml",
      contents:
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        `  <url><loc>${SITE_URL}</loc><lastmod>${day}</lastmod></url>\n` +
        `  <url><loc>${SITE_URL}privacy/</loc><lastmod>${PRIVACY_UPDATED}</lastmod></url>\n` +
        `</urlset>\n`,
    },
  ];
}

/** When the privacy policy last changed. Change it with the text, not on every build. */
export const PRIVACY_UPDATED = "2026-10-12";

/** The app's privacy policy, linked from its paywall and About screen. */
function privacyPage(style: string): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scran privacy policy</title>
<meta name="description" content="How the Scran iPhone app handles your data: no accounts, no analytics, no advertising.">
<link rel="canonical" href="${SITE_URL}privacy/">
<style>
${style.trim()}
</style>
</head>
<body>
<main>
<h1>Privacy policy</h1>
<p>Scran is an iPhone app that suggests what to order at UK chains for the calories and protein you have left. It has no accounts, no analytics and no advertising, and the developer doesn't collect your data.</p>
<div class="card">
<h2>What stays on your iPhone</h2>
<p>Your goal, body details, targets and food log are stored only on your iPhone. They're never sent to iCloud, to the developer or to anyone else. They're included in your iPhone's own encrypted backup, which you control.</p>
<h2>Apple Health</h2>
<p>If you allow it, Scran reads today's calories and protein from Apple Health, and your height, weight, age and sex to suggest targets. It saves the meals you log to Apple Health. Health data never leaves your iPhone through Scran and is never used for advertising. You can change what Scran may read or write in the Health app at any time.</p>
<h2>Location</h2>
<p>While you're using the app, Scran uses your location to find chains and supermarkets within walking distance, through Apple Maps. It doesn't store your location or send it to the developer.</p>
<h2>iCloud</h2>
<p>Your favourite orders, how you split your day across meals, and any corrections you make to the menu data sync between your devices through your own private iCloud database. The developer can't read it.</p>
<h2>Menu data</h2>
<p>Scran downloads its nutrition data from this website, hosted by GitHub Pages. The request carries no identifiers. GitHub may log IP addresses for security, under <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">its privacy statement</a>.</p>
<h2>Barcodes</h2>
<p>When you check a barcode that isn't in Scran's own data, Scran may look it up in Open Food Facts, sending only the barcode. Open Food Facts keeps server logs under <a href="https://world.openfoodfacts.org/privacy">its privacy policy</a>.</p>
<h2>Purchases</h2>
<p>Subscriptions are handled by Apple. The developer never sees your payment details or Apple Account.</p>
<h2>Emails</h2>
<p>If you report a data error or get in touch, you send an email from your own mail app. It's used only to reply and to fix the data, and isn't shared.</p>
<h2>Changes</h2>
<p>If this policy changes, this page will say so and show the new date.</p>
</div>
<p class="note">Last updated ${PRIVACY_UPDATED}.</p>
<p class="note"><a href="${SITE_URL}">Scran</a></p>
</main>
</body>
</html>
`;
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
