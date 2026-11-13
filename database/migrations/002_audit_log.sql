-- 002: append-only audit log (FR-AUTH-07, FR-AUTH-08, FR-AUTH-10)
BEGIN;
CREATE TABLE IF NOT EXISTS audit_logs (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     bigint REFERENCES users(id),
    action      varchar(50)  NOT NULL,   -- LOGIN, LOGIN_FAILED, ACCESS_DENIED, VIEW_TEACHER_REPORT, REQUEST_STATUS_CHANGE ...
    entity_type varchar(50),
    entity_id   varchar(100),
    details     jsonb,
    ip_address  varchar(64),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_time ON audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_time ON audit_logs (action, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_audit_log_change() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'سجل التدقيق لا يقبل التعديل أو الحذف';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_logs
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_log_change();
COMMIT;
