import pool from "../config/database.js";

/**
 * Lesson-level status for every scheduled lesson in [from, to] (FR-SCH-06/08/09).
 *
 * Status, in priority order:
 *   1. a manual decision in lesson_executions (EXECUTED / NOT_EXECUTED / COMPENSATED)
 *   2. EXCUSED      — the teacher is on leave / official assignment that day (FR-SCH-09)
 *   3. UPCOMING     — lesson is in the future
 *   4. EXECUTED     — an attendance interval (IN→OUT) fully covers the lesson
 *   5. NOT_EXECUTED — otherwise
 * Every executed/compensated lesson counts as one administrative unit (FR-SCH-06).
 */
const LESSONS_CTE = `
WITH days AS (
    SELECT d::date AS lesson_date
      FROM generate_series($1::date, $2::date, interval '1 day') d
),
assignments AS (
    SELECT ea.id AS employee_assignment_id, ea.employee_id, ea.school_id
      FROM employee_assignments ea
     WHERE ea.is_active AND ea.position_type = 'TEACHER'
       AND ($3::bigint IS NULL OR ea.school_id = $3)
       AND ($4::bigint IS NULL OR ea.id = $4)
),
lessons AS (
    SELECT a.employee_assignment_id, a.employee_id, a.school_id,
           tp.id AS period_id, d.lesson_date, tp.day_of_week, tp.period_number,
           tp.start_time, tp.end_time,
           sub.name AS subject_name, c.name AS class_name, sc.name AS section_name, sc.id AS section_id,
           (d.lesson_date + tp.start_time) AT TIME ZONE 'Asia/Damascus' AS lesson_start,
           (d.lesson_date + tp.end_time) AT TIME ZONE 'Asia/Damascus' AS lesson_end
      FROM assignments a
      JOIN teaching_assignments ta ON ta.employee_assignment_id = a.employee_assignment_id AND ta.is_active
      JOIN timetable_periods tp ON tp.teaching_assignment_id = ta.id
      JOIN timetables t ON t.id = tp.timetable_id AND t.is_active AND t.is_approved
      JOIN days d ON tp.day_of_week = EXTRACT(DOW FROM d.lesson_date)::int + 1
      JOIN subjects sub ON sub.id = ta.subject_id
      JOIN sections sc ON sc.id = tp.section_id
      JOIN classes c ON c.id = sc.class_id
     WHERE d.lesson_date >= t.effective_from AND (t.effective_to IS NULL OR d.lesson_date <= t.effective_to)
       AND d.lesson_date >= ta.start_date AND (ta.end_date IS NULL OR d.lesson_date <= ta.end_date)
),
intervals AS (
    SELECT employee_assignment_id, event_time AS presence_start,
           LEAD(event_time) OVER w AS presence_end, event_type,
           LEAD(event_type) OVER w AS next_type
      FROM attendance_events
     WHERE employee_assignment_id IN (SELECT employee_assignment_id FROM assignments)
       AND event_time >= ($1::date)::timestamp AT TIME ZONE 'Asia/Damascus'
       AND event_time <  ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Damascus'
    WINDOW w AS (PARTITION BY employee_assignment_id, (event_time AT TIME ZONE 'Asia/Damascus')::date ORDER BY event_time)
),
presence AS (
    SELECT * FROM intervals WHERE event_type = 'IN' AND next_type = 'OUT'
),
lesson_status AS (
    SELECT l.*,
           le.status AS manual_status, le.notes AS manual_notes,
           lv.leave_type,
           CASE
             WHEN le.status IS NOT NULL THEN le.status
             WHEN lv.leave_type IS NOT NULL THEN 'EXCUSED'
             WHEN l.lesson_start > now() THEN 'UPCOMING'
             WHEN EXISTS (SELECT 1 FROM presence p
                           WHERE p.employee_assignment_id = l.employee_assignment_id
                             AND p.presence_start <= l.lesson_start AND p.presence_end >= l.lesson_end)
               THEN 'EXECUTED'
             ELSE 'NOT_EXECUTED'
           END AS status
      FROM lessons l
      LEFT JOIN lesson_executions le ON le.timetable_period_id = l.period_id AND le.lesson_date = l.lesson_date
      LEFT JOIN LATERAL (
          SELECT leave_type FROM employee_leaves lv
           WHERE lv.employee_id = l.employee_id AND l.lesson_date BETWEEN lv.start_date AND lv.end_date
           LIMIT 1) lv ON true
)`;

export interface LessonRow {
  employee_assignment_id: string;
  period_id: string;
  lesson_date: string;
  day_of_week: number;
  period_number: number;
  start_time: string;
  end_time: string;
  subject_name: string;
  class_name: string;
  section_name: string;
  status: "EXECUTED" | "NOT_EXECUTED" | "COMPENSATED" | "EXCUSED" | "UPCOMING";
  manual_status: string | null;
  manual_notes: string | null;
  leave_type: string | null;
}

export async function getLessons(from: string, to: string, opts: { schoolId?: number; assignmentId?: number }) {
  const r = await pool.query<LessonRow>(
    `${LESSONS_CTE}
     SELECT employee_assignment_id, period_id, lesson_date, day_of_week, period_number,
            to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time,
            subject_name, class_name, section_name, status, manual_status, manual_notes, leave_type
       FROM lesson_status ORDER BY lesson_date, period_number`,
    [from, to, opts.schoolId ?? null, opts.assignmentId ?? null]
  );
  return r.rows;
}

/**
 * Weekly quota summary per teacher assignment (FR-SCH-06, 07, 09, 10).
 * required   = v_teacher_quota (permanent: by years of service; contract: hours at this school)
 * excused    = lessons on leave days — reduce what is required this week
 * executed   = EXECUTED + COMPENSATED lessons (1 unit each)
 * remaining  = max(required − excused − executed, 0)
 * teaching_minutes = executed × lesson duration;  presence_minutes = sum of IN→OUT intervals (FR-SCH-07)
 */
export async function getQuotaSummary(from: string, to: string, opts: { schoolId?: number; assignmentId?: number }) {
  const r = await pool.query(
    `${LESSONS_CTE},
     per_teacher AS (
        SELECT employee_assignment_id,
               COUNT(*)::int AS scheduled,
               COUNT(*) FILTER (WHERE status IN ('EXECUTED', 'COMPENSATED'))::int AS executed,
               COUNT(*) FILTER (WHERE status = 'COMPENSATED')::int AS compensated,
               COUNT(*) FILTER (WHERE status = 'NOT_EXECUTED')::int AS not_executed,
               COUNT(*) FILTER (WHERE status = 'EXCUSED')::int AS excused,
               COUNT(*) FILTER (WHERE status = 'UPCOMING')::int AS upcoming
          FROM lesson_status GROUP BY employee_assignment_id
     ),
     presence_minutes AS (
        SELECT employee_assignment_id,
               ROUND(SUM(EXTRACT(EPOCH FROM presence_end - presence_start)) / 60)::int AS minutes
          FROM presence GROUP BY employee_assignment_id
     )
     SELECT a.employee_assignment_id, e.employee_number, e.full_name, a.school_id,
            q.employment_type, q.years_of_service, q.required_weekly_quota::float AS required,
            COALESCE(pt.scheduled, 0) AS scheduled, COALESCE(pt.executed, 0) AS executed,
            COALESCE(pt.compensated, 0) AS compensated, COALESCE(pt.not_executed, 0) AS not_executed,
            COALESCE(pt.excused, 0) AS excused, COALESCE(pt.upcoming, 0) AS upcoming,
            GREATEST(q.required_weekly_quota - COALESCE(pt.excused, 0) - COALESCE(pt.executed, 0), 0)::float AS remaining,
            COALESCE(pt.executed, 0) * (SELECT (value #>> '{}')::int FROM settings WHERE key = 'lesson_duration_minutes') AS teaching_minutes,
            COALESCE(pm.minutes, 0) AS presence_minutes
       FROM assignments a
       JOIN employees e ON e.id = a.employee_id
       JOIN v_teacher_quota q ON q.employee_assignment_id = a.employee_assignment_id
       LEFT JOIN per_teacher pt ON pt.employee_assignment_id = a.employee_assignment_id
       LEFT JOIN presence_minutes pm ON pm.employee_assignment_id = a.employee_assignment_id
      ORDER BY e.full_name`,
    [from, to, opts.schoolId ?? null, opts.assignmentId ?? null]
  );
  return r.rows;
}

/** Sunday..Saturday week containing `date` (YYYY-MM-DD). */
export function weekRange(date?: string): { from: string; to: string } {
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : new Date();
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - d.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}

export async function getSetting<T>(key: string): Promise<T> {
  const r = await pool.query("SELECT value FROM settings WHERE key = $1", [key]);
  return r.rows[0]?.value as T;
}
