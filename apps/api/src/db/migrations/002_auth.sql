-- 002_auth — authentication columns and refresh token store

-- Add password hash to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Refresh tokens — one row per active session per user.
-- Revoked by deleting the row. Expired rows cleaned up by cron or on login.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL UNIQUE, -- SHA-256 of the raw token
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ,
  user_agent   TEXT,
  ip_address   TEXT
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
  ON refresh_tokens(user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
  ON refresh_tokens(expires_at)
  WHERE revoked_at IS NULL;

-- Partial unique index: one active token per user per device (user_agent).
-- Multiple devices → multiple rows.
