-- 003: SUPERVISOR (موجّه) role + approval workflow for results (FR-DATA-07, FR-AUTH-13)
BEGIN;
INSERT INTO roles (name, description) VALUES ('SUPERVISOR', 'موجّه')
    ON CONFLICT (name) DO NOTHING;

ALTER TABLE assessments
    ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN IF NOT EXISTS created_by bigint REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
    ADD COLUMN IF NOT EXISTS approved_by bigint REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS approved_at timestamptz,
    ADD COLUMN IF NOT EXISTS return_note text;

ALTER TABLE assessments DROP CONSTRAINT IF EXISTS chk_assessment_status;
ALTER TABLE assessments ADD CONSTRAINT chk_assessment_status
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED'));
ALTER TABLE assessments DROP CONSTRAINT IF EXISTS chk_assessment_approval;
ALTER TABLE assessments ADD CONSTRAINT chk_assessment_approval
    CHECK (status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL));

-- Approved results are frozen: no grade change once the assessment is APPROVED
CREATE OR REPLACE FUNCTION prevent_approved_grade_change() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE v_status varchar(20);
BEGIN
    SELECT status INTO v_status FROM assessments
     WHERE id = COALESCE(NEW.assessment_id, OLD.assessment_id);
    IF v_status = 'APPROVED' THEN
        RAISE EXCEPTION 'لا يمكن تعديل علامات نتيجة معتمدة';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_grades_frozen_after_approval ON grades;
CREATE TRIGGER trg_grades_frozen_after_approval
    BEFORE INSERT OR UPDATE OR DELETE ON grades
    FOR EACH ROW EXECUTE FUNCTION prevent_approved_grade_change();
COMMIT;
