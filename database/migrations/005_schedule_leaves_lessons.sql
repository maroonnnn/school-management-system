-- 005: timetable settings, leaves/official assignments, lesson execution log (FR-SCH-05, 08, 09)
BEGIN;

---------------------------------------------------------------- settings
INSERT INTO settings (key, value, description) VALUES
  ('period_times', '{"1":"08:00","2":"08:45","3":"09:30","4":"10:30","5":"11:15","6":"12:00"}',
   'وقت بداية كل حصة (رقم الحصة → HH:MM)'),
  ('work_days', '[1,2,3,4,5]', 'أيام الدوام: 1 = الأحد ... 7 = السبت')
ON CONFLICT (key) DO NOTHING;

-- FR-SCH-05: lesson duration comes from settings, not a fixed 45-minute constraint
ALTER TABLE timetable_periods DROP CONSTRAINT IF EXISTS chk_period_duration;
CREATE OR REPLACE FUNCTION validate_period_duration() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE v_minutes int;
BEGIN
    SELECT (value #>> '{}')::int INTO v_minutes FROM settings WHERE key = 'lesson_duration_minutes';
    IF NEW.end_time - NEW.start_time <> make_interval(mins => COALESCE(v_minutes, 45)) THEN
        RAISE EXCEPTION 'مدة الحصة يجب أن تكون % دقيقة', COALESCE(v_minutes, 45);
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_period_duration ON timetable_periods;
CREATE TRIGGER trg_period_duration BEFORE INSERT OR UPDATE OF start_time, end_time ON timetable_periods
    FOR EACH ROW EXECUTE FUNCTION validate_period_duration();

-- A teacher cannot be in two places at once (same day + period), across all schools
CREATE OR REPLACE FUNCTION validate_teacher_slot() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE v_emp bigint; v_clash text;
BEGIN
    SELECT ea.employee_id INTO v_emp
      FROM teaching_assignments ta JOIN employee_assignments ea ON ea.id = ta.employee_assignment_id
     WHERE ta.id = NEW.teaching_assignment_id;
    SELECT c.name || ' / ' || sc.name INTO v_clash
      FROM timetable_periods tp
      JOIN timetables t ON t.id = tp.timetable_id AND t.is_active
      JOIN teaching_assignments ta ON ta.id = tp.teaching_assignment_id
      JOIN employee_assignments ea ON ea.id = ta.employee_assignment_id
      JOIN sections sc ON sc.id = tp.section_id JOIN classes c ON c.id = sc.class_id
     WHERE ea.employee_id = v_emp AND tp.day_of_week = NEW.day_of_week
       AND tp.period_number = NEW.period_number AND tp.id <> COALESCE(NEW.id, 0)
     LIMIT 1;
    IF v_clash IS NOT NULL THEN
        RAISE EXCEPTION 'المعلم لديه حصة بنفس الوقت في %', v_clash;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_teacher_slot ON timetable_periods;
CREATE TRIGGER trg_teacher_slot BEFORE INSERT OR UPDATE OF teaching_assignment_id, day_of_week, period_number
    ON timetable_periods FOR EACH ROW EXECUTE FUNCTION validate_teacher_slot();

---------------------------------------------------------------- FR-SCH-09: leaves & official assignments
CREATE TABLE IF NOT EXISTS employee_leaves (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL REFERENCES employees(id),
    leave_type  varchar(30) NOT NULL,
    start_date  date NOT NULL,
    end_date    date NOT NULL,
    notes       text,
    created_by  bigint NOT NULL REFERENCES users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_leave_type CHECK (leave_type IN ('ANNUAL', 'SICK', 'OFFICIAL_ASSIGNMENT', 'TRAINING', 'OTHER')),
    CONSTRAINT chk_leave_dates CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_leaves_employee_dates ON employee_leaves (employee_id, start_date, end_date);

---------------------------------------------------------------- FR-SCH-08: lesson execution log (manual corrections)
-- The default status of a lesson is derived from attendance; this table stores the principal's explicit decisions
-- (e.g. a lesson made up later = COMPENSATED). Kept separate from attendance events.
CREATE TABLE IF NOT EXISTS lesson_executions (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    timetable_period_id bigint NOT NULL REFERENCES timetable_periods(id),
    lesson_date         date NOT NULL,
    status              varchar(20) NOT NULL,
    notes               text,
    recorded_by         bigint NOT NULL REFERENCES users(id),
    recorded_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_lesson_status CHECK (status IN ('EXECUTED', 'NOT_EXECUTED', 'COMPENSATED')),
    CONSTRAINT uq_lesson_execution UNIQUE (timetable_period_id, lesson_date)
);

COMMIT;
