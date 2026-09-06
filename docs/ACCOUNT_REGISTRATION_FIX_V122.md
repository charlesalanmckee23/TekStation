# TekStation v122 — account registration reliability

Fixes the v121 registration path by creating the account row and initial session in a single D1 batch transaction, avoiding orphaned accounts if session creation fails.

Also fixes recovery-key hash generation immediately after registration and adds `POST /api/account` with `{action:"health"}` as a non-sensitive database health check.

No D1 schema migration is required for v122; it uses the tables already created for v120.
