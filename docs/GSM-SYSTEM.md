# HOMS TECH GSM system — staged implementation

## Current architecture
- Public catalog: `gsm-services.html` reads the existing `/api/site` payload and renders the configured local catalog.
- Admin editor: `admin/index.html` already edits the `gsmServices` data in the existing site settings.
- Orders: GSM service requests are stored by the existing `POST /api/orders` flow and listed in the existing GSM Orders admin view. The details view displays custom fields as readable JSON.
- Manual execution log: admins with `orders.update` can save a supplier reference, internal note, and returned result/code on a GSM order using `PUT /api/admin/orders/:id/execution`. This is a HOMS TECH-only record and does not submit anything to the supplier. Inputs are length-limited and the server rejects common repair/webshop categories.
- Manual order lifecycle: admins with `orders.update` can track `Nieuw`, `In behandeling`, `Wacht op klant`, `Wacht op leverancier`, `Resultaat ontvangen`, `Mislukt`, `Voltooid`, and `Geannuleerd`. These are HOMS TECH internal statuses only; they do not submit jobs to Easy-Unlocker or confirm supplier activity.
- Server-side validation: catalog prices and required fields come from the saved service record; dropdown submissions are checked against the saved allowlist. The shared order endpoint continues to accept non-GSM repair categories.
- Provider boundary: `lib/gsm-provider.js` validates supported categories and normalizes local service records. It is deliberately independent of the Easy-Unlocker protocol.

## New protected endpoints
- `GET /api/admin/gsm/provider-status`: admin permission `gsm.view`; returns service counts and readiness without returning secrets or making upstream requests.
- `GET /api/admin/gsm/catalog`: admin permission `gsm.view`; returns the local catalog for future adapter integration.

## Categories verified from the user's account screenshots
- The visible `Place an order` menu contains `Server services`, `IMEI Service`, and `Remote Orders`.
- The visible `Order History` menu contains `IMEI Orders`, `Server Orders`, `Remote Orders`, `Retail Orders`, and `Advanced History`.
- The server-service picker screenshot shows a service selector and examples of digital activation / tool-credit services; the exact full catalog and every option are not yet readable.
- The admin labels for the three visible order categories now match the account wording. `FRP` and `Firmware` remain preserved as local catalog buckets but are explicitly marked for verification; they are not confirmed as top-level Easy-Unlocker order categories by the screenshots.
- Do not create a `Retail Orders` service category from the history menu alone; it is currently verified as an order-history filter/category, not as a confirmed new-order menu item.

## Server order form patterns observed in account screenshots
- `SKUNLOCKER Activation Tool 6 Months Android Only` was shown at 21 credits with fields `Qnt`, `EMAIL`, `Notes`, `Comments`, and `Response e-mail`; delivery shown as 1–24 hours and cancellable.
- `Piranha Tool 12 Months` was shown at 32 credits with `Email`, `Notes`, `Comments`, and `Response e-mail`; the page displayed quantity 1 and a delivery estimate of 1 minute.
- `ShellTool - 12 Months Instant Activation` was shown at 38.5 credits with the same email/notes/comments/response-email pattern and a 1–2 minute delivery estimate.
- The admin editor now offers an opt-in `Server-velden invullen` preset for server services. It adds common fields without replacing existing custom fields; it adds quantity only when the service name contains `SKUNLOCKER`. The preset is a convenience based on observed examples, not a supplier API schema.
- Supplier credit prices, delivery estimates, and cancellation flags are observations from screenshots only; do not treat them as live prices or promise the same delivery time to HOMS TECH customers.

## Easy-Unlocker API status
No upstream requests are enabled yet. Do not assume an API base URL, authentication scheme, endpoint, payload, or order-status model. Only implement an Easy-Unlocker adapter after receiving official documentation and confirming the account has API access.

Expected future adapter contract:
- list services and service categories
- list service options / required fields
- submit a service order
- check order status / result
- map upstream service IDs and statuses to stable HOMS TECH IDs and order states
- handle timeouts, rate limits, retries and duplicate-submit protection

## Safety and data preservation
- Keep changes on `build-gsm-system-2026-10-10` until reviewed and tested.
- Do not deploy this branch to production while it is still being developed.
- Preserve existing `site_settings.gsmServices` data and unrelated website fields.
- Do not expose supplier source prices or API credentials to public clients.
- Do not change existing customer prices based on upstream currency without an explicit pricing policy.
- Use test orders / sandbox capabilities before enabling real provider submissions.

## Tests
Run `npm run test:gsm` to exercise provider normalization, local catalog preservation, required dynamic fields, and dropdown allowlist validation. The GitHub Actions workflow also syntax-checks `server.js`, the provider, the storefront inline JavaScript, and the admin inline JavaScript.
