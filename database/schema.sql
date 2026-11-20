--
-- PostgreSQL database dump
--

\restrict KFYL3BVzVgwEQse3vhRifDba89aIuTgUv2ZwvLvbqVu2atSSzTYCAxn5G8dKGrf

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: permanent_quota(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.permanent_quota(p_years integer) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
    SELECT (r->>'quota')::int
      FROM settings, jsonb_array_elements(value) r
     WHERE key = 'permanent_quota_rules' AND (r->>'minYears')::int <= p_years
     ORDER BY (r->>'minYears')::int DESC
     LIMIT 1
$$;


--
-- Name: prevent_attendance_event_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_attendance_event_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'أحداث الحضور الخام لا تقبل التعديل أو الحذف — استخدم التصحيحات';
END;
$$;


--
-- Name: prevent_audit_log_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_audit_log_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'سجل التدقيق لا يقبل التعديل أو الحذف';
END;
$$;


--
-- Name: prevent_correction_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_correction_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'سجل تصحيح المحصّلات غير قابل للتعديل أو الحذف';
END;
$$;


--
-- Name: prevent_report_approval_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_report_approval_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'اعتماد التقرير غير قابل للتعديل أو الحذف';
END;
$$;


--
-- Name: prevent_sheet_unsubmit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_sheet_unsubmit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.status = 'SUBMITTED' AND NEW.status <> 'SUBMITTED' THEN
        RAISE EXCEPTION 'لا يمكن إعادة محصّلة مرفوعة إلى مسودة';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: protect_sent_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_sent_message() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.status = 'SENT' THEN
        RAISE EXCEPTION 'لا يمكن حذف رسالة بعد إرسالها';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'SENT' THEN
        RAISE EXCEPTION 'لا يمكن تعديل رسالة بعد إرسالها';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: protect_sent_message_children(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_sent_message_children() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_status varchar(10);
BEGIN
    SELECT status INTO v_status FROM messages WHERE id = COALESCE(NEW.message_id, OLD.message_id);
    IF v_status = 'SENT' THEN
        IF TG_TABLE_NAME = 'message_recipients' AND TG_OP = 'UPDATE'
           AND NEW.message_id = OLD.message_id AND NEW.recipient_type = OLD.recipient_type
           AND NEW.recipient_ref_id = OLD.recipient_ref_id THEN
            RETURN NEW; -- read / acknowledge tracking is allowed
        END IF;
        RAISE EXCEPTION 'لا يمكن تعديل رسالة بعد إرسالها';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: protect_submitted_results(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_submitted_results() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: stage_allows_grade(smallint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stage_allows_grade(p_stage smallint, p_grade integer) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT CASE p_stage WHEN 1 THEN p_grade BETWEEN 1 AND 6
                        WHEN 2 THEN p_grade BETWEEN 7 AND 9
                        WHEN 3 THEN p_grade BETWEEN 10 AND 12 ELSE false END
$$;


--
-- Name: validate_attendance_sequence(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_attendance_sequence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: validate_class_grade_stage(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_class_grade_stage() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_stage smallint;
BEGIN
    SELECT stage INTO v_stage FROM schools WHERE id = NEW.school_id;
    IF NOT stage_allows_grade(v_stage, NEW.grade_level) THEN
        RAISE EXCEPTION 'الصف % لا يتبع لحلقة هذه المدرسة', NEW.grade_level;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: validate_contract_hours(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_contract_hours() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: validate_period_duration(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_period_duration() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_minutes int;
BEGIN
    SELECT (value #>> '{}')::int INTO v_minutes FROM settings WHERE key = 'lesson_duration_minutes';
    IF NEW.end_time - NEW.start_time <> make_interval(mins => COALESCE(v_minutes, 45)) THEN
        RAISE EXCEPTION 'مدة الحصة يجب أن تكون % دقيقة', COALESCE(v_minutes, 45);
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: validate_school_stage_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_school_stage_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM classes c WHERE c.school_id = NEW.id
                AND NOT stage_allows_grade(NEW.stage, c.grade_level)) THEN
        RAISE EXCEPTION 'لا يمكن تغيير الحلقة: يوجد صفوف لا تتبع للحلقة الجديدة';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: validate_section_track(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_section_track() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: validate_teacher_slot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_teacher_slot() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: years_of_service(bigint, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.years_of_service(p_employee_id bigint, p_on date DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
    SELECT COALESCE(EXTRACT(YEAR FROM age(p_on, e.hire_date))::int, tp.years_of_experience, 0)
      FROM employees e LEFT JOIN teacher_profiles tp ON tp.employee_id = e.id
     WHERE e.id = p_employee_id
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: academic_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academic_years (
    id bigint NOT NULL,
    name character varying(20) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_current boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_academic_year_dates CHECK ((end_date > start_date))
);


--
-- Name: academic_years_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.academic_years ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.academic_years_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: attendance_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_corrections (
    id bigint NOT NULL,
    employee_assignment_id bigint NOT NULL,
    work_date date NOT NULL,
    corrected_status character varying(20) NOT NULL,
    corrected_in time without time zone,
    corrected_out time without time zone,
    reason text NOT NULL,
    proposed_by bigint NOT NULL,
    proposed_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    decided_by bigint,
    decided_at timestamp with time zone,
    decision_note text,
    CONSTRAINT chk_corrected_status CHECK (((corrected_status)::text = ANY (ARRAY[('PRESENT'::character varying)::text, ('LATE'::character varying)::text, ('EARLY_LEAVE'::character varying)::text, ('ABSENT'::character varying)::text, ('EXCUSED'::character varying)::text]))),
    CONSTRAINT chk_correction_decision CHECK ((((status)::text = 'PENDING'::text) = (decided_by IS NULL))),
    CONSTRAINT chk_correction_no_self_approval CHECK (((decided_by IS NULL) OR (decided_by <> proposed_by))),
    CONSTRAINT chk_correction_reason CHECK ((length(TRIM(BOTH FROM reason)) > 0)),
    CONSTRAINT chk_correction_status CHECK (((status)::text = ANY (ARRAY[('PENDING'::character varying)::text, ('APPROVED'::character varying)::text, ('REJECTED'::character varying)::text])))
);


--
-- Name: attendance_corrections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.attendance_corrections ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.attendance_corrections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: attendance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_events (
    id bigint NOT NULL,
    employee_assignment_id bigint NOT NULL,
    event_type character varying(10) NOT NULL,
    event_time timestamp with time zone NOT NULL,
    recorded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    verification_method character varying(20) NOT NULL,
    recorded_by bigint,
    manual_reason text,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    match_score numeric(5,4),
    verification_status character varying(20) DEFAULT 'ACCEPTED'::character varying NOT NULL,
    client_event_id uuid,
    device_label character varying(100),
    CONSTRAINT attendance_events_event_type_check CHECK (((event_type)::text = ANY (ARRAY[('IN'::character varying)::text, ('OUT'::character varying)::text]))),
    CONSTRAINT attendance_events_verification_method_check CHECK (((verification_method)::text = ANY (ARRAY[('FACE'::character varying)::text, ('MANUAL'::character varying)::text, ('FINGERPRINT'::character varying)::text]))),
    CONSTRAINT chk_match_score CHECK (((match_score IS NULL) OR ((match_score >= (0)::numeric) AND (match_score <= (1)::numeric)))),
    CONSTRAINT chk_verification_status CHECK (((verification_status)::text = ANY (ARRAY[('ACCEPTED'::character varying)::text, ('REJECTED'::character varying)::text]))),
    CONSTRAINT manual_event_reason_check CHECK ((((verification_method)::text <> 'MANUAL'::text) OR ((recorded_by IS NOT NULL) AND (manual_reason IS NOT NULL) AND (length(TRIM(BOTH FROM manual_reason)) > 0))))
);


--
-- Name: attendance_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.attendance_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.attendance_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    user_id bigint,
    action character varying(50) NOT NULL,
    entity_type character varying(50),
    entity_id character varying(100),
    details jsonb,
    ip_address character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classes (
    id bigint NOT NULL,
    school_id bigint NOT NULL,
    academic_year_id bigint NOT NULL,
    name character varying(100) NOT NULL,
    grade_level integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_grade_level CHECK (((grade_level >= 1) AND (grade_level <= 12)))
);


--
-- Name: classes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.classes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.classes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: directorates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.directorates (
    id bigint NOT NULL,
    ministry_id bigint NOT NULL,
    name character varying(200) NOT NULL,
    address text,
    phone character varying(30),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: directorates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.directorates ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.directorates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: employee_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_assignments (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    school_id bigint,
    directorate_id bigint,
    position_type character varying(30) NOT NULL,
    work_schedule_type character varying(30) NOT NULL,
    weekly_quota_units numeric(6,2),
    start_date date NOT NULL,
    end_date date,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_assignment_dates CHECK (((end_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT chk_assignment_location CHECK ((((school_id IS NOT NULL) AND (directorate_id IS NULL)) OR ((school_id IS NULL) AND (directorate_id IS NOT NULL)))),
    CONSTRAINT chk_position_type CHECK (((position_type)::text = ANY (ARRAY[('TEACHER'::character varying)::text, ('PRINCIPAL'::character varying)::text, ('DEPUTY'::character varying)::text, ('ADMINISTRATIVE'::character varying)::text, ('SUPERVISOR'::character varying)::text]))),
    CONSTRAINT chk_weekly_quota CHECK (((weekly_quota_units IS NULL) OR (weekly_quota_units >= (0)::numeric))),
    CONSTRAINT chk_work_schedule CHECK (((((position_type)::text = 'TEACHER'::text) AND ((work_schedule_type)::text = 'TEACHING_TIMETABLE'::text)) OR (((position_type)::text <> 'TEACHER'::text) AND ((work_schedule_type)::text = 'FULL_DAY'::text))))
);


--
-- Name: employee_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.employee_assignments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.employee_assignments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: employee_leaves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_leaves (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    leave_type character varying(30) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    notes text,
    created_by bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_leave_dates CHECK ((end_date >= start_date)),
    CONSTRAINT chk_leave_type CHECK (((leave_type)::text = ANY (ARRAY[('ANNUAL'::character varying)::text, ('SICK'::character varying)::text, ('OFFICIAL_ASSIGNMENT'::character varying)::text, ('TRAINING'::character varying)::text, ('OTHER'::character varying)::text])))
);


--
-- Name: employee_leaves_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.employee_leaves ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.employee_leaves_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id bigint NOT NULL,
    employee_number character varying(50),
    full_name character varying(200) NOT NULL,
    phone character varying(30),
    email character varying(255),
    hire_date date,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: employees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.employees ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.employees_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: face_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.face_embeddings (
    employee_id bigint NOT NULL,
    ciphertext bytea NOT NULL,
    iv bytea NOT NULL,
    auth_tag bytea NOT NULL,
    model character varying(40) NOT NULL,
    quality jsonb,
    enrolled_by bigint NOT NULL,
    enrolled_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lesson_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lesson_executions (
    id bigint NOT NULL,
    timetable_period_id bigint NOT NULL,
    lesson_date date NOT NULL,
    status character varying(20) NOT NULL,
    notes text,
    recorded_by bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_lesson_status CHECK (((status)::text = ANY (ARRAY[('EXECUTED'::character varying)::text, ('NOT_EXECUTED'::character varying)::text, ('COMPENSATED'::character varying)::text])))
);


--
-- Name: lesson_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.lesson_executions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.lesson_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: message_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_attachments (
    id bigint NOT NULL,
    message_id bigint NOT NULL,
    file_name character varying(255) NOT NULL,
    file_path text NOT NULL,
    file_type character varying(100) NOT NULL,
    file_size bigint NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT message_attachments_file_size_check CHECK ((file_size > 0))
);


--
-- Name: message_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.message_attachments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.message_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: message_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_recipients (
    message_id bigint NOT NULL,
    recipient_type character varying(20) NOT NULL,
    recipient_ref_id bigint NOT NULL,
    opened_at timestamp with time zone,
    opened_by bigint,
    acknowledged_at timestamp with time zone,
    acknowledged_by bigint,
    CONSTRAINT chk_recipient_type CHECK (((recipient_type)::text = ANY (ARRAY[('DIRECTORATE'::character varying)::text, ('SCHOOL'::character varying)::text])))
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id bigint NOT NULL,
    kind character varying(20) NOT NULL,
    sender_type character varying(20) NOT NULL,
    sender_ref_id bigint NOT NULL,
    sender_user_id bigint NOT NULL,
    subject character varying(200) NOT NULL,
    body text NOT NULL,
    requires_ack boolean DEFAULT false NOT NULL,
    reply_to_id bigint,
    status character varying(10) DEFAULT 'DRAFT'::character varying NOT NULL,
    target_summary character varying(200),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    CONSTRAINT chk_message_kind CHECK (((kind)::text = ANY (ARRAY[('CIRCULAR'::character varying)::text, ('NOTICE'::character varying)::text, ('MESSAGE'::character varying)::text]))),
    CONSTRAINT chk_message_sender CHECK (((sender_type)::text = ANY (ARRAY[('MINISTRY'::character varying)::text, ('DIRECTORATE'::character varying)::text, ('SCHOOL'::character varying)::text]))),
    CONSTRAINT chk_message_sent_at CHECK ((((status)::text = 'SENT'::text) = (sent_at IS NOT NULL))),
    CONSTRAINT chk_message_status CHECK (((status)::text = ANY (ARRAY[('DRAFT'::character varying)::text, ('SENT'::character varying)::text]))),
    CONSTRAINT chk_message_text CHECK (((length(TRIM(BOTH FROM subject)) > 0) AND (length(TRIM(BOTH FROM body)) > 0)))
);


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.messages ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ministries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ministries (
    id bigint NOT NULL,
    name character varying(200) NOT NULL,
    country character varying(100) DEFAULT 'Syria'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ministries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ministries ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ministries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: notification_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_reads (
    notification_id bigint NOT NULL,
    user_id bigint NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    school_id bigint,
    directorate_id bigint,
    title character varying(200) NOT NULL,
    body text,
    link character varying(200),
    request_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    message_id bigint,
    user_id bigint,
    CONSTRAINT chk_notification_target CHECK (((school_id IS NOT NULL) OR (directorate_id IS NOT NULL) OR (user_id IS NOT NULL)))
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.notifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: power_outages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.power_outages (
    id bigint NOT NULL,
    school_id bigint NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    outage_type character varying(20) DEFAULT 'POWER'::character varying NOT NULL,
    notes text,
    recorded_by bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_outage_period CHECK (((ends_at > starts_at) AND ((ends_at - starts_at) <= '24:00:00'::interval))),
    CONSTRAINT chk_outage_type CHECK (((outage_type)::text = ANY (ARRAY[('POWER'::character varying)::text, ('INTERNET'::character varying)::text])))
);


--
-- Name: power_outages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.power_outages ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.power_outages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: report_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_approvals (
    id bigint NOT NULL,
    employee_assignment_id bigint NOT NULL,
    month date NOT NULL,
    approved_by bigint NOT NULL,
    approved_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    snapshot jsonb NOT NULL,
    CONSTRAINT report_approvals_month_check CHECK ((EXTRACT(day FROM month) = (1)::numeric))
);


--
-- Name: report_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.report_approvals ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.report_approvals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: request_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_attachments (
    id bigint NOT NULL,
    request_id bigint NOT NULL,
    uploaded_by bigint NOT NULL,
    file_name character varying(255) NOT NULL,
    file_path text NOT NULL,
    file_type character varying(100),
    file_size bigint,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_attachment_file_size CHECK (((file_size IS NULL) OR (file_size > 0)))
);


--
-- Name: request_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.request_attachments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.request_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: request_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_comments (
    id bigint NOT NULL,
    request_id bigint NOT NULL,
    author_id bigint NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_comment_body CHECK ((length(TRIM(BOTH FROM body)) > 0))
);


--
-- Name: request_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.request_comments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.request_comments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: request_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_status_history (
    id bigint NOT NULL,
    request_id bigint NOT NULL,
    old_status character varying(30),
    new_status character varying(30) NOT NULL,
    changed_by bigint NOT NULL,
    notes text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_history_new_status CHECK (((new_status)::text = ANY (ARRAY[('DRAFT'::character varying)::text, ('SUBMITTED'::character varying)::text, ('UNDER_REVIEW'::character varying)::text, ('RETURNED'::character varying)::text, ('APPROVED'::character varying)::text, ('REJECTED'::character varying)::text, ('IN_PROGRESS'::character varying)::text, ('COMPLETED'::character varying)::text, ('CLOSED'::character varying)::text]))),
    CONSTRAINT chk_history_old_status CHECK (((old_status IS NULL) OR ((old_status)::text = ANY (ARRAY[('DRAFT'::character varying)::text, ('SUBMITTED'::character varying)::text, ('UNDER_REVIEW'::character varying)::text, ('RETURNED'::character varying)::text, ('APPROVED'::character varying)::text, ('REJECTED'::character varying)::text, ('IN_PROGRESS'::character varying)::text, ('COMPLETED'::character varying)::text, ('CLOSED'::character varying)::text]))))
);


--
-- Name: request_status_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.request_status_history ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.request_status_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: result_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.result_corrections (
    id bigint NOT NULL,
    result_id bigint NOT NULL,
    old_score numeric(6,2) NOT NULL,
    new_score numeric(6,2) NOT NULL,
    reason text NOT NULL,
    corrected_by bigint NOT NULL,
    corrected_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT result_corrections_reason_check CHECK ((length(btrim(reason)) > 0))
);


--
-- Name: result_corrections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.result_corrections ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.result_corrections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: result_sheets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.result_sheets (
    id bigint NOT NULL,
    teaching_assignment_id bigint NOT NULL,
    term smallint NOT NULL,
    status character varying(20) DEFAULT 'DRAFT'::character varying NOT NULL,
    submitted_by bigint,
    submitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_sheet_submitted CHECK ((((status)::text <> 'SUBMITTED'::text) OR ((submitted_by IS NOT NULL) AND (submitted_at IS NOT NULL)))),
    CONSTRAINT result_sheets_status_check CHECK (((status)::text = ANY (ARRAY[('DRAFT'::character varying)::text, ('SUBMITTED'::character varying)::text]))),
    CONSTRAINT result_sheets_term_check CHECK ((term = ANY (ARRAY[1, 2])))
);


--
-- Name: result_sheets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.result_sheets ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.result_sheets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id bigint NOT NULL,
    name character varying(50) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.roles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: school_deputy_authorizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_deputy_authorizations (
    id bigint NOT NULL,
    school_id bigint NOT NULL,
    deputy_user_id bigint NOT NULL,
    authorized_by bigint NOT NULL,
    authorized_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_deputy_not_authorizer CHECK ((deputy_user_id <> authorized_by)),
    CONSTRAINT chk_revocation_date CHECK ((((is_active = true) AND (revoked_at IS NULL)) OR ((is_active = false) AND (revoked_at IS NOT NULL))))
);


--
-- Name: school_deputy_authorizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.school_deputy_authorizations ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.school_deputy_authorizations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: school_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_requests (
    id bigint NOT NULL,
    request_number character varying(30) NOT NULL,
    school_id bigint NOT NULL,
    created_by bigint NOT NULL,
    request_type character varying(50) NOT NULL,
    title character varying(200) NOT NULL,
    description text NOT NULL,
    priority_score numeric(5,2),
    priority_reason text,
    status character varying(30) DEFAULT 'DRAFT'::character varying NOT NULL,
    submitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    severity smallint DEFAULT 3 NOT NULL,
    affected_students integer DEFAULT 0 NOT NULL,
    assigned_department character varying(150),
    assigned_to bigint,
    target_employee_id bigint,
    closed_at timestamp with time zone,
    CONSTRAINT chk_account_request_target CHECK ((((request_type)::text <> 'TEACHER_ACCOUNT'::text) OR (target_employee_id IS NOT NULL))),
    CONSTRAINT chk_priority_score CHECK (((priority_score IS NULL) OR ((priority_score >= (0)::numeric) AND (priority_score <= (100)::numeric)))),
    CONSTRAINT chk_request_affected CHECK ((affected_students >= 0)),
    CONSTRAINT chk_request_severity CHECK (((severity >= 1) AND (severity <= 5))),
    CONSTRAINT chk_school_request_status CHECK (((status)::text = ANY (ARRAY[('DRAFT'::character varying)::text, ('SUBMITTED'::character varying)::text, ('UNDER_REVIEW'::character varying)::text, ('RETURNED'::character varying)::text, ('APPROVED'::character varying)::text, ('REJECTED'::character varying)::text, ('IN_PROGRESS'::character varying)::text, ('COMPLETED'::character varying)::text, ('CLOSED'::character varying)::text]))),
    CONSTRAINT chk_school_request_type CHECK (((request_type)::text = ANY (ARRAY[('MAINTENANCE'::character varying)::text, ('TEACHERS'::character varying)::text, ('TEXTBOOKS'::character varying)::text, ('FURNITURE'::character varying)::text, ('COMPUTERS'::character varying)::text, ('OTHER'::character varying)::text, ('TEACHER_ACCOUNT'::character varying)::text])))
);


--
-- Name: COLUMN school_requests.priority_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.school_requests.priority_score IS 'غير مستخدم — الأولوية تُحسب عند العرض (FR-ALG-04)';


--
-- Name: school_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.school_requests ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.school_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: schools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schools (
    id bigint NOT NULL,
    directorate_id bigint NOT NULL,
    name character varying(200) NOT NULL,
    school_code character varying(50),
    address text,
    phone character varying(30),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    stage smallint NOT NULL,
    CONSTRAINT chk_school_stage CHECK ((stage = ANY (ARRAY[1, 2, 3])))
);


--
-- Name: schools_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.schools ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.schools_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sections (
    id bigint NOT NULL,
    class_id bigint NOT NULL,
    name character varying(50) NOT NULL,
    capacity integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    track character varying(30),
    CONSTRAINT chk_section_capacity CHECK (((capacity IS NULL) OR (capacity > 0))),
    CONSTRAINT chk_section_track CHECK (((track IS NULL) OR ((track)::text = ANY (ARRAY[('GENERAL_SCIENTIFIC'::character varying)::text, ('GENERAL_LITERARY'::character varying)::text, ('COMMERCIAL'::character varying)::text, ('INDUSTRIAL'::character varying)::text]))))
);


--
-- Name: sections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sections ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key character varying(60) NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_by bigint,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: student_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_enrollments (
    id bigint NOT NULL,
    student_id bigint NOT NULL,
    section_id bigint NOT NULL,
    enrollment_date date DEFAULT CURRENT_DATE NOT NULL,
    withdrawal_date date,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_enrollment_dates CHECK (((withdrawal_date IS NULL) OR (withdrawal_date >= enrollment_date))),
    CONSTRAINT chk_enrollment_status CHECK (((status)::text = ANY (ARRAY[('ACTIVE'::character varying)::text, ('TRANSFERRED'::character varying)::text, ('WITHDRAWN'::character varying)::text, ('GRADUATED'::character varying)::text])))
);


--
-- Name: student_enrollments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.student_enrollments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.student_enrollments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    id bigint NOT NULL,
    student_number character varying(50),
    full_name character varying(200) NOT NULL,
    date_of_birth date,
    guardian_name character varying(200),
    guardian_phone character varying(30),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: students_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.students ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.students_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subjects (
    id bigint NOT NULL,
    name character varying(150) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: subjects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.subjects ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.subjects_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: teacher_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_profiles (
    employee_id bigint NOT NULL,
    specialization character varying(150),
    qualification character varying(200),
    years_of_experience integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    employment_type character varying(20) DEFAULT 'PERMANENT'::character varying NOT NULL,
    contract_weekly_hours numeric(6,2),
    CONSTRAINT chk_contract_hours CHECK (((((employment_type)::text = 'CONTRACT'::text) AND (contract_weekly_hours > (0)::numeric)) OR (((employment_type)::text = 'PERMANENT'::text) AND (contract_weekly_hours IS NULL)))),
    CONSTRAINT chk_employment_type CHECK (((employment_type)::text = ANY (ARRAY[('PERMANENT'::character varying)::text, ('CONTRACT'::character varying)::text]))),
    CONSTRAINT chk_teacher_experience CHECK ((years_of_experience >= 0))
);


--
-- Name: teaching_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teaching_assignments (
    id bigint NOT NULL,
    employee_assignment_id bigint NOT NULL,
    section_id bigint NOT NULL,
    subject_id bigint NOT NULL,
    weekly_quota_units numeric(6,2) NOT NULL,
    start_date date NOT NULL,
    end_date date,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_teaching_dates CHECK (((end_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT chk_teaching_quota CHECK ((weekly_quota_units > (0)::numeric))
);


--
-- Name: teaching_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.teaching_assignments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.teaching_assignments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: term_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.term_results (
    id bigint NOT NULL,
    sheet_id bigint NOT NULL,
    enrollment_id bigint NOT NULL,
    score numeric(6,2) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT term_results_score_check CHECK (((score >= (0)::numeric) AND (score <= (100)::numeric)))
);


--
-- Name: term_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.term_results ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.term_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: timetable_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timetable_periods (
    id bigint NOT NULL,
    timetable_id bigint NOT NULL,
    teaching_assignment_id bigint NOT NULL,
    section_id bigint NOT NULL,
    day_of_week smallint NOT NULL,
    period_number smallint NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_period_day CHECK (((day_of_week >= 1) AND (day_of_week <= 7))),
    CONSTRAINT chk_period_number CHECK ((period_number > 0))
);


--
-- Name: timetable_periods_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.timetable_periods ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.timetable_periods_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: timetables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timetables (
    id bigint NOT NULL,
    section_id bigint NOT NULL,
    academic_year_id bigint NOT NULL,
    name character varying(150) NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    is_approved boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_timetable_dates CHECK (((effective_to IS NULL) OR (effective_to >= effective_from)))
);


--
-- Name: timetables_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.timetables ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.timetables_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    role_id bigint NOT NULL,
    ministry_id bigint,
    directorate_id bigint,
    school_id bigint,
    full_name character varying(200) NOT NULL,
    username character varying(100) NOT NULL,
    email character varying(255),
    password_hash text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    employee_id bigint,
    CONSTRAINT chk_user_scope CHECK ((((((ministry_id IS NOT NULL))::integer + ((directorate_id IS NOT NULL))::integer) + ((school_id IS NOT NULL))::integer) <= 1))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: v_teacher_quota; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_teacher_quota AS
 SELECT ea.id AS employee_assignment_id,
    ea.employee_id,
    ea.school_id,
    tp.employment_type,
    public.years_of_service(ea.employee_id) AS years_of_service,
        CASE
            WHEN ((tp.employment_type)::text = 'CONTRACT'::text) THEN ea.weekly_quota_units
            ELSE (public.permanent_quota(public.years_of_service(ea.employee_id)))::numeric
        END AS required_weekly_quota,
    tp.contract_weekly_hours
   FROM (public.employee_assignments ea
     JOIN public.teacher_profiles tp ON ((tp.employee_id = ea.employee_id)))
  WHERE (ea.is_active AND ((ea.position_type)::text = 'TEACHER'::text));


--
-- Name: academic_years academic_years_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_name_key UNIQUE (name);


--
-- Name: academic_years academic_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_pkey PRIMARY KEY (id);


--
-- Name: attendance_corrections attendance_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_corrections
    ADD CONSTRAINT attendance_corrections_pkey PRIMARY KEY (id);


--
-- Name: attendance_events attendance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: classes classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);


--
-- Name: directorates directorates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.directorates
    ADD CONSTRAINT directorates_pkey PRIMARY KEY (id);


--
-- Name: employee_assignments employee_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_assignments
    ADD CONSTRAINT employee_assignments_pkey PRIMARY KEY (id);


--
-- Name: employee_leaves employee_leaves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leaves
    ADD CONSTRAINT employee_leaves_pkey PRIMARY KEY (id);


--
-- Name: employees employees_employee_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_employee_number_key UNIQUE (employee_number);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: face_embeddings face_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.face_embeddings
    ADD CONSTRAINT face_embeddings_pkey PRIMARY KEY (employee_id);


--
-- Name: lesson_executions lesson_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_executions
    ADD CONSTRAINT lesson_executions_pkey PRIMARY KEY (id);


--
-- Name: message_attachments message_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_pkey PRIMARY KEY (id);


--
-- Name: message_recipients message_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_recipients
    ADD CONSTRAINT message_recipients_pkey PRIMARY KEY (message_id, recipient_type, recipient_ref_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: ministries ministries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ministries
    ADD CONSTRAINT ministries_pkey PRIMARY KEY (id);


--
-- Name: notification_reads notification_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reads
    ADD CONSTRAINT notification_reads_pkey PRIMARY KEY (notification_id, user_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: power_outages power_outages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.power_outages
    ADD CONSTRAINT power_outages_pkey PRIMARY KEY (id);


--
-- Name: report_approvals report_approvals_employee_assignment_id_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_approvals
    ADD CONSTRAINT report_approvals_employee_assignment_id_month_key UNIQUE (employee_assignment_id, month);


--
-- Name: report_approvals report_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_approvals
    ADD CONSTRAINT report_approvals_pkey PRIMARY KEY (id);


--
-- Name: request_attachments request_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_attachments
    ADD CONSTRAINT request_attachments_pkey PRIMARY KEY (id);


--
-- Name: request_comments request_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_comments
    ADD CONSTRAINT request_comments_pkey PRIMARY KEY (id);


--
-- Name: request_status_history request_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_status_history
    ADD CONSTRAINT request_status_history_pkey PRIMARY KEY (id);


--
-- Name: result_corrections result_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.result_corrections
    ADD CONSTRAINT result_corrections_pkey PRIMARY KEY (id);


--
-- Name: result_sheets result_sheets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.result_sheets
    ADD CONSTRAINT result_sheets_pkey PRIMARY KEY (id);


--
-- Name: result_sheets result_sheets_teaching_assignment_id_term_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.result_sheets
    ADD CONSTRAINT result_sheets_teaching_assignment_id_term_key UNIQUE (teaching_assignment_id, term);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: school_deputy_authorizations school_deputy_authorizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_deputy_authorizations
    ADD CONSTRAINT school_deputy_authorizations_pkey PRIMARY KEY (id);


--
-- Name: school_requests school_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_requests
    ADD CONSTRAINT school_requests_pkey PRIMARY KEY (id);


--
-- Name: school_requests school_requests_request_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_requests
    ADD CONSTRAINT school_requests_request_number_key UNIQUE (request_number);


--
-- Name: schools schools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_pkey PRIMARY KEY (id);


--
-- Name: schools schools_school_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_school_code_key UNIQUE (school_code);


--
-- Name: sections sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sections
    ADD CONSTRAINT sections_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: student_enrollments student_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_enrollments
    ADD CONSTRAINT student_enrollments_pkey PRIMARY KEY (id);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- Name: students students_student_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_student_number_key UNIQUE (student_number);


--
-- Name: subjects subjects_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_name_key UNIQUE (name);


--
-- Name: subjects subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);


--
-- Name: teacher_profiles teacher_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_profiles
    ADD CONSTRAINT teacher_profiles_pkey PRIMARY KEY (employee_id);


--
-- Name: teaching_assignments teaching_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT teaching_assignments_pkey PRIMARY KEY (id);


--
-- Name: term_results term_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.term_results
    ADD CONSTRAINT term_results_pkey PRIMARY KEY (id);


--
-- Name: term_results term_results_sheet_id_enrollment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.term_results
    ADD CONSTRAINT term_results_sheet_id_enrollment_id_key UNIQUE (sheet_id, enrollment_id);


--
-- Name: timetable_periods timetable_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT timetable_periods_pkey PRIMARY KEY (id);


--
-- Name: timetables timetables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetables
    ADD CONSTRAINT timetables_pkey PRIMARY KEY (id);


--
-- Name: classes uq_class_per_year; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT uq_class_per_year UNIQUE (school_id, academic_year_id, grade_level);


--
-- Name: directorates uq_directorate_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.directorates
    ADD CONSTRAINT uq_directorate_name UNIQUE (ministry_id, name);


--
-- Name: lesson_executions uq_lesson_execution; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_executions
    ADD CONSTRAINT uq_lesson_execution UNIQUE (timetable_period_id, lesson_date);


--
-- Name: schools uq_school_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT uq_school_name UNIQUE (directorate_id, name);


--
-- Name: sections uq_section_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sections
    ADD CONSTRAINT uq_section_name UNIQUE (class_id, name);


--
-- Name: timetable_periods uq_section_period; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT uq_section_period UNIQUE (timetable_id, day_of_week, period_number);


--
-- Name: student_enrollments uq_student_section; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_enrollments
    ADD CONSTRAINT uq_student_section UNIQUE (student_id, section_id);


--
-- Name: teaching_assignments uq_teaching_assignment_section; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT uq_teaching_assignment_section UNIQUE (id, section_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_employee_id_key UNIQUE (employee_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_assignments_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignments_dates ON public.employee_assignments USING btree (start_date, end_date);


--
-- Name: idx_assignments_directorate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignments_directorate ON public.employee_assignments USING btree (directorate_id);


--
-- Name: idx_assignments_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignments_employee ON public.employee_assignments USING btree (employee_id);


--
-- Name: idx_assignments_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignments_school ON public.employee_assignments USING btree (school_id);


--
-- Name: idx_attendance_ea_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_ea_time ON public.attendance_events USING btree (employee_assignment_id, event_time);


--
-- Name: idx_attendance_events_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_events_employee ON public.attendance_events USING btree (employee_assignment_id);


--
-- Name: idx_attendance_events_employee_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_events_employee_time ON public.attendance_events USING btree (employee_assignment_id, event_time);


--
-- Name: idx_attendance_events_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_events_time ON public.attendance_events USING btree (event_time);


--
-- Name: idx_audit_logs_action_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_action_time ON public.audit_logs USING btree (action, created_at DESC);


--
-- Name: idx_audit_logs_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user_time ON public.audit_logs USING btree (user_id, created_at DESC);


--
-- Name: idx_classes_academic_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_academic_year ON public.classes USING btree (academic_year_id);


--
-- Name: idx_classes_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_school ON public.classes USING btree (school_id);


--
-- Name: idx_enrollments_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_section ON public.student_enrollments USING btree (section_id);


--
-- Name: idx_enrollments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_status ON public.student_enrollments USING btree (status);


--
-- Name: idx_enrollments_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_student ON public.student_enrollments USING btree (student_id);


--
-- Name: idx_leaves_employee_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leaves_employee_dates ON public.employee_leaves USING btree (employee_id, start_date, end_date);


--
-- Name: idx_message_recipients_box; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_recipients_box ON public.message_recipients USING btree (recipient_type, recipient_ref_id);


--
-- Name: idx_messages_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_sender ON public.messages USING btree (sender_type, sender_ref_id, created_at DESC);


--
-- Name: idx_notifications_directorate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_directorate ON public.notifications USING btree (directorate_id, created_at DESC);


--
-- Name: idx_notifications_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_school ON public.notifications USING btree (school_id, created_at DESC);


--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_outages_school_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outages_school_time ON public.power_outages USING btree (school_id, starts_at);


--
-- Name: idx_period_timetable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_period_timetable ON public.timetable_periods USING btree (timetable_id);


--
-- Name: idx_request_comments; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_request_comments ON public.request_comments USING btree (request_id, created_at);


--
-- Name: idx_result_corrections_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_result_corrections_result ON public.result_corrections USING btree (result_id);


--
-- Name: idx_sections_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sections_class ON public.sections USING btree (class_id);


--
-- Name: idx_teaching_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teaching_employee ON public.teaching_assignments USING btree (employee_assignment_id);


--
-- Name: idx_teaching_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teaching_section ON public.teaching_assignments USING btree (section_id);


--
-- Name: idx_teaching_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teaching_subject ON public.teaching_assignments USING btree (subject_id);


--
-- Name: idx_timetable_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_timetable_section ON public.timetables USING btree (section_id);


--
-- Name: uq_active_assignment_per_school; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_active_assignment_per_school ON public.employee_assignments USING btree (employee_id, school_id) WHERE (is_active AND (school_id IS NOT NULL));


--
-- Name: uq_active_school_deputy; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_active_school_deputy ON public.school_deputy_authorizations USING btree (school_id, deputy_user_id) WHERE (is_active = true);


--
-- Name: uq_attendance_client_event; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_attendance_client_event ON public.attendance_events USING btree (client_event_id) WHERE (client_event_id IS NOT NULL);


--
-- Name: uq_correction_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_correction_pending ON public.attendance_corrections USING btree (employee_assignment_id, work_date) WHERE ((status)::text = 'PENDING'::text);


--
-- Name: attendance_events trg_attendance_events_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_attendance_events_immutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.attendance_events FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_attendance_event_change();


--
-- Name: audit_logs trg_audit_logs_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_logs_immutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.audit_logs FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_audit_log_change();


--
-- Name: classes trg_class_grade_stage; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_class_grade_stage BEFORE INSERT OR UPDATE OF grade_level, school_id ON public.classes FOR EACH ROW EXECUTE FUNCTION public.validate_class_grade_stage();


--
-- Name: employee_assignments trg_contract_hours; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contract_hours BEFORE INSERT OR UPDATE ON public.employee_assignments FOR EACH ROW EXECUTE FUNCTION public.validate_contract_hours();


--
-- Name: timetable_periods trg_period_duration; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_period_duration BEFORE INSERT OR UPDATE OF start_time, end_time ON public.timetable_periods FOR EACH ROW EXECUTE FUNCTION public.validate_period_duration();


--
-- Name: message_attachments trg_protect_msg_attachments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_msg_attachments BEFORE INSERT OR DELETE OR UPDATE ON public.message_attachments FOR EACH ROW EXECUTE FUNCTION public.protect_sent_message_children();


--
-- Name: message_recipients trg_protect_recipients; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_recipients BEFORE INSERT OR DELETE OR UPDATE ON public.message_recipients FOR EACH ROW EXECUTE FUNCTION public.protect_sent_message_children();


--
-- Name: messages trg_protect_sent_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_sent_message BEFORE DELETE OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.protect_sent_message();


--
-- Name: term_results trg_protect_submitted_results; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_submitted_results BEFORE INSERT OR DELETE OR UPDATE ON public.term_results FOR EACH ROW EXECUTE FUNCTION public.protect_submitted_results();


--
-- Name: report_approvals trg_report_approvals_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_report_approvals_immutable BEFORE DELETE OR UPDATE ON public.report_approvals FOR EACH ROW EXECUTE FUNCTION public.prevent_report_approval_change();


--
-- Name: result_corrections trg_result_corrections_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_result_corrections_immutable BEFORE DELETE OR UPDATE ON public.result_corrections FOR EACH ROW EXECUTE FUNCTION public.prevent_correction_change();


--
-- Name: schools trg_school_stage_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_school_stage_change BEFORE UPDATE OF stage ON public.schools FOR EACH ROW EXECUTE FUNCTION public.validate_school_stage_change();


--
-- Name: sections trg_section_track; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_section_track BEFORE INSERT OR UPDATE OF track, class_id ON public.sections FOR EACH ROW EXECUTE FUNCTION public.validate_section_track();


--
-- Name: result_sheets trg_sheet_no_unsubmit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sheet_no_unsubmit BEFORE UPDATE ON public.result_sheets FOR EACH ROW EXECUTE FUNCTION public.prevent_sheet_unsubmit();


--
-- Name: timetable_periods trg_teacher_slot; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teacher_slot BEFORE INSERT OR UPDATE OF teaching_assignment_id, day_of_week, period_number ON public.timetable_periods FOR EACH ROW EXECUTE FUNCTION public.validate_teacher_slot();


--
-- Name: attendance_events trg_validate_attendance_sequence; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_attendance_sequence BEFORE INSERT ON public.attendance_events FOR EACH ROW EXECUTE FUNCTION public.validate_attendance_sequence();


--
-- Name: attendance_corrections attendance_corrections_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_corrections
    ADD CONSTRAINT attendance_corrections_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id);


--
-- Name: attendance_corrections attendance_corrections_employee_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_corrections
    ADD CONSTRAINT attendance_corrections_employee_assignment_id_fkey FOREIGN KEY (employee_assignment_id) REFERENCES public.employee_assignments(id);


--
-- Name: attendance_corrections attendance_corrections_proposed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_corrections
    ADD CONSTRAINT attendance_corrections_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES public.users(id);


--
-- Name: attendance_events attendance_events_employee_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_employee_assignment_id_fkey FOREIGN KEY (employee_assignment_id) REFERENCES public.employee_assignments(id);


--
-- Name: attendance_events attendance_events_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_events
    ADD CONSTRAINT attendance_events_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: employee_assignments employee_assignments_directorate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_assignments
    ADD CONSTRAINT employee_assignments_directorate_id_fkey FOREIGN KEY (directorate_id) REFERENCES public.directorates(id) ON DELETE RESTRICT;


--
-- Name: employee_assignments employee_assignments_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_assignments
    ADD CONSTRAINT employee_assignments_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE RESTRICT;


--
-- Name: employee_leaves employee_leaves_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leaves
    ADD CONSTRAINT employee_leaves_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: employee_leaves employee_leaves_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_leaves
    ADD CONSTRAINT employee_leaves_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: face_embeddings face_embeddings_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.face_embeddings
    ADD CONSTRAINT face_embeddings_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: face_embeddings face_embeddings_enrolled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.face_embeddings
    ADD CONSTRAINT face_embeddings_enrolled_by_fkey FOREIGN KEY (enrolled_by) REFERENCES public.users(id);


--
-- Name: employee_assignments fk_assignment_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_assignments
    ADD CONSTRAINT fk_assignment_employee FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;


--
-- Name: classes fk_classes_academic_year; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT fk_classes_academic_year FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE RESTRICT;


--
-- Name: classes fk_classes_school; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT fk_classes_school FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE RESTRICT;


--
-- Name: directorates fk_directorates_ministry; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.directorates
    ADD CONSTRAINT fk_directorates_ministry FOREIGN KEY (ministry_id) REFERENCES public.ministries(id) ON DELETE RESTRICT;


--
-- Name: student_enrollments fk_enrollment_section; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_enrollments
    ADD CONSTRAINT fk_enrollment_section FOREIGN KEY (section_id) REFERENCES public.sections(id) ON DELETE RESTRICT;


--
-- Name: student_enrollments fk_enrollment_student; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_enrollments
    ADD CONSTRAINT fk_enrollment_student FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE RESTRICT;


--
-- Name: timetable_periods fk_period_teaching_assignment; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT fk_period_teaching_assignment FOREIGN KEY (teaching_assignment_id, section_id) REFERENCES public.teaching_assignments(id, section_id) ON DELETE RESTRICT;


--
-- Name: timetable_periods fk_period_timetable; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetable_periods
    ADD CONSTRAINT fk_period_timetable FOREIGN KEY (timetable_id) REFERENCES public.timetables(id) ON DELETE RESTRICT;


--
-- Name: schools fk_schools_directorate; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT fk_schools_directorate FOREIGN KEY (directorate_id) REFERENCES public.directorates(id) ON DELETE RESTRICT;


--
-- Name: sections fk_sections_class; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sections
    ADD CONSTRAINT fk_sections_class FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE RESTRICT;


--
-- Name: teacher_profiles fk_teacher_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_profiles
    ADD CONSTRAINT fk_teacher_employee FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;


--
-- Name: teaching_assignments fk_teaching_employee_assignment; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT fk_teaching_employee_assignment FOREIGN KEY (employee_assignment_id) REFERENCES public.employee_assignments(id) ON DELETE RESTRICT;


--
-- Name: teaching_assignments fk_teaching_section; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT fk_teaching_section FOREIGN KEY (section_id) REFERENCES public.sections(id) ON DELETE RESTRICT;


--
-- Name: teaching_assignments fk_teaching_subject; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT fk_teaching_subject FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE RESTRICT;


--
-- Name: timetables fk_timetable_academic_year; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetables
    ADD CONSTRAINT fk_timetable_academic_year FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE RESTRICT;


--
-- Name: timetables fk_timetable_section; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timetables
    ADD CONSTRAINT fk_timetable_section FOREIGN KEY (section_id) REFERENCES public.sections(id) ON DELETE RESTRICT;


--
-- Name: users fk_users_role; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE RESTRICT;


--
-- Name: lesson_executions lesson_executions_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_executions
    ADD CONSTRAINT lesson_executions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: lesson_executions lesson_executions_timetable_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_executions
    ADD CONSTRAINT lesson_executions_timetable_period_id_fkey FOREIGN KEY (timetable_period_id) REFERENCES public.timetable_periods(id);


--
-- Name: message_attachments message_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_recipients message_recipients_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_recipients
    ADD CONSTRAINT message_recipients_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.users(id);


--
-- Name: message_recipients message_recipients_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_recipients
    ADD CONSTRAINT message_recipients_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_recipients message_recipients_opened_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_recipients
    ADD CONSTRAINT message_recipients_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.users(id);


--
-- Name: messages messages_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.messages(id);


--
-- Name: messages messages_sender_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES public.users(id);


--
-- Name: notification_reads notification_reads_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reads
    ADD CONSTRAINT notification_reads_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;


--
-- Name: notification_reads notification_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reads
    ADD CONSTRAINT notification_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_directorate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_directorate_id_fkey FOREIGN KEY (directorate_id) REFERENCES public.directorates(id);


--
-- Name: notifications notifications_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.school_requests(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: power_outages power_outages_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.power_outages
    ADD CONSTRAINT power_outages_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: power_outages power_outages_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.power_outages
    ADD CONSTRAINT power_outages_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: report_approvals report_approvals_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_approvals
    ADD CONSTRAINT report_approvals_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: report_approvals report_approvals_employee_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_approvals
    ADD CONSTRAINT report_approvals_employee_assignment_id_fkey FOREIGN KEY (employee_assignment_id) REFERENCES public.employee_assignments(id);


--
-- Name: request_attachments request_attachments_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_attachments
    ADD CONSTRAINT request_attachments_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.school_requests(id) ON DELETE CASCADE;


--
-- Name: request_attachments request_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_attachments
    ADD CONSTRAINT request_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: request_comments request_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_comments
    ADD CONSTRAINT request_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: request_comments request_comments_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_comments
    ADD CONSTRAINT request_comments_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.school_requests(id) ON DELETE CASCADE;


--
-- Name: request_status_history request_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_status_history
    ADD CONSTRAINT request_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: request_status_history request_status_history_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_status_history
    ADD CONSTRAINT request_status_history_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.school_requests(id);


--
-- Name: result_corrections result_corrections_corrected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.result_corrections
    ADD CONSTRAINT result_corrections_corrected_by_fkey FOREIGN KEY (corrected_by) REFERENCES public.users(id);


--
-- Name: result_corrections result_corrections_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.result_corrections
    ADD CONSTRAINT result_corrections_result_id_fkey FOREIGN KEY (result_id) REFERENCES public.term_results(id);


--
-- Name: result_sheets result_sheets_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.result_sheets
    ADD CONSTRAINT result_sheets_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id);


--
-- Name: result_sheets result_sheets_teaching_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.result_sheets
    ADD CONSTRAINT result_sheets_teaching_assignment_id_fkey FOREIGN KEY (teaching_assignment_id) REFERENCES public.teaching_assignments(id);


--
-- Name: school_deputy_authorizations school_deputy_authorizations_authorized_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_deputy_authorizations
    ADD CONSTRAINT school_deputy_authorizations_authorized_by_fkey FOREIGN KEY (authorized_by) REFERENCES public.users(id);


--
-- Name: school_deputy_authorizations school_deputy_authorizations_deputy_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_deputy_authorizations
    ADD CONSTRAINT school_deputy_authorizations_deputy_user_id_fkey FOREIGN KEY (deputy_user_id) REFERENCES public.users(id);


--
-- Name: school_deputy_authorizations school_deputy_authorizations_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_deputy_authorizations
    ADD CONSTRAINT school_deputy_authorizations_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: school_requests school_requests_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_requests
    ADD CONSTRAINT school_requests_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: school_requests school_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_requests
    ADD CONSTRAINT school_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: school_requests school_requests_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_requests
    ADD CONSTRAINT school_requests_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: school_requests school_requests_target_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_requests
    ADD CONSTRAINT school_requests_target_employee_id_fkey FOREIGN KEY (target_employee_id) REFERENCES public.employees(id);


--
-- Name: settings settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: term_results term_results_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.term_results
    ADD CONSTRAINT term_results_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.student_enrollments(id);


--
-- Name: term_results term_results_sheet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.term_results
    ADD CONSTRAINT term_results_sheet_id_fkey FOREIGN KEY (sheet_id) REFERENCES public.result_sheets(id);


--
-- Name: users users_directorate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_directorate_id_fkey FOREIGN KEY (directorate_id) REFERENCES public.directorates(id) ON DELETE RESTRICT;


--
-- Name: users users_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;


--
-- Name: users users_ministry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_ministry_id_fkey FOREIGN KEY (ministry_id) REFERENCES public.ministries(id) ON DELETE RESTRICT;


--
-- Name: users users_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict KFYL3BVzVgwEQse3vhRifDba89aIuTgUv2ZwvLvbqVu2atSSzTYCAxn5G8dKGrf

