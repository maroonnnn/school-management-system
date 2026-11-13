-- 004: school stage (حلقة), section track (فرع), teacher employment type (مثبّت/وكيل), settings
-- New user requirements 2026-11-13 (not in SRS v0.3 — see CLAUDE.md "متطلبات جديدة").
BEGIN;

---------------------------------------------------------------- settings
CREATE TABLE IF NOT EXISTS settings (
    key         varchar(60) PRIMARY KEY,
    value       jsonb       NOT NULL,
    description text,
    updated_by  bigint REFERENCES users(id),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (key, value, description) VALUES
  ('permanent_quota_rules', '[{"minYears":0,"quota":22},{"minYears":10,"quota":21},{"minYears":20,"quota":19}]',
   'نصاب المعلم المثبّت الأسبوعي حسب سنين الخدمة (أعلى minYears ينطبق)'),
  ('contract_lesson_rate', '15000', 'أجر الحصة للمعلم الوكيل بالليرة السورية (للعرض/التقدير فقط)'),
  ('lesson_duration_minutes', '45', 'مدة الحصة بالدقائق (FR-SCH-05)'),
  ('late_tolerance_minutes', '15', 'سماحية التأخير بالدقائق')
ON CONFLICT (key) DO NOTHING;

---------------------------------------------------------------- schools: stage replaces school_type
ALTER TABLE schools ADD COLUMN IF NOT EXISTS stage smallint;
UPDATE schools SET stage = CASE school_type
    WHEN 'PRIMARY' THEN 1 WHEN 'SECONDARY' THEN 3 ELSE 2 END
 WHERE stage IS NULL;
ALTER TABLE schools ALTER COLUMN stage SET NOT NULL;
ALTER TABLE schools DROP CONSTRAINT IF EXISTS chk_school_stage;
ALTER TABLE schools ADD CONSTRAINT chk_school_stage CHECK (stage IN (1, 2, 3));
ALTER TABLE schools DROP COLUMN IF EXISTS school_type;

-- Grade range allowed for a stage: 1 → 1..6, 2 → 7..9, 3 → 10..12
CREATE OR REPLACE FUNCTION stage_allows_grade(p_stage smallint, p_grade integer) RETURNS boolean
    LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_stage WHEN 1 THEN p_grade BETWEEN 1 AND 6
                        WHEN 2 THEN p_grade BETWEEN 7 AND 9
                        WHEN 3 THEN p_grade BETWEEN 10 AND 12 ELSE false END
$$;

CREATE OR REPLACE FUNCTION validate_class_grade_stage() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE v_stage smallint;
BEGIN
    SELECT stage INTO v_stage FROM schools WHERE id = NEW.school_id;
    IF NOT stage_allows_grade(v_stage, NEW.grade_level) THEN
        RAISE EXCEPTION 'الصف % لا يتبع لحلقة هذه المدرسة', NEW.grade_level;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_class_grade_stage ON classes;
CREATE TRIGGER trg_class_grade_stage BEFORE INSERT OR UPDATE OF grade_level, school_id ON classes
    FOR EACH ROW EXECUTE FUNCTION validate_class_grade_stage();

-- Changing a school's stage must not orphan existing classes
CREATE OR REPLACE FUNCTION validate_school_stage_change() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM classes c WHERE c.school_id = NEW.id
                AND NOT stage_allows_grade(NEW.stage, c.grade_level)) THEN
        RAISE EXCEPTION 'لا يمكن تغيير الحلقة: يوجد صفوف لا تتبع للحلقة الجديدة';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_school_stage_change ON schools;
CREATE TRIGGER trg_school_stage_change BEFORE UPDATE OF stage ON schools
    FOR EACH ROW EXECUTE FUNCTION validate_school_stage_change();

---------------------------------------------------------------- sections: track (stage 3 only)
ALTER TABLE sections ADD COLUMN IF NOT EXISTS track varchar(30);
ALTER TABLE sections DROP CONSTRAINT IF EXISTS chk_section_track;
ALTER TABLE sections ADD CONSTRAINT chk_section_track CHECK (track IS NULL OR track IN
    ('GENERAL_SCIENTIFIC', 'GENERAL_LITERARY', 'COMMERCIAL', 'INDUSTRIAL'));

CREATE OR REPLACE FUNCTION validate_section_track() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE v_stage smallint;
BEGIN
    SELECT s.stage INTO v_stage FROM classes c JOIN schools s ON s.id = c.school_id WHERE c.id = NEW.class_id;
    IF v_stage = 3 AND NEW.track IS NULL THEN
        RAISE EXCEPTION 'شعب الحلقة الثالثة يجب أن يُحدَّد فرعها';
    ELSIF v_stage <> 3 AND NEW.track IS NOT NULL THEN
        RAISE EXCEPTION 'الفرع يُحدَّد لشعب الحلقة الثالثة فقط';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_section_track ON sections;
CREATE TRIGGER trg_section_track BEFORE INSERT OR UPDATE OF track, class_id ON sections
    FOR EACH ROW EXECUTE FUNCTION validate_section_track();

---------------------------------------------------------------- teachers: permanent / contract
ALTER TABLE teacher_profiles
    ADD COLUMN IF NOT EXISTS employment_type varchar(20) NOT NULL DEFAULT 'PERMANENT',
    ADD COLUMN IF NOT EXISTS contract_weekly_hours numeric(6,2);
ALTER TABLE teacher_profiles DROP CONSTRAINT IF EXISTS chk_employment_type;
ALTER TABLE teacher_profiles ADD CONSTRAINT chk_employment_type
    CHECK (employment_type IN ('PERMANENT', 'CONTRACT'));
-- Contract teachers must have assigned weekly hours; permanent teachers must not (their quota comes from years of service)
ALTER TABLE teacher_profiles DROP CONSTRAINT IF EXISTS chk_contract_hours;
ALTER TABLE teacher_profiles ADD CONSTRAINT chk_contract_hours CHECK (
    (employment_type = 'CONTRACT' AND contract_weekly_hours > 0) OR
    (employment_type = 'PERMANENT' AND contract_weekly_hours IS NULL));

-- Only one active assignment per employee per school (a contract teacher may still have several schools)
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_assignment_per_school
    ON employee_assignments (employee_id, school_id) WHERE is_active AND school_id IS NOT NULL;

-- Years of service: from hire_date when known, else the declared years_of_experience
CREATE OR REPLACE FUNCTION years_of_service(p_employee_id bigint, p_on date DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE sql STABLE AS $$
    SELECT COALESCE(EXTRACT(YEAR FROM age(p_on, e.hire_date))::int, tp.years_of_experience, 0)
      FROM employees e LEFT JOIN teacher_profiles tp ON tp.employee_id = e.id
     WHERE e.id = p_employee_id
$$;

-- Weekly quota of a permanent teacher from settings.permanent_quota_rules
CREATE OR REPLACE FUNCTION permanent_quota(p_years integer) RETURNS integer
    LANGUAGE sql STABLE AS $$
    SELECT (r->>'quota')::int
      FROM settings, jsonb_array_elements(value) r
     WHERE key = 'permanent_quota_rules' AND (r->>'minYears')::int <= p_years
     ORDER BY (r->>'minYears')::int DESC
     LIMIT 1
$$;

-- Required weekly quota per active teacher assignment.
-- PERMANENT: from years of service (one school). CONTRACT: the hours allotted at this school.
CREATE OR REPLACE VIEW v_teacher_quota AS
SELECT ea.id AS employee_assignment_id,
       ea.employee_id,
       ea.school_id,
       tp.employment_type,
       years_of_service(ea.employee_id) AS years_of_service,
       CASE WHEN tp.employment_type = 'CONTRACT' THEN ea.weekly_quota_units
            ELSE permanent_quota(years_of_service(ea.employee_id))::numeric END AS required_weekly_quota,
       tp.contract_weekly_hours
  FROM employee_assignments ea
  JOIN teacher_profiles tp ON tp.employee_id = ea.employee_id
 WHERE ea.is_active AND ea.position_type = 'TEACHER';

-- Contract teacher: hours split across schools must not exceed the directorate allotment
CREATE OR REPLACE FUNCTION validate_contract_hours() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE v_type varchar(20); v_allot numeric; v_total numeric;
BEGIN
    IF NEW.position_type <> 'TEACHER' OR NOT NEW.is_active THEN RETURN NEW; END IF;
    SELECT employment_type, contract_weekly_hours INTO v_type, v_allot
      FROM teacher_profiles WHERE employee_id = NEW.employee_id;
    IF v_type = 'CONTRACT' THEN
        SELECT COALESCE(SUM(weekly_quota_units), 0) INTO v_total
          FROM employee_assignments
         WHERE employee_id = NEW.employee_id AND is_active AND id <> NEW.id;
        IF v_total + COALESCE(NEW.weekly_quota_units, 0) > v_allot THEN
            RAISE EXCEPTION 'مجموع ساعات الوكيل في المدارس (%) يتجاوز ساعات تكليفه (%)',
                v_total + COALESCE(NEW.weekly_quota_units, 0), v_allot;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_contract_hours ON employee_assignments;
CREATE TRIGGER trg_contract_hours BEFORE INSERT OR UPDATE ON employee_assignments
    FOR EACH ROW EXECUTE FUNCTION validate_contract_hours();

COMMIT;
