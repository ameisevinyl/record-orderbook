# Pricelist and quote (v1)

Prices live in `src/pricelist.json`, not in `config.js`. Pure lib, no UI yet.

- **Items** are derived from CONFIG for every enabled format: records (`black`/`colour`/`random` from `vinylColor`), the products of inner sleeve / cover / inlay, reference cut, testpress, and per-format `extras` (master cut & stamper, plastic bag — declared in config so the list stays fully derived). Keys are format-scoped (`7/outerCover/cover-printed`); labels are no item, they are part of the record price.
- **Price**: net, per `unit` pieces (1000, or `"order"` = flat), in `tiers` from a quantity upwards, with an optional `min` line total. `null` = not filled in, `0` = included. `vat` (`ES`, 21) is stored for later and not applied; quote stays net.
- **Local vs template**: `src/pricelist.json` is gitignored and wins; `src/pricelist.example.json` (sample numbers) is the committed fallback, like `plant.config.local(.example).js`.
- **Tooling**: `build/pricelist.js` `extract` / `generate` (adds new items, keeps prices, drops removed ones) / `check`. `.claude/agents/pricelist-filler.md` maps a plant's own price list onto the keys; it never invents a price.
- **Quote** (`src/lib/quote.js`): tier = highest `from` reached (below the first: the first); line = `max(min, qty / unit × price)`; sleeve, cover, inlay and extras count the whole pressed quantity; colours of one class share a tier. Discounts (`id`, `percent`, optional `from`/`to`) are chosen by the caller, apply to the subtotal as their own lines, and need a date inside their window. Unpriced items are returned in `missing`, never as 0.
- **Not yet**: VAT logic, UI (customer page / plant view), quote in the order documents, repress pricing, discount stacking rules.
