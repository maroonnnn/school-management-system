-- 001: link users to employees + TEACHER role (FR-AUTH-12)
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id bigint UNIQUE
    REFERENCES employees(id) ON DELETE RESTRICT;
INSERT INTO roles (name, description) VALUES ('TEACHER', 'معلم')
    ON CONFLICT (name) DO NOTHING;
COMMIT;
