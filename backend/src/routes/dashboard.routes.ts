import { Router } from "express";
import pool from "../config/database.js";
import { AuthRequest, authenticateToken } from "../middleware/auth.middleware.js";
import { readableSchoolIds } from "../services/scope.service.js";
import { getQuotaSummary, weekRange } from "../services/schedule.service.js";
import { handle } from "../utils/http.js";

// Home-page indicators, scoped to the user's role (early version of FR-DASH-01/02; aggregated numbers only).
const router = Router();
router.use(authenticateToken);

function shiftIso(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

router.get(
  "/summary",
  handle<AuthRequest>(async (req, res) => {
    const u = req.user!;

    // ---------------- teacher: own week only
    if (u.role === "TEACHER") {
      const ea = await pool.query(
        "SELECT id FROM employee_assignments WHERE employee_id = $1 AND is_active AND position_type = 'TEACHER'",
        [u.employeeId]
      );
      const week = weekRange();
      const rows = [];
      for (const r of ea.rows) rows.push(...(await getQuotaSummary(week.from, week.to, { assignmentId: Number(r.id) })));
      return res.json({ success: true, data: { kind: "teacher", week, quota: rows } });
    }

    const ids = await readableSchoolIds(u); // null = all (ministry)
    const scope = ids === null ? "TRUE" : "s.id = ANY($1::bigint[])";
    const params = ids === null ? [] : [ids];

    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM schools s WHERE ${scope} AND s.is_active)::int AS schools,
         (SELECT COUNT(DISTINCT ea.employee_id) FROM employee_assignments ea JOIN schools s ON s.id = ea.school_id
           WHERE ${scope} AND ea.is_active AND ea.position_type = 'TEACHER')::int AS teachers,
         (SELECT COUNT(DISTINCT ea.employee_id) FROM employee_assignments ea JOIN schools s ON s.id = ea.school_id
           WHERE ${scope} AND ea.is_active AND ea.position_type <> 'TEACHER')::int AS staff,
         (SELECT COUNT(*) FROM student_enrollments se JOIN sections sc ON sc.id = se.section_id
           JOIN classes c ON c.id = sc.class_id JOIN schools s ON s.id = c.school_id
           WHERE ${scope} AND se.status = 'ACTIVE')::int AS students,
         (SELECT COUNT(*) FROM sections sc JOIN classes c ON c.id = sc.class_id JOIN schools s ON s.id = c.school_id
           WHERE ${scope})::int AS sections`,
      params
    );

    // Attendance over the last 10 working days that have data: staff present / active staff
    const attendance = await pool.query(
      `WITH staff AS (
         SELECT ea.id FROM employee_assignments ea JOIN schools s ON s.id = ea.school_id
          WHERE ${scope} AND ea.is_active
       ), days AS (
         SELECT DISTINCT (ae.event_time AT TIME ZONE 'Asia/Damascus')::date AS day
           FROM attendance_events ae WHERE ae.employee_assignment_id IN (SELECT id FROM staff)
          ORDER BY 1 DESC LIMIT 10
       )
       SELECT d.day::text AS day,
              (SELECT COUNT(DISTINCT ae.employee_assignment_id) FROM attendance_events ae
                WHERE ae.employee_assignment_id IN (SELECT id FROM staff) AND ae.event_type = 'IN'
                  AND (ae.event_time AT TIME ZONE 'Asia/Damascus')::date = d.day)::int AS present,
              (SELECT COUNT(*) FROM staff)::int AS total
         FROM days d ORDER BY d.day`,
      params
    );

    // Quota execution for the last complete week (current week is still in progress)
    const lastWeek = weekRange(shiftIso(weekRange().from, -1));
    const quotaRows = (await getQuotaSummary(lastWeek.from, lastWeek.to, {}))
      .filter((r) => ids === null || ids.includes(Number(r.school_id)));
    const quota = quotaRows.reduce(
      (t, r) => ({
        required: t.required + Number(r.required),
        executed: t.executed + Number(r.executed),
        notExecuted: t.notExecuted + Number(r.not_executed),
        excused: t.excused + Number(r.excused),
        teachersBelow: t.teachersBelow + (Number(r.remaining) > 0 ? 1 : 0),
      }),
      { required: 0, executed: 0, notExecuted: 0, excused: 0, teachersBelow: 0 }
    );

    // Items that need this user's attention
    const attention: { key: string; count: number }[] = [];
    const q = async (key: string, sql: string, p: unknown[]) => {
      const r = await pool.query(sql, p);
      attention.push({ key, count: Number(r.rows[0].n) });
    };
    if (u.role === "DIRECTORATE_ADMIN" || u.role === "MINISTRY_ADMIN") {
      await q("requests_pending",
        `SELECT COUNT(*) n FROM school_requests sr JOIN schools s ON s.id = sr.school_id
          WHERE ${scope} AND sr.status IN ('SUBMITTED', 'UNDER_REVIEW')`, params);
    }
    if (u.role === "SCHOOL_PRINCIPAL" || u.role === "SCHOOL_DEPUTY") {
      await q("grades_to_approve",
        `SELECT COUNT(*) n FROM assessments a JOIN teaching_assignments ta ON ta.id = a.teaching_assignment_id
          JOIN sections sc ON sc.id = ta.section_id JOIN classes c ON c.id = sc.class_id
          WHERE c.school_id = $1 AND a.status = 'SUBMITTED'`, [u.schoolId]);
      await q("my_requests_open",
        `SELECT COUNT(*) n FROM school_requests WHERE school_id = $1 AND status NOT IN ('COMPLETED', 'REJECTED')`, [u.schoolId]);
    }
    if (u.role === "SUPERVISOR") {
      await q("grades_draft",
        `SELECT COUNT(*) n FROM assessments a JOIN teaching_assignments ta ON ta.id = a.teaching_assignment_id
          JOIN sections sc ON sc.id = ta.section_id JOIN classes c ON c.id = sc.class_id
          WHERE c.school_id = $1 AND a.status = 'DRAFT'`, [u.schoolId]);
    }
    if (u.role !== "MINISTRY_ADMIN") {
      await q("on_leave_today",
        `SELECT COUNT(DISTINCT lv.employee_id) n FROM employee_leaves lv
          JOIN employee_assignments ea ON ea.employee_id = lv.employee_id AND ea.is_active
          JOIN schools s ON s.id = ea.school_id
          WHERE ${scope} AND CURRENT_DATE BETWEEN lv.start_date AND lv.end_date`, params);
    }

    res.json({
      success: true,
      data: {
        kind: "manager",
        counts: counts.rows[0],
        attendance: attendance.rows,
        quota: { week: lastWeek, ...quota },
        attention,
      },
    });
  })
);

export default router;
