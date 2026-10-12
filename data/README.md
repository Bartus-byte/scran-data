# Data

The published nutrition data. Each file is checked against `schema/` and the data rules on every push, and only `reviewStatus: "verified"` figures are published.

- `chains/<chain-id>.json`: one file per chain, including supermarkets (their meal-deal items live here).
- `meal-deals/<deal-id>.json`: which items are eligible in each meal-deal slot.

New chains start as drafts from the PDF helper. A person checks every figure against the chain's official source and changes each item to `"verified"`. Drafts never reach the app or the website.

Never put invented or placeholder figures here. Those belong in `examples/`, which is never published.
