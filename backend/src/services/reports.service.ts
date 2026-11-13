
import pool from "../config/database.js";

interface MonthlyAttendanceReport {
  teacher_name: string;
  month: string;
  scheduled_lessons: number | string;
  counted_lessons: number | string;
  partial_attendance: number | string;
  incomplete_records: number | string;
  no_attendance_records: number | string;
  uncovered_movements: number | string;
  uncounted_lessons: number | string;
  completion_percentage: number | string;
}

const monthlyAttendanceQuery = `
WITH month_range AS (
    SELECT
        $1::VARCHAR AS employee_number,
        $2::DATE AS month_start,
        (
            $2::DATE + INTERVAL '1 month' - INTERVAL '1 day'
        )::DATE AS month_end
),

work_days AS (
    SELECT
        generate_series(
            mr.month_start,
            mr.month_end,
            INTERVAL '1 day'
        )::DATE AS work_date
    FROM month_range mr
),

attendance_ordered AS (
    SELECT
        ae.employee_assignment_id,

        (ae.event_time AT TIME ZONE 'Asia/Damascus')::DATE
            AS attendance_date,

        ae.event_type,

        ae.event_time AT TIME ZONE 'Asia/Damascus'
            AS event_local_time,

        LEAD(ae.event_type) OVER (
            PARTITION BY
                ae.employee_assignment_id,
                (ae.event_time AT TIME ZONE 'Asia/Damascus')::DATE
            ORDER BY ae.event_time, ae.id
        ) AS next_event_type,

        LEAD(ae.event_time AT TIME ZONE 'Asia/Damascus') OVER (
            PARTITION BY
                ae.employee_assignment_id,
                (ae.event_time AT TIME ZONE 'Asia/Damascus')::DATE
            ORDER BY ae.event_time, ae.id
        ) AS next_event_local_time

    FROM attendance_events ae
    CROSS JOIN month_range mr

    WHERE ae.event_time >=
        (mr.month_start::TIMESTAMP AT TIME ZONE 'Asia/Damascus')

      AND ae.event_time <
        ((mr.month_end + 1)::TIMESTAMP AT TIME ZONE 'Asia/Damascus')
),

attendance_intervals AS (
    SELECT
        employee_assignment_id,
        attendance_date,
        event_local_time AS presence_start,
        next_event_local_time AS presence_end

    FROM attendance_ordered

    WHERE event_type = 'IN'
      AND next_event_type = 'OUT'
),

daily_attendance AS (
    SELECT
        employee_assignment_id,
        attendance_date,
        COUNT(*) AS event_count,

        BOOL_OR(
            event_type = 'IN'
            AND next_event_type IS NULL
        ) AS has_open_entry

    FROM attendance_ordered

    GROUP BY
        employee_assignment_id,
        attendance_date
),

scheduled_lessons AS (
    SELECT
        ea.id AS employee_assignment_id,
        e.full_name AS teacher_name,
        wd.work_date,

        wd.work_date + tp.start_time AS lesson_start,
        wd.work_date + tp.end_time AS lesson_end

    FROM work_days wd

    JOIN timetable_periods tp
        ON tp.day_of_week =
           EXTRACT(DOW FROM wd.work_date)::INTEGER + 1

    JOIN timetables t
        ON t.id = tp.timetable_id

    JOIN teaching_assignments ta
        ON ta.id = tp.teaching_assignment_id

    JOIN employee_assignments ea
        ON ea.id = ta.employee_assignment_id

    JOIN employees e
        ON e.id = ea.employee_id

    CROSS JOIN month_range mr

    WHERE e.employee_number = mr.employee_number

      AND t.is_approved = TRUE
      AND t.is_active = TRUE

      AND wd.work_date >= t.effective_from
      AND (t.effective_to IS NULL OR wd.work_date <= t.effective_to)

      AND wd.work_date >= ta.start_date
      AND (
          ta.end_date IS NULL
          OR wd.work_date <= ta.end_date
      )

      AND wd.work_date >= ea.start_date
      AND (
          ea.end_date IS NULL
          OR wd.work_date <= ea.end_date
      )
),

lesson_analysis AS (
    SELECT
        sl.*,

        COALESCE(da.event_count, 0) AS event_count,

        COALESCE(da.has_open_entry, FALSE) AS has_open_entry,

        EXISTS (
            SELECT 1
            FROM attendance_intervals ai

            WHERE ai.employee_assignment_id =
                  sl.employee_assignment_id

              AND ai.attendance_date = sl.work_date

              AND ai.presence_start <= sl.lesson_start
              AND ai.presence_end >= sl.lesson_end
        ) AS is_counted,

        EXISTS (
            SELECT 1
            FROM attendance_intervals ai

            WHERE ai.employee_assignment_id =
                  sl.employee_assignment_id

              AND ai.attendance_date = sl.work_date

              AND ai.presence_start < sl.lesson_end
              AND ai.presence_end > sl.lesson_start
        ) AS has_partial_presence

    FROM scheduled_lessons sl

    LEFT JOIN daily_attendance da
        ON da.employee_assignment_id = sl.employee_assignment_id
       AND da.attendance_date = sl.work_date
)

SELECT
    teacher_name,

    TO_CHAR(mr.month_start, 'YYYY-MM') AS month,

    COUNT(*)::INTEGER AS scheduled_lessons,

    COUNT(*) FILTER (
        WHERE is_counted
    )::INTEGER AS counted_lessons,

    COUNT(*) FILTER (
        WHERE NOT is_counted
          AND has_partial_presence
    )::INTEGER AS partial_attendance,

    COUNT(*) FILTER (
        WHERE NOT is_counted
          AND NOT has_partial_presence
          AND has_open_entry
          AND event_count > 0
    )::INTEGER AS incomplete_records,

    COUNT(*) FILTER (
        WHERE event_count = 0
    )::INTEGER AS no_attendance_records,

    COUNT(*) FILTER (
        WHERE NOT is_counted
          AND NOT has_partial_presence
          AND event_count > 0
          AND NOT has_open_entry
    )::INTEGER AS uncovered_movements,

    COUNT(*) FILTER (
        WHERE NOT is_counted
    )::INTEGER AS uncounted_lessons,

    ROUND(
        COUNT(*) FILTER (WHERE is_counted)::NUMERIC
        / NULLIF(COUNT(*), 0) * 100,
        2
    ) AS completion_percentage

FROM lesson_analysis

CROSS JOIN month_range mr

GROUP BY
    employee_assignment_id,
    teacher_name,
    mr.month_start;
`;

export async function getMonthlyAttendanceReport(
  employeeNumber: string,
  month: string
) {
  const monthStart = `${month}-01`;

  const result = await pool.query<MonthlyAttendanceReport>(
    monthlyAttendanceQuery,
    [employeeNumber, monthStart]
  );

  return result.rows.map((row) => ({
    teacherName: row.teacher_name,
    month: row.month,
    scheduledLessons: Number(row.scheduled_lessons),
    countedLessons: Number(row.counted_lessons),
    partialAttendance: Number(row.partial_attendance),
    incompleteRecords: Number(row.incomplete_records),
    noAttendanceRecords: Number(row.no_attendance_records),
    uncoveredMovements: Number(row.uncovered_movements),
    uncountedLessons: Number(row.uncounted_lessons),
    completionPercentage: Number(row.completion_percentage),
  }));
}

export interface MonthlyDetailedLesson {
  lesson_date: string;
  day_name: string;
  period_number: number;
  start_time: string;
  end_time: string;
  attendance_movements: string;
  lesson_status: string;
  manual_reasons: string;
}

const monthlyDetailedQuery = `
WITH settings AS (
    SELECT
        $1::VARCHAR AS employee_number,
        $2::DATE AS month_start
),
month_range AS (
    SELECT
        employee_number,
        month_start,
        (month_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE AS month_end
    FROM settings
),
calendar_days AS (
    SELECT
        generate_series(
            mr.month_start,
            mr.month_end,
            INTERVAL '1 day'
        )::DATE AS work_date,
        mr.employee_number
    FROM month_range mr
),
work_days AS (
    SELECT
        work_date,
        employee_number
    FROM calendar_days
    WHERE EXTRACT(DOW FROM work_date) BETWEEN 0 AND 4
),
attendance_ordered AS (
    SELECT
        ae.employee_assignment_id,
        (ae.event_time AT TIME ZONE 'Asia/Damascus')::DATE AS event_date,
        ae.event_type,
        ae.event_time AT TIME ZONE 'Asia/Damascus' AS local_event_time,
        ae.verification_method,
        ae.manual_reason,

        LEAD(ae.event_type) OVER (
            PARTITION BY
                ae.employee_assignment_id,
                (ae.event_time AT TIME ZONE 'Asia/Damascus')::DATE
            ORDER BY ae.event_time, ae.id
        ) AS next_event_type,

        LEAD(ae.event_time AT TIME ZONE 'Asia/Damascus') OVER (
            PARTITION BY
                ae.employee_assignment_id,
                (ae.event_time AT TIME ZONE 'Asia/Damascus')::DATE
            ORDER BY ae.event_time, ae.id
        ) AS next_event_time

    FROM attendance_events ae
),
attendance_intervals AS (
    SELECT
        employee_assignment_id,
        event_date,
        local_event_time AS in_time,
        next_event_time AS out_time
    FROM attendance_ordered
    WHERE event_type = 'IN'
      AND next_event_type = 'OUT'
),
daily_movements AS (
    SELECT
        employee_assignment_id,
        event_date,

        STRING_AGG(
            TO_CHAR(local_event_time, 'HH24:MI')
            || ' - ' || event_type
            || CASE
                WHEN verification_method IS NOT NULL
                THEN ' (' || verification_method || ')'
                ELSE ''
            END,
            ' | '
            ORDER BY local_event_time
        ) AS movements,

        STRING_AGG(
            DISTINCT NULLIF(manual_reason, ''),
            '، '
        ) AS manual_reasons

    FROM attendance_ordered
    GROUP BY employee_assignment_id, event_date
),
scheduled_lessons AS (
    SELECT
        ea.id AS employee_assignment_id,
        e.full_name AS teacher_name,
        wd.work_date,
        CASE EXTRACT(DOW FROM wd.work_date)
            WHEN 0 THEN 'الأحد'
            WHEN 1 THEN 'الاثنين'
            WHEN 2 THEN 'الثلاثاء'
            WHEN 3 THEN 'الأربعاء'
            WHEN 4 THEN 'الخميس'
        END AS day_name,
        tp.period_number,
        tp.start_time,
        tp.end_time

    FROM work_days wd

    JOIN employees e
        ON e.employee_number = wd.employee_number

    JOIN employee_assignments ea
        ON ea.employee_id = e.id
       AND ea.position_type = 'TEACHER'
       AND ea.work_schedule_type = 'TEACHING_TIMETABLE'
       AND ea.is_active = TRUE
       AND ea.start_date <= wd.work_date
       AND (ea.end_date IS NULL OR ea.end_date >= wd.work_date)

    JOIN teaching_assignments ta
        ON ta.employee_assignment_id = ea.id
       AND ta.is_active = TRUE
       AND ta.start_date <= wd.work_date
       AND (ta.end_date IS NULL OR ta.end_date >= wd.work_date)

    JOIN timetable_periods tp
        ON tp.teaching_assignment_id = ta.id
       AND tp.day_of_week = EXTRACT(DOW FROM wd.work_date)::INTEGER + 1

    JOIN timetables t
        ON t.id = tp.timetable_id
       AND t.section_id = tp.section_id
       AND t.is_approved = TRUE
       AND t.is_active = TRUE
       AND t.effective_from <= wd.work_date
       AND (t.effective_to IS NULL OR t.effective_to >= wd.work_date)
),
lesson_analysis AS (
    SELECT
        sl.*,

        COALESCE(dm.movements, 'لا توجد حركات') AS attendance_movements,
        COALESCE(dm.manual_reasons, '') AS manual_reasons,

        EXISTS (
            SELECT 1
            FROM attendance_intervals ai
            WHERE ai.employee_assignment_id = sl.employee_assignment_id
              AND ai.event_date = sl.work_date
              AND ai.in_time <= sl.work_date + sl.start_time
              AND ai.out_time >= sl.work_date + sl.end_time
        ) AS has_full_coverage,

        EXISTS (
            SELECT 1
            FROM attendance_intervals ai
            WHERE ai.employee_assignment_id = sl.employee_assignment_id
              AND ai.event_date = sl.work_date
              AND ai.in_time < sl.work_date + sl.end_time
              AND ai.out_time > sl.work_date + sl.start_time
        ) AS has_partial_coverage,

        EXISTS (
            SELECT 1
            FROM attendance_ordered ao
            WHERE ao.employee_assignment_id = sl.employee_assignment_id
              AND ao.event_date = sl.work_date
              AND ao.event_type = 'IN'
              AND ao.next_event_type IS NULL
              AND ao.local_event_time < sl.work_date + sl.end_time
        ) AS has_incomplete_record,

        (dm.employee_assignment_id IS NOT NULL) AS has_movements

    FROM scheduled_lessons sl

    LEFT JOIN daily_movements dm
        ON dm.employee_assignment_id = sl.employee_assignment_id
       AND dm.event_date = sl.work_date
)
SELECT
    work_date::TEXT AS lesson_date,
    day_name,
    period_number,
    TO_CHAR(start_time, 'HH24:MI') AS start_time,
    TO_CHAR(end_time, 'HH24:MI') AS end_time,
    attendance_movements,

    CASE
        WHEN has_full_coverage
            THEN 'محتسبة'
        WHEN has_partial_coverage
            THEN 'حضور جزئي - غير محتسبة'
        WHEN has_incomplete_record
            THEN 'سجل حضور غير مكتمل - بانتظار تسجيل الخروج'
        WHEN NOT has_movements
            THEN 'لا يوجد سجل حضور'
        ELSE 'توجد حركات حضور لا تغطي الحصة'
    END AS lesson_status,

    manual_reasons

FROM lesson_analysis
ORDER BY work_date, period_number;
`;

export async function getMonthlyDetailedReport(
  employeeNumber: string,
  month: string
) {
 const monthStart = `${month}-01`;

  const result = await pool.query<MonthlyDetailedLesson>(
    monthlyDetailedQuery,
    [employeeNumber, monthStart]
  );

  return result.rows;
}
