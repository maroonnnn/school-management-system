-- 006: attendance — raw event fields & immutability, duplicate handling, corrections, power outages
-- FR-ATT-06, 07, 08, 10, 12, 13, 14, 18, 19, 21 (client_event_id) ; BR-05
BEGIN;

---------------------------------------------------------------- settings
INSERT INTO settings (key, value, description) VALUES
  ('staff_work_hours', '{"start":"08:00","end":"13:30"}', 'دوام الكادر الإداري (غير المعلمين)'),
  ('duplicate_event_window_minutes', '2', 'تجاهل حدث مكرر لنفس الموظف والنوع خلال هذه المدة (FR-ATT-08)')
ON CONFLICT (key) DO NOTHING;

---------------------------------------------------------------- FR-ATT-06: raw event fields
ALTER TABLE attendance_events
    ADD COLUMN IF NOT EXISTS match_score numeric(5,4),
    ADD COLUMN IF NOT EXISTS verification_status varchar(20) NOT NULL DEFAULT 'ACCEPTED',
    ADD COLUMN IF NOT EXISTS client_event_id uuid,
    ADD COLUMN IF NOT EXISTS device_label varchar(100);
ALTER TABLE attendance_events DROP CONSTRAINT IF EXISTS chk_verification_status;
ALTER TABLE attendance_events ADD CONSTRAINT chk_verification_status
    CHECK (verification_status IN ('ACCEPTED', 'REJECTED'));
ALTER TABLE attendance_events DROP CONSTRAINT IF EXISTS chk_match_score;
ALTER TABLE attendance_events ADD CONSTRAINT chk_match_score CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 1);
-- FR-ATT-21: an offline client re-sending the same event must not create a duplicate
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_client_event ON attendance_events (client_event_id) WHERE client_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_ea_time ON attendance_events (employee_assignment_id, event_time);

---------------------------------------------------------------- FR-ATT-08 + BR-05: replace the strict IN/OUT alternation rule
-- Old rule rejected IN→IN (e.g. a forgotten OUT yesterday), which BR-05 says must be accepted and reviewed.
-- New rule: an event of the same employee+type within the duplicate window is silently ignored; everything else is kept.
CREATE OR REPLACE FUNCTION validate_attendance_sequence() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE v_window int;
BEGIN
    PERFORM pg_advisory_xact_lock(NEW.employee_assignment_id);
    SELECT (value #>> '{}')::int INTO v_window FROM settings WHERE key = 'duplicate_event_window_minutes';
    IF EXISTS (SELECT 1 FROM attendance_events
                WHERE employee_assignment_id = NEW.employee_assignment_id
                  AND event_type = NEW.event_type
                  AND abs(extract(epoch FROM event_time - NEW.event_time)) < COALESCE(v_window, 2) * 60) THEN
        RETURN NULL; -- duplicate: ignore
    END IF;
    RETURN NEW;
END;
$$;

---------------------------------------------------------------- FR-ATT-07: raw events can never be changed or deleted
CREATE OR REPLACE FUNCTION prevent_attendance_event_change() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'أحداث الحضور الخام لا تقبل التعديل أو الحذف — استخدم التصحيحات';
END;
$$;
DROP TRIGGER IF EXISTS trg_attendance_events_immutable ON attendance_events;
CREATE TRIGGER trg_attendance_events_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON attendance_events
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_attendance_event_change();

---------------------------------------------------------------- FR-ATT-12/13: corrections (separate log, principal approval, no self-approval)
CREATE TABLE IF NOT EXISTS attendance_corrections (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_assignment_id bigint NOT NULL REFERENCES employee_assignments(id),
    work_date              date NOT NULL,
    corrected_status       varchar(20) NOT NULL,
    corrected_in           time,
    corrected_out          time,
    reason                 text NOT NULL,
    proposed_by            bigint NOT NULL REFERENCES users(id),
    proposed_at            timestamptz NOT NULL DEFAULT now(),
    status                 varchar(20) NOT NULL DEFAULT 'PENDING',
    decided_by             bigint REFERENCES users(id),
    decided_at             timestamptz,
    decision_note          text,
    CONSTRAINT chk_correction_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    CONSTRAINT chk_corrected_status CHECK (corrected_status IN ('PRESENT', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'EXCUSED')),
    CONSTRAINT chk_correction_reason CHECK (length(trim(reason)) > 0),
    CONSTRAINT chk_correction_no_self_approval CHECK (decided_by IS NULL OR decided_by <> proposed_by),
    CONSTRAINT chk_correction_decision CHECK ((status = 'PENDING') = (decided_by IS NULL))
);
-- At most one pending correction per employee/day
CREATE UNIQUE INDEX IF NOT EXISTS uq_correction_pending
    ON attendance_corrections (employee_assignment_id, work_date) WHERE status = 'PENDING';

---------------------------------------------------------------- FR-ATT-18/19: power / internet outages
CREATE TABLE IF NOT EXISTS power_outages (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id   bigint NOT NULL REFERENCES schools(id),
    starts_at   timestamptz NOT NULL,
    ends_at     timestamptz NOT NULL,
    outage_type varchar(20) NOT NULL DEFAULT 'POWER',
    notes       text,
    recorded_by bigint NOT NULL REFERENCES users(id),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_outage_period CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '24 hours'),
    CONSTRAINT chk_outage_type CHECK (outage_type IN ('POWER', 'INTERNET'))
);
CREATE INDEX IF NOT EXISTS idx_outages_school_time ON power_outages (school_id, starts_at);

COMMIT;
