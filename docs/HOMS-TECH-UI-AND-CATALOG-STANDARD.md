# HOMS TECH — UI, navigation and catalog standard

## Brand system

- Primary navy: `#071d2d`
- Secondary navy: `#102d42`
- Primary action blue: `#2563eb`
- Hover blue: `#1d4ed8`
- Main text: `#172330`
- Muted text: `#64748b`
- Page canvas: `#f7f7f4` / `#f4f7fb`
- Borders: `#e3eaf2`
- White surfaces, restrained shadows, 10–16px corner radii.

Use the shared public stylesheets for common layout and navigation. Keep page-specific styles scoped to that page. The admin dashboard uses the same navy/blue brand system; status colors are reserved for status meaning rather than general decoration.

## Customer navigation groups

1. **Start** — Home, Over HOMS TECH, Contact.
2. **Winkel** — Telefoons & apparaten, Shop & accessoires, Winkelwagen.
3. **Service** — Reparatie aanvragen, Reparatieprijzen, Uw toestel verkopen.
4. **Account** — Mijn account.

The drawer must keep keyboard support, Escape-to-close, focus restoration, a visible active page, and the Shop visibility check. Do not remove the Shop visibility check when changing navigation.

## Catalog classification

### Phones and devices

- Brand → model → actual sellable variant.
- A variant is defined by the real configured combination (such as storage and color); never fabricate missing combinations.
- Only active products and active variants are displayed.
- Use the configured price and stock data. Do not invent sample products, stock counts, or prices.
- Keep product galleries and legacy image fields intact when editing catalog records.

### Shop

- Use the category saved on each product; use **Accessoires** only as a display fallback for older records with no category.
- Keep search, category filter, variant/quality selection, quantity, and stock checks available.
- The cart and checkout remain separate steps; payment and order creation are not presentation-only flows.

### Unified admin order categories

| Category | Source | Purpose |
| --- | --- | --- |
| Telefoonbestellingen | Webshop orders | Customer purchases of phones |
| Shop | Webshop orders | Accessories and other shop products |
| Inkoop | Buyback orders | Devices customers sell to HOMS TECH |
| Repair | Repair requests | Repair and price requests |

Keep the category permissions and each category's existing loader/update permission intact. Do not merge the underlying order records or change their APIs as part of a visual-only cleanup.

## Page and search rules

- Public indexable pages need a unique title, useful description, canonical URL, and a real internal navigation path.
- Product detail metadata must follow the selected product and its ID.
- Cart, checkout, payment, account, preview, and token-response pages are not public landing pages; keep them out of the sitemap and crawler index.
- Sitemap entries must resolve to existing public pages. Do not add query-free product templates or removed pages as standalone URLs.
- Customer-facing pages should use the shared footer and provide a clear path to Contact, Repair, Shop, Devices, and Privacy.

## Quality gates

Before deployment:

1. Run `node --check` across server, route, utility, asset, and test JavaScript.
2. Run the admin inline-script check.
3. Run the local asset reference check.
4. Run the complete `npm test` suite.
5. Review phone, shop, repair, buyback, cart, checkout, and mobile layouts manually.
6. Confirm that the production branch and live environment have not been changed unintentionally.

This document describes the intended presentation and data-classification contract. It does not authorize changes to payment credentials, inventory rules, order state transitions, or live deployment settings.
