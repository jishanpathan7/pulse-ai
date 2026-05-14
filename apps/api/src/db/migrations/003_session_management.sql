-- 003_session_management — pin and soft-delete for conversations

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS pinned     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_pinned
  ON conversations(user_id, pinned DESC, created_at DESC)
  WHERE deleted_at IS NULL;
