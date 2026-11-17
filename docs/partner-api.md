# HOMS TECH Partner Store API

Base URL: `https://homs-tech.nl`

This API allows approved HOMS TECH resale partners to read assigned phone variants and submit purchase requests.

## Pricing model

- HOMS TECH sets the wholesale price for each partner and phone variant.
- The partner independently chooses the final retail price shown to its own customer and keeps the difference.
- The API's `wholesalePrice` is confidential partner pricing. Never show it as a public HOMS TECH retail price.
- Submitting an order creates a review request. It does **not** reserve or deduct inventory automatically. HOMS TECH must review and approve the request.

## Authentication

Send the API key in the HTTP Authorization header:

```http
Authorization: Bearer htp_<64-hex-characters>
Accept: application/json
```

Keys are issued once by an HOMS TECH administrator. The plaintext key is not stored and cannot be displayed again. Store it in the partner's server-side secret storage; do not expose it in browser JavaScript, public pages, or logs. An administrator can disable a partner to revoke access.

## Product feed

`GET /api/partner/v1/products`

Returns only active phone variants that have an assigned wholesale price for the authenticated partner. Out-of-stock variants are omitted when stock is explicitly zero.

Example response:

```json
{
  "count": 1,
  "products": [
    {
      "id": "phone-product-id",
      "sku": "HT-IPH-001",
      "name": "iPhone model",
      "brand": "Apple",
      "storage": "128GB",
      "color": "Black",
      "condition": "A",
      "wholesalePrice": 399.00,
      "currency": "EUR",
      "stock": 4,
      "images": ["/uploads/phone.webp"]
    }
  ]
}
```

The `id` field is the partner API `productId`; use it exactly as returned and do not replace it with a catalog row number. The `images` field includes HTTPS/relative image paths and small inline JPEG, PNG, WebP or GIF data URLs (up to 300 KB each); oversized inline images are omitted, so keep product photos optimized. Products with an explicit catalog ID keep that ID. Legacy phone records without one receive a deterministic ID derived from their brand, name and SKU (duplicate identical records are distinguished by occurrence). Keep the returned ID with the partner product mapping. The exact variant key is also required when creating an order. Build `variantKey` as:

`storage|color|condition`

For example: `128GB|Black|A`. For a product without variants, use an empty string.

## Submit a purchase request

`POST /api/partner/v1/orders`

Content-Type: `application/json`

Example request:

```json
{
  "customer": {
    "name": "Customer name",
    "email": "customer@example.com",
    "phone": "+31 6 12345678",
    "street": "Example Street",
    "houseNumber": "10",
    "postcode": "3011 AA",
    "city": "Rotterdam",
    "country": "Nederland"
  },
  "items": [
    {
      "productId": "phone-product-id",
      "variantKey": "128GB|Black|A",
      "quantity": 1
    }
  ]
}
```

The server calculates the wholesale unit price from the partner's saved price list. Any price sent by a partner client is ignored. Quantity must be a positive whole number (maximum 20 per line), and the requested total for each variant cannot exceed known available stock.

Example response:

```json
{
  "success": true,
  "order": {
    "id": 123,
    "status": "Nieuw",
    "wholesale_total": "399.00",
    "created_at": "2026-11-17T10:00:00.000Z"
  }
}
```

## Administrator endpoints

These endpoints require an authenticated HOMS TECH administrator with `site.save` permission:

- `GET /api/admin/partners` — list partners (never returns API keys).
- `POST /api/admin/partners` — create a partner and return its API key once.
- `PATCH /api/admin/partners/:id` — enable or disable a partner.
- `GET /api/admin/partners/:id/prices` — load active catalog variants and saved wholesale prices.
- `PUT /api/admin/partners/:id/prices` — replace the partner's complete wholesale price list.
- `GET /api/admin/partner-orders` — list recent partner requests and customer/shipping details.
- `PATCH /api/admin/partner-orders/:id` — update request status and internal note.

Allowed request statuses: `Nieuw`, `In behandeling`, `Goedgekeurd`, `Afgewezen`, `Verzonden`, `Afgerond`.

Customer and shipping data are available only through the administrator order endpoint. Do not forward this personal data to unrelated services.
