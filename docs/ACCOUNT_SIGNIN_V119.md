# TekStation v119 — Account sign-in & mobile Data Vault UX

- Dedicated Sign in action added to the main command bar.
- Data Vault button is now width-constrained and horizontal on mobile rather than collapsing into a tall vertical pill.
- Dedicated Sign in opens Data Vault directly on account fields and focuses the email input.
- Existing account creation, recovery-code backup, IndexedDB vault, D1 sync, and encrypted cloud storage remain intact.

## Where account data lives
- `tekstation_accounts`: account id, SHA-256 email hash, random salt, PBKDF2/HMAC-derived verifier, timestamps.
- `tekstation_sessions`: hashed session token, account id, expiration/creation timestamps.
- `tekstation_account_vault`: encrypted vault blob and updated timestamp.
- The plaintext password is not stored in D1.
- Browser-side session/account material is retained in IndexedDB so a local session can survive page reloads.
