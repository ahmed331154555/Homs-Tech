# HOMS TECH — Resend email configuration

This document describes the environment configuration used by the server. Never commit API keys, webhook secrets, or private mailbox credentials.

## Required for outbound email

Set these variables in the hosting provider's environment settings:

- `RESEND_API_KEY`: Resend API key used by the server.
- `RESEND_FROM_EMAIL`: sender address on a domain verified in Resend.

The server intentionally skips customer/order email sending when the sender address is not configured. It does not fall back to Resend's onboarding sender.

## Inbound email webhook

Configure a Resend webhook for the `email.received` event and point it to:

`https://homs-tech.nl/api/webhooks/resend/inbound`

Set:

- `RESEND_WEBHOOK_SECRET`: the signing secret supplied by Resend for this webhook.
- `RESEND_API_KEY`: required so the server can retrieve the full received message.
- `RESEND_FROM_EMAIL`: used as the sender for the short owner notification.
- `RESEND_INBOUND_NOTIFY_EMAIL`: optional destination for the owner notification.

If `RESEND_INBOUND_NOTIFY_EMAIL` is not set, the inbound webhook falls back to `ORDER_NOTIFICATION_EMAIL`, then `REPAIR_REQUEST_EMAIL`. If no recipient is configured, the message is still saved to the admin inbox and no notification email is sent.

The webhook route must remain registered before the global `express.json()` middleware. It uses the unmodified raw request body to validate the Svix signature.

## Buyback notifications

The owner notification for a device buyback uses:

1. `BUYBACK_NOTIFICATION_EMAIL`
2. `ORDER_NOTIFICATION_EMAIL`
3. `REPAIR_REQUEST_EMAIL`

The customer confirmation email is independent of the owner notification. If no owner recipient is configured, the customer confirmation can still be sent and the owner notification is skipped.

## Contact form and other order notifications

- Contact form owner notifications use `REPAIR_REQUEST_EMAIL`, then `ORDER_NOTIFICATION_EMAIL`.
- Webshop order owner notifications use `ORDER_NOTIFICATION_EMAIL`, then `REPAIR_REQUEST_EMAIL`.
- Repair request notifications use the configured repair/order notification recipient.

## Safe deployment checklist

- Add or update variables in the hosting dashboard, not in source files.
- Use a verified sender domain in Resend.
- Copy the webhook signing secret only into `RESEND_WEBHOOK_SECRET`.
- Confirm the Resend webhook is enabled for `email.received`.
- Send a test inbound email and confirm it appears once in the HOMS TECH admin inbox.
- Confirm owner notifications arrive at the configured notification address.
- Do not publish or deploy this branch to the live site until the full test suite and webhook checks pass.
