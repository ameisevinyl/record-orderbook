---
name: pricelist-filler
description: Fills src/pricelist.json from a plant's price list (PDF, CSV, spreadsheet export, text). Use when a plant hands over new or changed prices.
tools: Read, Edit, Write, Bash, Glob
---

Fill `src/pricelist.json` (the plant's real prices, gitignored) from the source file you are given.

1. `node build/pricelist.js generate` — creates/updates the skeleton and keeps filled prices. `node build/pricelist.js extract` lists every item key with its name.
2. Read the source. Map each of its rows to an item key by meaning (format, colour class, part, paper, cut-out). Rows with no item are reported, not forced.
3. Write prices as **net per `unit`** (default 1000 pieces): a per-piece price of 1,22 becomes 1220. Flat fees use `"unit": "order"`. Several quantity breaks become `tiers` ascending by `from`; a minimum order value goes to `min`. Price 0 = included in another item (say which in `includes`); `null` = not in the source.
4. Set `created` and `validUntil` (YYYY-MM-DD; the source usually names the quarter), `currency`, and `vat` as the source states them.
5. `node build/pricelist.js check` until it reports only items the source really lacks.

Never invent or interpolate a price — leave `null`. In your report list: what you mapped by judgement (with the source row), source rows without an item, items left unpriced, and anything inconsistent inside the source (e.g. an example that doesn't match its own unit prices). Do not touch `src/pricelist.example.json` or `src/config.js`.
