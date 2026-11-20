import pool from "../config/database.js";
import { classifyRange, type DayRow } from "./attendance.service.js";
import { getLessons, getQuotaSummary, getSetting } from "./schedule.service.js";
import { HttpError } from "../utils/http.js";

// FR-RPT-01..06: every report is built from the same services as the attendance and quota pages
// (classifyRange = ALG-01, getQuotaSummary = SCH), so figures match across pages, dashboards and exports (FR-DASH-04).

/** Today's date in Syria (UTC+3, no DST). */
export function todaySy(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}

export function parseMonth(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new HttpError(400, "صيغة الشهر غير صحيحة (YYYY-MM)");
  return v;
}

/** Month range clipped to today: future days are not counted (fixes the old "no attendance record" for future days). */
export function monthRange(month: string) {
  const from = `${month}-01`;
  const d = new Date(`${from}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  const monthEnd = d.toISOString().slice(0, 10);
  const today = todaySy();
  if (from > today) throw new HttpError(400, "لا يمكن إنشاء تقرير لشهر لم يبدأ بعد");
  const to = monthEnd < today ? monthEnd : today;
  return { from, to, monthEnd, complete: monthEnd < today };
}

export function periodRange(fromQ: unknown, toQ: unknown) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof fromQ !== "string" || typeof toQ !== "string" || !re.test(fromQ) || !re.test(toQ) || fromQ > toQ) {
    throw new HttpError(400, "الفترة غير صحيحة");
  }
  const today = todaySy();
  return { from: fromQ, to: toQ < today ? toQ : today };
}

// ---------------------------------------------------------------- day status aggregation

export type DayBucket = "present" | "late" | "earlyLeave" | "incomplete" | "possibleAbsence" | "absent" | "excused" | "outage";

/** Effective bucket of a classified day (an approved correction replaces the computed status). null = no duty. */
export function dayBucket(r: Pick<DayRow, "status" | "correctedStatus">): DayBucket | null {
  const s = r.status === "CORRECTED" ? r.correctedStatus : r.status;
  switch (s) {
    case "PRESENT": return "present";
    case "LATE": return "late";
    case "EARLY_LEAVE": return "earlyLeave";
    case "LATE_EARLY_LEAVE": return "late";
    case "INCOMPLETE": return "incomplete";
    case "POSSIBLE_ABSENCE": return "possibleAbsence";
    case "ABSENT": return "absent";
    case "EXCUSED": return "excused";
    case "OUTAGE_EXEMPT": return "outage";
    default: return null;
  }
}

export interface DayCounts {
  dutyDays: number; present: number; late: number; earlyLeave: number; incomplete: number;
  possibleAbsence: number; absent: number; excused: number; outage: number; corrected: number;
  lateMinutes: number; earlyMinutes: number; attendanceRate: number | null;
}

/**
 * Attendance rate = days attended / days that required attendance.
 * Attended: present, late, early leave, incomplete (an IN exists). Not required: excused (leave), outage-exempt, no duty.
 */
export function countDays(rows: Pick<DayRow, "status" | "correctedStatus" | "lateMinutes" | "earlyMinutes">[]): DayCounts {
  const c: DayCounts = { dutyDays: 0, present: 0, late: 0, earlyLeave: 0, incomplete: 0, possibleAbsence: 0, absent: 0, excused: 0, outage: 0, corrected: 0, lateMinutes: 0, earlyMinutes: 0, attendanceRate: null };
  for (const r of rows) {
    const b = dayBucket(r);
    if (!b) continue;
    c[b]++;
    if (r.status === "CORRECTED") c.corrected++;
    c.lateMinutes += r.lateMinutes ?? 0;
    c.earlyMinutes += r.earlyMinutes ?? 0;
  }
  c.dutyDays = c.present + c.late + c.earlyLeave + c.incomplete + c.possibleAbsence + c.absent;
  c.attendanceRate = c.dutyDays ? round1(((c.present + c.late + c.earlyLeave + c.incomplete) / c.dutyDays) * 100) : null;
  return c;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Quota required for a period = weekly quota × working days in period / working days per week. */
async function periodFactor(from: string, to: string) {
  const workDays = await getSetting<number[]>("work_days");
  let n = 0;
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    if (workDays.includes(d.getUTCDay() + 1)) n++;
  }
  return { workingDays: n, factor: n / workDays.length };
}

function quotaFigures(q: Record<string, unknown> | undefined, factor: number) {
  if (!q) return null;
  const requiredWeekly = Number(q.required);
  const required = round1(requiredWeekly * factor);
  const executed = Number(q.executed);
  const excused = Number(q.excused);
  const due = Math.max(required - excused, 0);
  return {
    employmentType: q.employment_type as string,
    requiredWeekly,
    required,
    scheduled: Number(q.scheduled),
    executed,
    compensated: Number(q.compensated),
    notExecuted: Number(q.not_executed),
    excused,
    remaining: round1(Math.max(due - executed, 0)),
    completion: due ? round1(Math.min(executed / due, 1) * 100) : null,
    teachingMinutes: Number(q.teaching_minutes),
    presenceMinutes: Number(q.presence_minutes),
  };
}

// ---------------------------------------------------------------- FR-RPT-01/03: teacher monthly report

export async function loadAssignment(eaId: number) {
  const r = await pool.query(
    `SELECT ea.id, ea.employee_id, ea.school_id, ea.position_type, e.employee_number, e.full_name, s.name AS school_name, s.directorate_id
       FROM employee_assignments ea JOIN employees e ON e.id = ea.employee_id JOIN schools s ON s.id = ea.school_id
      WHERE ea.id = $1 AND ea.position_type = 'TEACHER'`,
    [eaId]
  );
  if (!r.rowCount) throw new HttpError(404, "المعلم غير موجود");
  return r.rows[0];
}

export async function teacherMonthlyReport(eaId: number, month: string) {
  const a = await loadAssignment(eaId);
  const range = monthRange(month);
  const [days, lessons, quotaRows, pf, leaves, corrections, approval, rate] = await Promise.all([
    classifyRange(range.from, range.to, { assignmentId: eaId }),
    getLessons(range.from, range.to, { assignmentId: eaId }),
    getQuotaSummary(range.from, range.to, { assignmentId: eaId }),
    periodFactor(range.from, range.to),
    pool.query(
      `SELECT leave_type, start_date::text, end_date::text, notes FROM employee_leaves
        WHERE employee_id = $1 AND end_date >= $2 AND start_date <= $3 ORDER BY start_date`,
      [a.employee_id, range.from, range.to]
    ),
    pool.query(
      `SELECT ac.work_date::text AS work_date, ac.corrected_status, ac.reason, ac.status,
              pu.full_name AS proposed_by_name, du.full_name AS decided_by_name
         FROM attendance_corrections ac JOIN users pu ON pu.id = ac.proposed_by LEFT JOIN users du ON du.id = ac.decided_by
        WHERE ac.employee_assignment_id = $1 AND ac.work_date BETWEEN $2 AND $3 ORDER BY ac.work_date`,
      [eaId, range.from, range.to]
    ),
    getApproval(eaId, month),
    getSetting<number>("contract_lesson_rate"),
  ]);
  const quota = quotaFigures(quotaRows[0], pf.factor);
  const pending = pendingIssues(days, corrections.rows);
  return {
    teacher: { assignmentId: eaId, employeeNumber: a.employee_number, name: a.full_name, schoolId: Number(a.school_id), schoolName: a.school_name },
    month, period: range, workingDays: pf.workingDays,
    days: days.map((d) => ({
      date: d.date, status: d.status, correctedStatus: d.correctedStatus ?? null, firstIn: d.firstIn, lastOut: d.lastOut,
      expectedStart: d.expectedStart, expectedEnd: d.expectedEnd, lateMinutes: d.lateMinutes, earlyMinutes: d.earlyMinutes,
      reasons: d.reasons, pendingCorrection: d.pendingCorrection,
    })),
    dayCounts: countDays(days),
    lessons,
    quota,
    // Contract teacher: indicative pay estimate only — not an official salary (SRS: no payroll)
    contractEstimate: quota?.employmentType === "CONTRACT" ? { rate: Number(rate), amount: quota.executed * Number(rate) } : null,
    leaves: leaves.rows,
    corrections: corrections.rows,
    pending,
    approval,
  };
}

/** FR-RPT-03: what blocks approval — pending corrections and incomplete records; possible absences need acknowledgement. */
function pendingIssues(days: DayRow[], corrections: { status: string }[]) {
  return {
    pendingCorrections: corrections.filter((c) => c.status === "PENDING").length,
    incompleteDays: days.filter((d) => d.status === "INCOMPLETE").length,
    possibleAbsences: days.filter((d) => d.status === "POSSIBLE_ABSENCE").length,
  };
}

export async function getApproval(eaId: number, month: string) {
  const r = await pool.query(
    `SELECT ra.id, u.full_name AS approved_by_name, ra.notes, ra.snapshot,
            to_char(ra.approved_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS approved_at
       FROM report_approvals ra JOIN users u ON u.id = ra.approved_by
      WHERE ra.employee_assignment_id = $1 AND ra.month = $2::date`,
    [eaId, `${month}-01`]
  );
  return r.rows[0] ?? null;
}

export async function approveTeacherReport(eaId: number, month: string, userId: number, opts: { notes?: string | null; acknowledgeAbsences?: boolean }) {
  const report = await teacherMonthlyReport(eaId, month);
  if (report.approval) throw new HttpError(409, "التقرير معتمد مسبقاً");
  if (!report.period.complete) throw new HttpError(400, "لا يمكن اعتماد تقرير شهر لم ينتهِ بعد");
  const p = report.pending;
  if (p.pendingCorrections > 0) throw new HttpError(400, `يوجد ${p.pendingCorrections} تصحيح حضور بانتظار القرار — راجعه أولاً`);
  if (p.incompleteDays > 0) throw new HttpError(400, `يوجد ${p.incompleteDays} يوم بتسجيل ناقص — صحّحه أولاً`);
  if (p.possibleAbsences > 0 && !opts.acknowledgeAbsences) {
    throw new HttpError(400, `يوجد ${p.possibleAbsences} يوم غياب محتمل — أكّد أنك راجعتها`);
  }
  const snapshot = { dayCounts: report.dayCounts, quota: report.quota, contractEstimate: report.contractEstimate, possibleAbsencesAcknowledged: p.possibleAbsences };
  await pool.query(
    "INSERT INTO report_approvals (employee_assignment_id, month, approved_by, notes, snapshot) VALUES ($1, $2::date, $3, $4, $5)",
    [eaId, `${month}-01`, userId, opts.notes ?? null, JSON.stringify(snapshot)]
  );
}

// ---------------------------------------------------------------- FR-RPT-04: school monthly report

export async function schoolMonthlyReport(schoolId: number, month: string) {
  const range = monthRange(month);
  const [school, days, quotaRows, pf, approvals] = await Promise.all([
    pool.query("SELECT id, name FROM schools WHERE id = $1", [schoolId]),
    classifyRange(range.from, range.to, { schoolId }),
    getQuotaSummary(range.from, range.to, { schoolId }),
    periodFactor(range.from, range.to),
    pool.query(
      `SELECT ra.employee_assignment_id FROM report_approvals ra JOIN employee_assignments ea ON ea.id = ra.employee_assignment_id
        WHERE ea.school_id = $1 AND ra.month = $2::date`,
      [schoolId, range.from]
    ),
  ]);
  if (!school.rowCount) throw new HttpError(404, "المدرسة غير موجودة");
  const approved = new Set(approvals.rows.map((r) => Number(r.employee_assignment_id)));
  const quotaBy = new Map(quotaRows.map((q) => [Number(q.employee_assignment_id), q]));
  const byEa = new Map<number, DayRow[]>();
  for (const d of days) {
    if (!byEa.has(d.employee_assignment_id)) byEa.set(d.employee_assignment_id, []);
    byEa.get(d.employee_assignment_id)!.push(d);
  }
  const rows = [...byEa.entries()].map(([ea, list]) => {
    const q = quotaFigures(quotaBy.get(ea), pf.factor);
    const first = list[0]!;
    return {
      assignmentId: ea,
      employeeNumber: first.employee_number,
      name: first.full_name,
      position: first.position_type,
      ...countDays(list),
      quota: q,
      reportApproved: first.position_type === "TEACHER" ? approved.has(ea) : null,
    };
  });
  const totals = countDays(days);
  const teachers = rows.filter((r) => r.quota);
  const qt = teachers.reduce((t, r) => ({ required: t.required + r.quota!.required - r.quota!.excused, executed: t.executed + r.quota!.executed }), { required: 0, executed: 0 });
  return {
    school: school.rows[0], month, period: range, workingDays: pf.workingDays,
    rows,
    totals: {
      ...totals,
      people: rows.length,
      teachers: teachers.length,
      lessonsDue: round1(qt.required),
      lessonsExecuted: qt.executed,
      quotaCompletion: qt.required > 0 ? round1(Math.min(qt.executed / qt.required, 1) * 100) : null,
      reportsApproved: teachers.filter((r) => r.reportApproved).length,
    },
  };
}

// ---------------------------------------------------------------- FR-RPT-05: requests report

export async function requestsReport(schoolIds: number[] | null, from: string, to: string) {
  const overdueDays = Number(await getSetting<number>("request_overdue_days") ?? 7);
  const r = await pool.query(
    `WITH req AS (
       SELECT sr.*, s.name AS school_name, d.name AS directorate_name,
              (SELECT MIN(h.changed_at) FROM request_status_history h WHERE h.request_id = sr.id AND h.new_status IN ('APPROVED', 'REJECTED')) AS decided_at,
              (SELECT MIN(h.changed_at) FROM request_status_history h WHERE h.request_id = sr.id AND h.new_status = 'COMPLETED') AS completed_at
         FROM school_requests sr JOIN schools s ON s.id = sr.school_id JOIN directorates d ON d.id = s.directorate_id
        WHERE sr.status <> 'DRAFT' AND ($1::bigint[] IS NULL OR sr.school_id = ANY($1))
          AND (sr.submitted_at AT TIME ZONE 'Asia/Damascus')::date BETWEEN $2 AND $3
     )
     SELECT id, request_number, school_id, school_name, directorate_name, request_type, title, status, severity,
            to_char(submitted_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD') AS submitted_date,
            ROUND((EXTRACT(EPOCH FROM decided_at - submitted_at) / 86400)::numeric, 1)::float AS days_to_decision,
            ROUND((EXTRACT(EPOCH FROM completed_at - submitted_at) / 86400)::numeric, 1)::float AS days_to_completion,
            FLOOR(EXTRACT(EPOCH FROM now() - submitted_at) / 86400)::int AS waiting_days,
            (status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS')
              AND EXTRACT(EPOCH FROM now() - submitted_at) / 86400 > $4) AS overdue
       FROM req ORDER BY submitted_at DESC`,
    [schoolIds, from, to, overdueDays]
  );
  const OPEN = ["SUBMITTED", "UNDER_REVIEW", "RETURNED", "APPROVED", "IN_PROGRESS"];
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const bySchool = new Map<number, typeof r.rows>();
  for (const x of r.rows) {
    if (!bySchool.has(Number(x.school_id))) bySchool.set(Number(x.school_id), []);
    bySchool.get(Number(x.school_id))!.push(x);
  }
  const summarize = (list: typeof r.rows) => ({
    total: list.length,
    open: list.filter((x) => OPEN.includes(x.status)).length,
    approved: list.filter((x) => ["APPROVED", "IN_PROGRESS", "COMPLETED", "CLOSED"].includes(x.status)).length,
    rejected: list.filter((x) => x.status === "REJECTED").length,
    completed: list.filter((x) => ["COMPLETED", "CLOSED"].includes(x.status)).length,
    overdue: list.filter((x) => x.overdue).length,
    avgDaysToDecision: avg(list.map((x) => x.days_to_decision)),
    avgDaysToCompletion: avg(list.map((x) => x.days_to_completion)),
  });
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const x of r.rows) {
    byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
    byType[x.request_type] = (byType[x.request_type] ?? 0) + 1;
  }
  return {
    period: { from, to }, overdueDays,
    totals: summarize(r.rows), byStatus, byType,
    schools: [...bySchool.values()].map((list) => ({ schoolId: Number(list[0].school_id), schoolName: list[0].school_name, ...summarize(list) })),
    overdue: r.rows.filter((x) => x.overdue),
    requests: r.rows,
  };
}

interface CentralRow {
  schoolId: number; schoolName: string; stage: number; directorateId: number; directorateName: string;
  students: number; teachers: number; staff: number; attendanceRate: number | null; possibleAbsenceDays: number; lateDays: number;
  quotaCompletion: number | null; requestsOpen: number; requestsOverdue: number; avgDaysToDecision: number | null;
  outages: number; resultsAverage: number | null; _dc: DayCounts; _due: number; _executed: number;
}

// ---------------------------------------------------------------- FR-RPT-06: central aggregated report (no individuals)

export async function centralReport(schoolIds: number[] | null, from: string, to: string) {
  const schools = await pool.query(
    `SELECT s.id, s.name, s.stage, d.id AS directorate_id, d.name AS directorate_name,
            (SELECT COUNT(*) FROM student_enrollments se JOIN sections sc ON sc.id = se.section_id JOIN classes c ON c.id = sc.class_id
              WHERE c.school_id = s.id AND se.status = 'ACTIVE')::int AS students,
            (SELECT COUNT(*) FROM employee_assignments ea WHERE ea.school_id = s.id AND ea.is_active AND ea.position_type = 'TEACHER')::int AS teachers,
            (SELECT COUNT(*) FROM employee_assignments ea WHERE ea.school_id = s.id AND ea.is_active AND ea.position_type <> 'TEACHER')::int AS staff,
            (SELECT COUNT(*) FROM power_outages po WHERE po.school_id = s.id
              AND (po.starts_at AT TIME ZONE 'Asia/Damascus')::date BETWEEN $2 AND $3)::int AS outages,
            (SELECT ROUND(AVG(tr.score), 1) FROM term_results tr JOIN result_sheets rs ON rs.id = tr.sheet_id AND rs.status = 'SUBMITTED'
               JOIN teaching_assignments ta ON ta.id = rs.teaching_assignment_id JOIN sections sc ON sc.id = ta.section_id
               JOIN classes c ON c.id = sc.class_id WHERE c.school_id = s.id)::float AS results_average
       FROM schools s JOIN directorates d ON d.id = s.directorate_id
      WHERE ($1::bigint[] IS NULL OR s.id = ANY($1))
      ORDER BY d.name, s.name`,
    [schoolIds, from, to]
  );
  const req = await requestsReport(schoolIds, from, to);
  const reqBy = new Map(req.schools.map((x) => [x.schoolId, x]));
  const pf = await periodFactor(from, to);
  const quota = await getQuotaSummary(from, to, {});

  const rows: CentralRow[] = [];
  for (const s of schools.rows) {
    const days = await classifyRange(from, to, { schoolId: Number(s.id) });
    const dc = countDays(days);
    const qs = quota.filter((q) => Number(q.school_id) === Number(s.id)).map((q) => quotaFigures(q, pf.factor)!);
    const due = qs.reduce((t, q) => t + Math.max(q.required - q.excused, 0), 0);
    const executed = qs.reduce((t, q) => t + q.executed, 0);
    const rq = reqBy.get(Number(s.id));
    rows.push({
      schoolId: Number(s.id), schoolName: s.name, stage: s.stage, directorateId: Number(s.directorate_id), directorateName: s.directorate_name,
      students: s.students, teachers: s.teachers, staff: s.staff,
      attendanceRate: dc.attendanceRate, possibleAbsenceDays: dc.possibleAbsence, lateDays: dc.late,
      quotaCompletion: due ? round1(Math.min(executed / due, 1) * 100) : null,
      requestsOpen: rq?.open ?? 0, requestsOverdue: rq?.overdue ?? 0, avgDaysToDecision: rq?.avgDaysToDecision ?? null,
      outages: s.outages, resultsAverage: s.results_average,
      _dc: dc, _due: due, _executed: executed,
    });
  }
  const group = (list: typeof rows) => {
    const dc = list.reduce((t, r) => ({ duty: t.duty + r._dc.dutyDays, att: t.att + r._dc.present + r._dc.late + r._dc.earlyLeave + r._dc.incomplete }), { duty: 0, att: 0 });
    const due = list.reduce((t, r) => t + r._due, 0);
    const ex = list.reduce((t, r) => t + r._executed, 0);
    return {
      schools: list.length,
      students: list.reduce((t, r) => t + r.students, 0),
      teachers: list.reduce((t, r) => t + r.teachers, 0),
      staff: list.reduce((t, r) => t + r.staff, 0),
      attendanceRate: dc.duty ? round1((dc.att / dc.duty) * 100) : null,
      quotaCompletion: due ? round1(Math.min(ex / due, 1) * 100) : null,
      requestsOpen: list.reduce((t, r) => t + r.requestsOpen, 0),
      requestsOverdue: list.reduce((t, r) => t + r.requestsOverdue, 0),
      outages: list.reduce((t, r) => t + r.outages, 0),
    };
  };
  const dirs = new Map<number, typeof rows>();
  for (const r of rows) {
    if (!dirs.has(r.directorateId)) dirs.set(r.directorateId, []);
    dirs.get(r.directorateId)!.push(r);
  }
  const clean = rows.map(({ _dc, _due, _executed, ...r }) => r);
  return {
    period: { from, to },
    totals: group(rows),
    directorates: [...dirs.values()].map((list) => ({ directorateId: list[0]!.directorateId, directorateName: list[0]!.directorateName, ...group(list) })),
    schools: clean,
  };
}
