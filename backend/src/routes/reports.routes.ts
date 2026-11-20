import { Router, type Response } from "express";
import pool from "../config/database.js";
import { AuthRequest, authenticateToken, requireRole } from "../middleware/auth.middleware.js";
import { readableSchoolIds, resolveReadableSchool } from "../services/scope.service.js";
import { audit } from "../services/audit.service.js";
import { HttpError, handle, requireId } from "../utils/http.js";
import {
  approveTeacherReport, centralReport, loadAssignment, parseMonth, periodRange,
  requestsReport, schoolMonthlyReport, teacherMonthlyReport,
} from "../services/reports.service.js";
import { buildWorkbook, type SheetSpec } from "../services/xlsx.service.js";

// FR-RPT-01..09. Individual reports: teacher (self), principal/deputy (own school), directorate (its schools).
// The ministry sees aggregates only (FR-AUTH-09): central + requests reports, never a person's report.
const router = Router();
router.use(authenticateToken);

const TEACHER_REPORT = requireRole("TEACHER", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "DIRECTORATE_ADMIN");
const SCHOOL_REPORT = requireRole("SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "DIRECTORATE_ADMIN");
const AGGREGATE = requireRole("DIRECTORATE_ADMIN", "MINISTRY_ADMIN");

const POSITION: Record<string, string> = { TEACHER: "معلم", PRINCIPAL: "مدير", DEPUTY: "نائب مدير", ADMINISTRATIVE: "إداري", SUPERVISOR: "موجّه" };
const STATUS_AR: Record<string, string> = {
  PRESENT: "حاضر", LATE: "متأخر", EARLY_LEAVE: "خروج مبكر", LATE_EARLY_LEAVE: "تأخر وخروج مبكر", INCOMPLETE: "تسجيل ناقص",
  POSSIBLE_ABSENCE: "غياب محتمل", ABSENT: "غائب", EXCUSED: "إجازة", OUTAGE_EXEMPT: "معفى (انقطاع)", NO_DUTY: "لا دوام", CORRECTED: "مصحّح",
};
const LESSON_AR: Record<string, string> = { EXECUTED: "منفّذة", NOT_EXECUTED: "غير منفّذة", COMPENSATED: "معوّضة", EXCUSED: "إجازة", UPCOMING: "قادمة" };
const REQ_STATUS: Record<string, string> = {
  SUBMITTED: "مقدَّم", UNDER_REVIEW: "قيد الدراسة", RETURNED: "معاد للتوضيح", APPROVED: "مقبول", REJECTED: "مرفوض",
  IN_PROGRESS: "قيد التنفيذ", COMPLETED: "منجز", CLOSED: "مغلق",
};
const REQ_TYPE: Record<string, string> = {
  MAINTENANCE: "صيانة", TEACHERS: "نقص كادر", TEXTBOOKS: "كتب", FURNITURE: "أثاث", COMPUTERS: "حواسيب", OTHER: "أخرى", TEACHER_ACCOUNT: "حساب معلم",
};
const pct = (x: number | null | undefined) => (x == null ? "—" : `${x}%`);

async function sendXlsx(res: Response, fileName: string, sheets: SheetSpec[]) {
  const buffer = await buildWorkbook(sheets);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.send(buffer);
}

/** Teacher assignment visible to this user (FR-RPT-09). */
async function assertTeacherInScope(req: AuthRequest, eaId: number) {
  const a = await loadAssignment(eaId);
  const u = req.user!;
  const ok = u.role === "TEACHER" ? Number(a.employee_id) === u.employeeId : (await readableSchoolIds(u))?.includes(Number(a.school_id)) ?? false;
  if (!ok) {
    void audit({ userId: u.id, action: "ACCESS_DENIED", entityType: "teacher_report", entityId: eaId, req });
    throw new HttpError(403, "لا تملك صلاحية الاطلاع على تقرير هذا المعلم");
  }
  return a;
}

// Teachers the user can pick (teacher: own assignments, one per school)
router.get(
  "/teachers",
  TEACHER_REPORT,
  handle<AuthRequest>(async (req, res) => {
    const u = req.user!;
    const r = u.role === "TEACHER"
      ? await pool.query(
          `SELECT ea.id AS assignment_id, e.full_name, e.employee_number, s.name AS school_name
             FROM employee_assignments ea JOIN employees e ON e.id = ea.employee_id JOIN schools s ON s.id = ea.school_id
            WHERE ea.employee_id = $1 AND ea.is_active AND ea.position_type = 'TEACHER' ORDER BY s.name`, [u.employeeId])
      : await pool.query(
          `SELECT ea.id AS assignment_id, e.full_name, e.employee_number, s.name AS school_name
             FROM employee_assignments ea JOIN employees e ON e.id = ea.employee_id JOIN schools s ON s.id = ea.school_id
            WHERE ea.school_id = $1 AND ea.is_active AND ea.position_type = 'TEACHER' ORDER BY e.full_name`,
          [await resolveReadableSchool(u, req.query.schoolId)]);
    res.json({ success: true, data: r.rows });
  })
);

// FR-RPT-01: teacher monthly report (+ ?format=xlsx)
router.get(
  "/teacher",
  TEACHER_REPORT,
  handle<AuthRequest>(async (req, res) => {
    const eaId = requireId(req.query.assignmentId, "المعلم");
    const month = parseMonth(req.query.month);
    await assertTeacherInScope(req, eaId);
    const r = await teacherMonthlyReport(eaId, month);
    void audit({ userId: req.user!.id, action: "VIEW_TEACHER_REPORT", entityType: "employee_assignment", entityId: eaId, details: { month, format: req.query.format ?? "json" }, req });
    if (req.query.format !== "xlsx") return res.json({ success: true, data: r });

    const dc = r.dayCounts;
    const q = r.quota;
    const summary = [
      ["المعلم", r.teacher.name], ["الرقم الوظيفي", r.teacher.employeeNumber], ["المدرسة", r.teacher.schoolName],
      ["الفترة", `${r.period.from} → ${r.period.to}`], ["أيام الدوام المطلوبة", dc.dutyDays], ["حضور منتظم", dc.present],
      ["تأخر", `${dc.late} (${dc.lateMinutes} دقيقة)`], ["خروج مبكر", `${dc.earlyLeave} (${dc.earlyMinutes} دقيقة)`],
      ["تسجيل ناقص", dc.incomplete], ["غياب محتمل", dc.possibleAbsence], ["غياب", dc.absent], ["إجازة", dc.excused],
      ["معفى بسبب انقطاع", dc.outage], ["أيام مصحّحة", dc.corrected], ["نسبة الحضور", pct(dc.attendanceRate)],
      ["النصاب المطلوب للفترة", q?.required ?? "—"], ["الحصص المنفّذة", q?.executed ?? "—"], ["غير المنفّذة", q?.notExecuted ?? "—"],
      ["حصص الإجازة", q?.excused ?? "—"], ["المتبقي", q?.remaining ?? "—"], ["نسبة إنجاز النصاب", pct(q?.completion)],
      ...(r.contractEstimate ? [["تقدير أجر الوكيل (مؤشر وليس راتباً رسمياً)", `${r.contractEstimate.amount.toLocaleString("ar-SY")} ل.س`]] : []),
      ["حالة الاعتماد", r.approval ? `معتمد — ${r.approval.approved_by_name} ${r.approval.approved_at}` : "غير معتمد"],
    ];
    return sendXlsx(res, `تقرير ${r.teacher.name} ${month}.xlsx`, [
      { name: "الملخص", title: `التقرير الشهري — ${r.teacher.name} — ${month}`, columns: [{ header: "البند", key: "k", width: 34 }, { header: "القيمة", key: "v", width: 34 }],
        rows: summary.map(([k, v]) => ({ k, v })) },
      { name: "الأيام", title: `الحضور اليومي — ${r.teacher.name}`,
        columns: [{ header: "التاريخ", key: "date", width: 12 }, { header: "الحالة", key: "status", width: 16 }, { header: "الدوام المتوقع", key: "exp", width: 14 },
          { header: "الدخول", key: "in", width: 9 }, { header: "الخروج", key: "out", width: 9 }, { header: "التعليل", key: "why", width: 50 }],
        rows: r.days.filter((d) => d.status !== "NO_DUTY").map((d) => ({
          date: d.date, status: STATUS_AR[d.correctedStatus ?? d.status] ?? d.status, exp: d.expectedStart ? `${d.expectedStart}–${d.expectedEnd}` : "",
          in: d.firstIn ?? "—", out: d.lastOut ?? "—", why: d.reasons.join("، "),
        })) },
      { name: "الحصص", title: `سجل الحصص — ${r.teacher.name}`,
        columns: [{ header: "التاريخ", key: "d", width: 12 }, { header: "الحصة", key: "p", width: 7 }, { header: "الوقت", key: "t", width: 13 },
          { header: "المادة", key: "s", width: 16 }, { header: "الشعبة", key: "c", width: 18 }, { header: "الحالة", key: "st", width: 12 }],
        rows: r.lessons.map((l) => ({ d: l.lesson_date, p: l.period_number, t: `${l.start_time}–${l.end_time}`, s: l.subject_name, c: `${l.class_name} / ${l.section_name}`, st: LESSON_AR[l.status] ?? l.status })) },
    ]);
  })
);

// FR-RPT-03: principal approves after reviewing pending cases
router.post(
  "/teacher/approve",
  requireRole("SCHOOL_PRINCIPAL"),
  handle<AuthRequest>(async (req, res) => {
    const eaId = requireId(req.body?.assignmentId, "المعلم");
    const month = parseMonth(req.body?.month);
    const a = await loadAssignment(eaId);
    if (Number(a.school_id) !== req.user!.schoolId) throw new HttpError(403, "المعلم ليس من مدرستك");
    const notes = typeof req.body?.notes === "string" && req.body.notes.trim() ? req.body.notes.trim().slice(0, 1000) : null;
    await approveTeacherReport(eaId, month, req.user!.id, { notes, acknowledgeAbsences: req.body?.acknowledgeAbsences === true });
    void audit({ userId: req.user!.id, action: "REPORT_APPROVE", entityType: "employee_assignment", entityId: eaId, details: { month }, req });
    res.json({ success: true, message: "تم اعتماد التقرير" });
  })
);

// FR-RPT-04: school monthly report
router.get(
  "/school",
  SCHOOL_REPORT,
  handle<AuthRequest>(async (req, res) => {
    const schoolId = await resolveReadableSchool(req.user!, req.query.schoolId);
    const month = parseMonth(req.query.month);
    const r = await schoolMonthlyReport(schoolId, month);
    if (req.query.format !== "xlsx") return res.json({ success: true, data: r });
    const t = r.totals;
    return sendXlsx(res, `تقرير ${r.school.name} ${month}.xlsx`, [{
      name: "تقرير المدرسة", title: `التقرير الشهري المجمّع — ${r.school.name} — ${month} (${r.period.from} → ${r.period.to})`,
      columns: [
        { header: "الاسم", key: "name", width: 26 }, { header: "الرقم الوظيفي", key: "num", width: 12 }, { header: "الصفة", key: "pos", width: 10 },
        { header: "أيام الدوام", key: "duty", width: 9 }, { header: "حضور", key: "present", width: 7 }, { header: "تأخر", key: "late", width: 7 },
        { header: "خروج مبكر", key: "early", width: 8 }, { header: "ناقص", key: "inc", width: 7 }, { header: "غياب محتمل", key: "pa", width: 9 },
        { header: "إجازة", key: "exc", width: 7 }, { header: "نسبة الحضور", key: "rate", width: 10 },
        { header: "النصاب المطلوب", key: "req", width: 10 }, { header: "المنفّذ", key: "ex", width: 8 }, { header: "إنجاز النصاب", key: "comp", width: 10 },
        { header: "التقرير", key: "appr", width: 10 },
      ],
      rows: r.rows.map((x) => ({
        name: x.name, num: x.employeeNumber, pos: POSITION[x.position] ?? x.position, duty: x.dutyDays, present: x.present, late: x.late,
        early: x.earlyLeave, inc: x.incomplete, pa: x.possibleAbsence, exc: x.excused, rate: pct(x.attendanceRate),
        req: x.quota?.required ?? "", ex: x.quota?.executed ?? "", comp: x.quota ? pct(x.quota.completion) : "",
        appr: x.reportApproved == null ? "" : x.reportApproved ? "معتمد" : "غير معتمد",
      })),
      totals: { name: "المجموع", duty: t.dutyDays, present: t.present, late: t.late, early: t.earlyLeave, inc: t.incomplete, pa: t.possibleAbsence,
        exc: t.excused, rate: pct(t.attendanceRate), req: t.lessonsDue, ex: t.lessonsExecuted, comp: pct(t.quotaCompletion), appr: `${t.reportsApproved}/${t.teachers}` },
    }]);
  })
);

// FR-RPT-05: requests report (directorate: its schools; ministry: all)
router.get(
  "/requests",
  AGGREGATE,
  handle<AuthRequest>(async (req, res) => {
    const { from, to } = periodRange(req.query.from, req.query.to);
    let ids = await readableSchoolIds(req.user!);
    if (req.query.schoolId) ids = [await resolveReadableSchool(req.user!, req.query.schoolId)];
    const r = await requestsReport(ids, from, to);
    if (req.query.format !== "xlsx") return res.json({ success: true, data: r });
    const sumCols = [
      { header: "المدرسة", key: "schoolName", width: 26 }, { header: "الإجمالي", key: "total", width: 9 }, { header: "مفتوحة", key: "open", width: 9 },
      { header: "مقبولة", key: "approved", width: 9 }, { header: "مرفوضة", key: "rejected", width: 9 }, { header: "منجزة", key: "completed", width: 9 },
      { header: "متأخرة", key: "overdue", width: 9 }, { header: "متوسط أيام القرار", key: "avgDaysToDecision", width: 13 }, { header: "متوسط أيام الإنجاز", key: "avgDaysToCompletion", width: 13 },
    ];
    return sendXlsx(res, `تقرير الطلبات ${from} ${to}.xlsx`, [
      { name: "حسب المدرسة", title: `تقرير الطلبات — ${from} → ${to}`, columns: sumCols, rows: r.schools, totals: { schoolName: "المجموع", ...r.totals } },
      { name: "الطلبات", title: `قائمة الطلبات — ${from} → ${to} (متأخر = أكثر من ${r.overdueDays} أيام)`,
        columns: [{ header: "الرقم", key: "request_number", width: 16 }, { header: "المدرسة", key: "school_name", width: 24 }, { header: "النوع", key: "type", width: 12 },
          { header: "العنوان", key: "title", width: 30 }, { header: "الحالة", key: "status", width: 12 }, { header: "تاريخ التقديم", key: "submitted_date", width: 12 },
          { header: "أيام حتى القرار", key: "days_to_decision", width: 11 }, { header: "أيام الانتظار", key: "waiting_days", width: 10 }, { header: "متأخر", key: "late", width: 7 }],
        rows: r.requests.map((x) => ({ ...x, type: REQ_TYPE[x.request_type] ?? x.request_type, status: REQ_STATUS[x.status] ?? x.status, late: x.overdue ? "نعم" : "" })) },
    ]);
  })
);

// FR-RPT-06: central aggregated report by directorate / school / period
router.get(
  "/central",
  AGGREGATE,
  handle<AuthRequest>(async (req, res) => {
    const { from, to } = periodRange(req.query.from, req.query.to);
    const r = await centralReport(await readableSchoolIds(req.user!), from, to);
    if (req.query.format !== "xlsx") return res.json({ success: true, data: r });
    const cols = [
      { header: "المدارس", key: "schools", width: 8 }, { header: "الطلاب", key: "students", width: 8 }, { header: "المعلمون", key: "teachers", width: 9 },
      { header: "الإداريون", key: "staff", width: 9 }, { header: "نسبة الحضور", key: "att", width: 10 }, { header: "إنجاز النصاب", key: "quota", width: 10 },
      { header: "طلبات مفتوحة", key: "requestsOpen", width: 10 }, { header: "طلبات متأخرة", key: "requestsOverdue", width: 10 }, { header: "انقطاعات", key: "outages", width: 9 },
    ];
    const fmt = <T extends { attendanceRate: number | null; quotaCompletion: number | null }>(x: T) => ({ ...x, att: pct(x.attendanceRate), quota: pct(x.quotaCompletion) });
    return sendXlsx(res, `التقرير المركزي ${from} ${to}.xlsx`, [
      { name: "حسب المديرية", title: `التقرير المركزي — ${from} → ${to}`, columns: [{ header: "المديرية", key: "directorateName", width: 24 }, ...cols],
        rows: r.directorates.map(fmt), totals: { directorateName: "المجموع", ...fmt(r.totals) } },
      { name: "حسب المدرسة", title: `التقرير المركزي حسب المدرسة — ${from} → ${to}`,
        columns: [{ header: "المديرية", key: "directorateName", width: 20 }, { header: "المدرسة", key: "schoolName", width: 24 }, { header: "الحلقة", key: "stage", width: 7 },
          ...cols.filter((c) => c.key !== "schools"), { header: "متوسط المحصّلات", key: "resultsAverage", width: 11 }],
        rows: r.schools.map(fmt) },
    ]);
  })
);

export default router;
