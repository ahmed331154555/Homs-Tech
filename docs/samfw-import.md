# SamFW public-page import (HOMS TECH)

## What is implemented
- Admin-only, permission-protected import endpoint: `POST /api/admin/firmware/samfw/import`.
- Accepts only HTTPS URLs on `samfw.com` or its subdomains, specifically `/firmware/...` detail pages.
- Fetches one public page with redirect re-validation, timeout and a 2 MiB HTML limit.
- Extracts a display title, Samsung model, region/build from the URL and an approximate size when present.
- Deduplicates using the normalized source page URL.
- Stores the public **source page URL** in the existing Firmware link field, so users land on the SamFW page rather than relying on an expiring direct-download URL.

## Important limits
This is a manual, one-page import primitive, not a complete catalog crawler or scheduled sync. It does not download firmware binaries, generate direct links, bypass Google sign-in, or renew SamFW links. The public page's metadata/size may not always be present or stable. A permanent download requires an authorized source that explicitly supports it.

## Endpoint
Authenticated admin request:
```http
POST /api/admin/firmware/samfw/import
Content-Type: application/json

{"url":"https://samfw.com/firmware/SM-G990U3/XAA/BUILD","parentId":123}
```
Set `parentId` to an existing Firmware folder ID or `null` for the root. The endpoint returns the saved item or an indication that the source page was already imported.

## Testing
Run `npm test`. Tests were added for URL allowlisting and metadata parsing. No live SamFW request or Render deployment is performed by this change.
