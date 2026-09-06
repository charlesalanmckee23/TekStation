# TekStation v120 — Account Password Recovery

## What changed

v120 adds a recovery-key flow for TekStation accounts. The recovery key is a high-entropy secret generated in the browser. It is shown once when account recovery is configured and should be stored offline by the user.

## Recovery design

- The TekStation password is never stored in plaintext.
- D1 stores an authentication verifier, not the password.
- The encrypted TekStation vault remains encrypted with a stable vault key.
- That vault key is stored in D1 only as an encrypted envelope:
  - `password_wrap`: vault key encrypted under a key derived from the account password.
  - `recovery_wrap`: vault key encrypted under a key derived from the recovery key.
- D1 stores only a hash of the recovery key for verification.
- Password recovery uses a short-lived, one-time recovery session.
- The browser decrypts the vault key with the recovery key, derives the new password verifier/wrap key locally, and sends only the new verifier plus encrypted key wrap back to D1.
- The existing encrypted vault blob is not decrypted by the server and does not need to be re-encrypted during password reset.

## User-facing flow

1. Create an account. TekStation automatically generates a recovery key.
2. The key is displayed in the Data Vault. Copy/download it and store it safely.
3. On the dedicated Sign In flow, choose `Forgot password?`.
4. Enter the account email, recovery key, and a new 12+ character password.
5. TekStation verifies the recovery key, unwraps the existing vault key locally, re-wraps it with the new password, and restores the encrypted cloud vault.

## D1 migration

Run the updated `D1_SCHEMA.sql` once against the existing `tekstation_db` database. The new statements are additive and use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.

New tables:

- `tekstation_account_keys`
- `tekstation_recovery_sessions`

Existing tables remain unchanged:

- `tekstation_vault`
- `tekstation_accounts`
- `tekstation_sessions`
- `tekstation_account_vault`
