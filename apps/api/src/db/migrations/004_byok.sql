-- ─── 004_byok.sql — Bring Your Own Key tables ────────────────────────────────
-- Server-side provider catalogue (seeded, never user-written)
CREATE TABLE IF NOT EXISTS provider_definitions (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  base_url     TEXT NOT NULL,
  key_prefix   TEXT,
  docs_url     TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User API keys (encrypted at rest with AES-256-GCM)
CREATE TABLE IF NOT EXISTS user_api_keys (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id       TEXT NOT NULL REFERENCES provider_definitions(id),
  encrypted_key     TEXT NOT NULL,          -- base64(iv[12] || ciphertext || authTag[16])
  key_hint          TEXT NOT NULL,          -- last 4 chars of raw key only
  nickname          TEXT,
  is_valid          BOOLEAN NOT NULL DEFAULT TRUE,
  last_validated_at TIMESTAMPTZ,
  last_used_at      TIMESTAMPTZ,
  validation_error  TEXT,                   -- safe categorised error, never raw key
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at        TIMESTAMPTZ
);

-- One active key per provider per user (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_api_keys_active
  ON user_api_keys(user_id, provider_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user
  ON user_api_keys(user_id)
  WHERE revoked_at IS NULL;

-- Append-only audit log
CREATE TABLE IF NOT EXISTS api_key_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id      UUID REFERENCES user_api_keys(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL,
  event       TEXT NOT NULL CHECK (event IN (
    'key_added', 'key_validated', 'key_validation_failed', 'key_deleted',
    'stream_started', 'stream_completed', 'stream_failed'
  )),
  meta        JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user
  ON api_key_audit_log(user_id, created_at DESC);

-- TTL model cache (24h), keyed by provider+user
CREATE TABLE IF NOT EXISTS provider_model_cache (
  provider_id TEXT NOT NULL REFERENCES provider_definitions(id),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  models      JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (provider_id, user_id)
);

-- ─── Seed provider catalogue ─────────────────────────────────────────────────
INSERT INTO provider_definitions (id, display_name, base_url, key_prefix, docs_url) VALUES
  ('anthropic',  'Anthropic Claude', 'https://api.anthropic.com',                  'sk-ant-',  'https://console.anthropic.com/keys'),
  ('openai',     'OpenAI',           'https://api.openai.com',                     'sk-',      'https://platform.openai.com/api-keys'),
  ('gemini',     'Google Gemini',    'https://generativelanguage.googleapis.com',   NULL,       'https://aistudio.google.com/app/apikey'),
  ('grok',       'xAI Grok',         'https://api.x.ai',                           'xai-',     'https://console.x.ai/'),
  ('openrouter', 'OpenRouter',       'https://openrouter.ai/api',                  'sk-or-',   'https://openrouter.ai/keys'),
  ('together',   'Together AI',      'https://api.together.xyz',                   NULL,       'https://api.together.ai/settings/api-keys'),
  ('groq',       'Groq',             'https://api.groq.com',                       'gsk_',     'https://console.groq.com/keys')
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  base_url     = EXCLUDED.base_url,
  key_prefix   = EXCLUDED.key_prefix,
  docs_url     = EXCLUDED.docs_url,
  updated_at   = NOW();
