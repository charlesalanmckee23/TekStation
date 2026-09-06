# v131 · Branded community welcome email

The registration welcome email now uses TekStation's dark TEK visual language, includes a personal thank-you note from Fresh, and summarizes the current product: Planner, implant scanning, Survivor Ops, Creatures, Crafting, Servers, Maps, and Data Vault.

The email is sent from `TekStation <welcome@tekstation.app>` through Resend using the existing `RESEND_API_KEY` secret and the same idempotency key strategy. Email delivery remains non-blocking so an email-provider failure cannot invalidate a successful account registration.
