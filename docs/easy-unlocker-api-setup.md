# Easy-Unlocker API setup (HOMS TECH)

The API client is intentionally fail-closed. It will not send the key until the
official API endpoint path and authentication header have been confirmed.

Configure these Render Environment Variables on the **test service/working branch only**:

- `EASY_UNLOCKER_API_KEY`: the reseller API key (never commit it or put it in frontend code).
- `EASY_UNLOCKER_API_BASE_URL`: the official HTTPS API host/base URL. The website home page alone is not an API endpoint.
- `EASY_UNLOCKER_API_SERVICES_PATH`: the exact documented services-list path, beginning with `/`.
- `EASY_UNLOCKER_API_KEY_HEADER`: the exact documented HTTP header name used for the key.
- `EASY_UNLOCKER_API_KEY_PREFIX`: optional documented prefix such as `Bearer`; leave unset if the docs say to send the raw key.
- `EASY_UNLOCKER_API_TIMEOUT_MS`: optional timeout, defaults to 10000.

Do not guess the endpoint, header, prefix, query parameters, or request body. Easy-Unlocker
has not yet provided a working request example, and the website's API-document download
returned HTTP 404. The client currently supports JSON responses and preserves non-JSON
responses as text for inspection; automatic catalog sync should only be enabled after the
actual response schema is known.

The API client does not place orders. Ordering/status endpoints require separate official
documentation and should be implemented only after the read-only services call is verified.
