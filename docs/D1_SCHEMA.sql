CREATE TABLE IF NOT EXISTS tekstation_vault (
  id TEXT PRIMARY KEY,
  blob TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tekstation_vault_updated ON tekstation_vault(updated_at);
CREATE TABLE IF NOT EXISTS tekstation_accounts (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tekstation_accounts_updated ON tekstation_accounts(updated_at);
CREATE TABLE IF NOT EXISTS tekstation_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES tekstation_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tekstation_sessions_account ON tekstation_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_tekstation_sessions_expires ON tekstation_sessions(expires_at);
CREATE TABLE IF NOT EXISTS tekstation_account_vault (
  account_id TEXT PRIMARY KEY,
  blob TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES tekstation_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tekstation_account_vault_updated ON tekstation_account_vault(updated_at);
CREATE TABLE IF NOT EXISTS tekstation_account_keys (
  account_id TEXT PRIMARY KEY,
  password_wrap TEXT NOT NULL,
  recovery_hash TEXT NOT NULL UNIQUE,
  recovery_wrap TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES tekstation_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tekstation_account_keys_updated ON tekstation_account_keys(updated_at);
CREATE TABLE IF NOT EXISTS tekstation_recovery_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES tekstation_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tekstation_recovery_sessions_account ON tekstation_recovery_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_tekstation_recovery_sessions_expires ON tekstation_recovery_sessions(expires_at);
