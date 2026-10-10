# HOMS TECH GSM system — staged implementation

## Current architecture
- Public catalog: `gsm-services.html` reads the existing `/api/site` payload and renders the configured local catalog.
- Admin editor: `admin/index.html` already edits the `gsmServices` data in the existing site settings.
- Orders: GSM service requests are stored by the existing `POST /api/orders` flow and listed in the existing GSM Orders admin view. The details view displays custom fields as readable JSON.
- Server-side validation: catalog prices and required fields come from the saved service record; dropdown submissions are checked against the saved allowlist. The shared order endpoint continues to accept non-GSM repair categories.
- Provider boundary: `lib/gsm-provider.js` validates supported categories and normalizes local service records. It is deliberately independent of the Easy-Unlocker protocol.

## New protected endpoints
- `GET /api/admin/gsm/provider-status`: admin permission `gsm.view`; returns service counts and readiness without returning secrets or making upstream requests.
- `GET /api/admin/gsm/catalog`: admin permission `gsm.view`; returns the local catalog for future adapter integration.

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
