# Scran data pipeline

Validates Scran's nutrition data, builds the bundle the app downloads, and prototypes the ranking formula. It moves to its own public repository at the start of Phase 1 (see `docs/architecture/data-pipeline.md`).

Needs Node 22.18 or later, which runs TypeScript directly. Run `npm ci` once to install the development dependencies: `ajv` and `ajv-formats` for the schema check, and `typescript` and `@types/node` for type-checking.

| Command | Does |
|---|---|
| `npm test` | All tests: data rules, bundle round trip, ranking behaviour and golden vectors |
| `npm run validate` | The data rules over `examples/` (add `--release` for release rules) |
| `npm run example-bundle` | Rebuilds `examples/bundle/` with a fixed timestamp |
| `npm run golden` | Rewrites `test/golden/ranking.json`. Do this only when the formula or the examples change on purpose, and say why in DECISIONS.md |
| `npm run bench` | Times the ranking on synthetic menus at full size |
| `npm run validate-schema` | The JSON Schema check over the examples and the example manifest |
| `npm run typecheck` | Type-checks every script with `tsc` |

| Folder | Holds |
|---|---|
| `schema/` | JSON Schemas, draft 2020-12 |
| `examples/` | Invented placeholder data (every file `isPlaceholder: true`) and the bundle built from it |
| `src/` | Types, the energy check, the data rules, the bundle builder, the ranking prototype |
| `scripts/` | Command-line entry points |
| `test/` | `node:test` suites, ranking scenarios and the golden vectors |

Every figure in `examples/` is made up, so no real chain's nutrition is ever invented. The release rules refuse placeholder data, so it can never be published.
