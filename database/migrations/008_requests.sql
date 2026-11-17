-- 008: school requests workflow (FR-REQ-01..18), notifications (FR-REQ-14), teacher account requests (user requirement 2)
BEGIN;

---------------------------------------------------------------- settings
INSERT INTO settings (key, value, description) VALUES
  ('request_priority_weights', '{"severity":0.30,"affected":0.20,"waiting":0.20,"fragility":0.15,"repetition":0.15}',
   'أوزان عوامل أولوية الطلب (FR-REQ-16, FR-ALG-02)'),
  ('request_overdue_days', '7', 'يُعتبر الطلب المفتوح متأخراً بعد هذا العدد من الأيام (FR-REQ-16)')
ON CONFLICT (key) DO NOTHING;

---------------------------------------------------------------- statuses: add RETURNED (clarification) and CLOSED
ALTER TABLE school_requests DROP CONSTRAINT IF EXISTS chk_school_request_status;
ALTER TABLE school_requests ADD CONSTRAINT chk_school_request_status CHECK (status IN
  ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RETURNED', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'));
ALTER TABLE request_status_history DROP CONSTRAINT IF EXISTS chk_history_new_status;
ALTER TABLE request_status_history ADD CONSTRAINT chk_history_new_status CHECK (new_status IN
  ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RETURNED', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'));
ALTER TABLE request_status_history DROP CONSTRAINT IF EXISTS chk_history_old_status;
ALTER TABLE request_status_history ADD CONSTRAINT chk_history_old_status CHECK (old_status IS NULL OR old_status IN
  ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RETURNED', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'));

-- FR-REQ-01 types + teacher account request
ALTER TABLE school_requests DROP CONSTRAINT IF EXISTS chk_school_request_type;
ALTER TABLE school_requests ADD CONSTRAINT chk_school_request_type CHECK (request_type IN
  ('MAINTENANCE', 'TEACHERS', 'TEXTBOOKS', 'FURNITURE', 'COMPUTERS', 'OTHER', 'TEACHER_ACCOUNT'));

---------------------------------------------------------------- FR-REQ-03 / 08 / 11 fields
ALTER TABLE school_requests
    ADD COLUMN IF NOT EXISTS severity smallint NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS affected_students integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS assigned_department varchar(150),
    ADD COLUMN IF NOT EXISTS assigned_to bigint REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS target_employee_id bigint REFERENCES employees(id),  -- TEACHER_ACCOUNT: whose account
    ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE school_requests DROP CONSTRAINT IF EXISTS chk_request_severity;
ALTER TABLE school_requests ADD CONSTRAINT chk_request_severity CHECK (severity BETWEEN 1 AND 5);
ALTER TABLE school_requests DROP CONSTRAINT IF EXISTS chk_request_affected;
ALTER TABLE school_requests ADD CONSTRAINT chk_request_affected CHECK (affected_students >= 0);
ALTER TABLE school_requests DROP CONSTRAINT IF EXISTS chk_account_request_target;
ALTER TABLE school_requests ADD CONSTRAINT chk_account_request_target
    CHECK (request_type <> 'TEACHER_ACCOUNT' OR target_employee_id IS NOT NULL);
-- FR-ALG-04: priority is computed when displayed, never stored. The legacy columns stay unused.
COMMENT ON COLUMN school_requests.priority_score IS 'غير مستخدم — الأولوية تُحسب عند العرض (FR-ALG-04)';

---------------------------------------------------------------- FR-REQ-09 / 10: comments (school ↔ directorate)
CREATE TABLE IF NOT EXISTS request_comments (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id  bigint NOT NULL REFERENCES school_requests(id) ON DELETE CASCADE,
    author_id   bigint NOT NULL REFERENCES users(id),
    body        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_comment_body CHECK (length(trim(body)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_request_comments ON request_comments (request_id, created_at);

---------------------------------------------------------------- FR-REQ-14: notifications (also the base of the MSG inbox)
CREATE TABLE IF NOT EXISTS notifications (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id    bigint REFERENCES schools(id),
    directorate_id bigint REFERENCES directorates(id),
    title        varchar(200) NOT NULL,
    body         text,
    link         varchar(200),
    request_id   bigint REFERENCES school_requests(id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_notification_target CHECK (school_id IS NOT NULL OR directorate_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_notifications_school ON notifications (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_directorate ON notifications (directorate_id, created_at DESC);
-- Read state per user (a school inbox is shared by its managers)
CREATE TABLE IF NOT EXISTS notification_reads (
    notification_id bigint NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id         bigint NOT NULL REFERENCES users(id),
    read_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, user_id)
);

COMMIT;
