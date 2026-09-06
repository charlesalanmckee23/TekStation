# TekStation v123 account authentication

Registration/login no longer performs PBKDF2 password derivation inside the Cloudflare Worker. The browser derives the password material with Web Crypto; the Worker stores only a tagged derived authentication key in the existing verifier column and uses a short-lived HMAC challenge for login.

Run `D1_MIGRATION_V123.sql` once in the existing `tekstation_db` database. It adds `tekstation_login_challenges` only.

No existing table is dropped and no existing vault data is deleted.
