# TekStation v128 — Resend Email Delivery

The registration flow now requests a transactional welcome email through Resend.

## Cloudflare secret
Set `RESEND_API_KEY` as a **Secret** on the Production environment. Never put it in HTML/JavaScript.

## Sending domain
The sender is `TekStation <welcome@tekstation.app>`. `tekstation.app` must remain verified in Resend.

## Behavior
- D1 account/session creation completes first.
- The welcome email is queued with `ctx.waitUntil()`.
- A Resend idempotency key of `welcome-user/<accountId>` prevents duplicate sends during retries.
- Email/provider failure is logged server-side and does not invalidate account creation.
- The client only reports that the welcome email was requested, not that it reached the inbox.
