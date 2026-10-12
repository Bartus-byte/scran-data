# Scran data

The nutrition data behind Scran, an iPhone app that picks what to order at UK chains and supermarket meal deals for the calories and protein you have left. This repository checks the data, builds the bundle the app downloads, and publishes it with a small website on GitHub Pages.

- Website: https://bartus-byte.github.io/scran-data/
- Bundle manifest: https://bartus-byte.github.io/scran-data/data/v1/manifest.json (from the first published chain)

The app is in a separate, private repository. Don't rename this repository or the account: the address is built into every installed copy of the app.

## Rules for the data

- Every figure comes from the chain's own published nutrition information, and every item links to its source.
- Nothing is invented. The made-up figures used for development live only in `examples/`, where every file is marked `isPlaceholder: true`. The release rules refuse placeholder data, so it can't be published.
- New chains start as drafts. A person checks each figure against the source and changes the item to `"verified"`. Drafts never reach the app or the website.

## Layout

| Path | Holds |
|---|---|
| `data/chains/<chain-id>.json` | One file per chain, including supermarkets, whose meal-deal items live here |
| `data/meal-deals/<deal-id>.json` | Which items are eligible in each meal-deal slot |
| `schema/` | JSON Schemas (draft 2020-12): common, chain, meal deal, manifest |
| `src/` | Shared code: types, the energy check, the data rules, the bundle builder, the ranking prototype, the website |
| `scripts/` | Command-line entry points (below) |
| `site/` | The website's styles |
| `examples/` | Invented placeholder data and the bundle built from it, for tests and for the app's development builds |
| `test/` | `node:test` suites, ranking scenarios and the ranking golden vectors the app's tests match |
| `.github/workflows/` | `validate.yml` on every push and pull request, `publish.yml` from `main` |

## Adding or updating a chain

1. Get the chain's official nutrition PDF or page.
2. Turn it into a draft file in `data/chains/`. The PDF helper does this from a PDF (arriving in Phase 1); otherwise write it by hand against `schema/chain.schema.json`.
3. Check every figure against the source, in GitHub's web editor if you like, and change each checked item to `"verified"`.
4. Open a pull request. Validation runs on it and lists any problem, such as kcal that don't match the macros.
5. Merge. Publishing runs on `main`, and the app picks up the change within a day.

## Commands

Needs Node 22.18 or later, which runs TypeScript directly, so there's no build step. Run `npm ci` once.

| Command | Does |
|---|---|
| `npm test` | All tests: data rules, bundle round trip, ranking behaviour and golden vectors, the website |
| `npm run typecheck` | Type-checks everything with `tsc` |
| `npm run validate-data` | The schemas and the release rules over `data/` |
| `npm run bundle` | Builds the release bundle from `data/` into `public/data/v1/` |
| `npm run site` | Builds the website from `data/` into `public/` |
| `npm run validate` | The data rules over `examples/` (add `--release` for the release rules) |
| `npm run validate-schema` | The schemas over `examples/` and the example manifest |
| `npm run example-bundle` | Rebuilds `examples/bundle/` with a fixed timestamp |
| `npm run golden` | Rewrites `test/golden/ranking.json`. Only when the formula or the examples change on purpose |
| `npm run bench` | Times the ranking on synthetic full-size menus |

The development tools (`ajv`, `ajv-formats`, `typescript`, `@types/node`) are pinned in `package-lock.json`. None of them ships in the app.

## Publishing

Every push to `main` runs the checks, builds the bundle with the release rules, builds the website, and deploys both with GitHub's own Pages actions. In Settings › Pages, the source must be "GitHub Actions".

## Rights

Copyright © 2026 Bartus-byte. All rights reserved. The repository is public so that GitHub Pages can publish it, not as an open-source release, and no licence is granted to reuse the code or the data files.

The nutrition figures are each chain's own published information. Chain names and trademarks belong to their owners, and Scran isn't affiliated with any chain.
