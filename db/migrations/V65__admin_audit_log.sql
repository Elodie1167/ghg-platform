-- 變更稽核 log：誰、何時、對什麼設定做了什麼動作。
-- 只記管理設定變更（工廠/產區/排放源/係數/CSR對照/年度/異常），不記一般填報
-- （填報已有 created_by/reviewed_by，見 V40/V41）。
CREATE TABLE admin_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  actor_email   text,
  action        text NOT NULL CHECK (action IN ('create', 'update', 'delete', 'run')),
  entity_type   text NOT NULL,
  entity_id     text,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_audit_log_entity ON admin_audit_log (entity_type, entity_id);
CREATE INDEX idx_admin_audit_log_created_at ON admin_audit_log (created_at);
