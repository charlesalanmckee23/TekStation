# TekStation Data Vault v116

## D1 schema
Run `D1_SCHEMA.sql` against the `tekstation_db` database. It creates the legacy recovery-code vault plus `tekstation_accounts`, `tekstation_sessions`, and `tekstation_account_vault`.

## Pages binding
In Workers & Pages → the TekStation project → Settings → Bindings, add a D1 binding with:

- Variable name: `TEKSTATION_DB`
- Database: `tekstation_db`

Redeploy after changing the binding.

## Accounts
TekStation accounts are optional. Users can create an account or remain in Local Mode. Account vault payloads are encrypted in the browser before upload. The Worker stores only a password verifier, account salt, session records, and ciphertext.

The account design intentionally does not include password reset by email. The password is part of the vault encryption key, so users must keep a backup export or remember the password.

## Legacy recovery code
The existing recovery sync-code endpoints remain compatible with prior Data Vault users.


### v120 account recovery

v120 adds the recovery-key password reset flow. For an existing v116/v119 D1 database, run `D1_MIGRATION_V120.sql` to add only the recovery tables. `D1_SCHEMA.sql` is the full idempotent schema for a fresh or already-created database.

The account recovery key is generated in the browser and should be stored by the user. It is not stored in plaintext in D1.
