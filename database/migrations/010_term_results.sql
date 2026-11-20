-- 010: term results (المحصّلات) replace assessments/grades (FR-DATA-07, user change 2026-11-20).
-- Teacher enters one total per student per subject per term → submits → supervisor sees it.
-- After submission only the supervisor can correct, with a mandatory reason; every correction is logged
-- (old/new/reason) and the teacher is notified personally.
BEGIN;

DROP TABLE IF EXISTS grades CASCADE;
DROP TABLE IF EXISTS assessments CASCADE;
DROP FUNCTION IF EXISTS prevent_approved_grade_change();

CREATE TABLE result_sheets (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    teaching_assignment_id bigint NOT NULL REFERENCES teaching_assignments(id),
    term smallint NOT NULL CHECK (term IN (1, 2)),
    status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED')),
    submitted_by bigint REFERENCES users(id),
    submitted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (teaching_assignment_id, term),
    CONSTRAINT chk_sheet_submitted CHECK (status <> 'SUBMITTED' OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL))
);

CREATE TABLE term_results (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sheet_id bigint NOT NULL REFERENCES result_sheets(id),
    enrollment_id bigint NOT NULL REFERENCES student_enrollments(id),
    score numeric(6,2) NOT NULL CHECK (score >= 0 AND score <= 100),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sheet_id, enrollment_id)
);

CREATE TABLE result_corrections (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    result_id bigint NOT NULL REFERENCES term_results(id),
    old_score numeric(6,2) NOT NULL,
    new_score numeric(6,2) NOT NULL,
    reason text NOT NULL CHECK (length(btrim(reason)) > 0),
    corrected_by bigint NOT NULL REFERENCES users(id),
    corrected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_result_corrections_result ON result_corrections(result_id);

-- A submitted sheet never goes back to draft.
CREATE OR REPLACE FUNCTION prevent_sheet_unsubmit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'SUBMITTED' AND NEW.status <> 'SUBMITTED' THEN
        RAISE EXCEPTION 'لا يمكن إعادة محصّلة مرفوعة إلى مسودة';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sheet_no_unsubmit BEFORE UPDATE ON result_sheets
    FOR EACH ROW EXECUTE FUNCTION prevent_sheet_unsubmit();

-- Results of a submitted sheet change only inside a supervisor correction
-- (the service sets app.result_correction = 'on' in the same transaction that logs the correction).
CREATE OR REPLACE FUNCTION protect_submitted_results() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status varchar(20);
BEGIN
    SELECT status INTO v_status FROM result_sheets WHERE id = COALESCE(NEW.sheet_id, OLD.sheet_id);
    IF v_status = 'SUBMITTED' THEN
        IF TG_OP <> 'UPDATE' OR COALESCE(current_setting('app.result_correction', true), '') <> 'on' THEN
            RAISE EXCEPTION 'المحصّلة مرفوعة — التعديل يتم بتصحيح من الموجّه فقط';
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER trg_protect_submitted_results BEFORE INSERT OR UPDATE OR DELETE ON term_results
    FOR EACH ROW EXECUTE FUNCTION protect_submitted_results();

-- Correction log is append-only.
CREATE OR REPLACE FUNCTION prevent_correction_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'سجل تصحيح المحصّلات غير قابل للتعديل أو الحذف';
END;
$$;
CREATE TRIGGER trg_result_corrections_immutable BEFORE UPDATE OR DELETE ON result_corrections
    FOR EACH ROW EXECUTE FUNCTION prevent_correction_change();

-- Personal notifications (e.g. teacher told about a correction).
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id bigint REFERENCES users(id);
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notification_target;
ALTER TABLE notifications ADD CONSTRAINT chk_notification_target
    CHECK (school_id IS NOT NULL OR directorate_id IS NOT NULL OR user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id) WHERE user_id IS NOT NULL;

COMMIT;
