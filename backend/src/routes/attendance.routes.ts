import { Router } from "express";
import pool from "../config/database.js";
import { AuthRequest, AuthenticatedUser, authenticateToken, requireRole } from "../middleware/auth.middleware.js";
import { resolveReadableSchool } from "../services/scope.service.js";
import { audit } from "../services/audit.service.js";
import { classifyRange, localMs } from "../services/attendance.service.js";
import { buildMonthlyAttendanceWorkbook } from "../services/attendanceExport.service.js";
import { HttpError, handle, optionalDate, optionalString, requireId, requireString } from "../utils/http.js";

// FR-ATT-06..19, 25..27
const router = Router();
router.use(authenticateToken);

const READERS = requireRole("DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY");
const SCHOOL_MANAGERS = requireRole("SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY");
const PRINCIPAL = requireRole("SCHOOL_PRINCIPAL");

const todayLocal = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

function requireDate(v: unknown, label = "التاريخ"): string {
  const d = optionalDate(v);
  if (!d) throw new HttpError(400, `${label} مطلوب`);
  return d;
}

/** The assignment must be in the user's school (writes) — or readable scope (reads). */
async function assignmentSchool(eaId: number): Promise<{ school_id: number; employee_id: number }> {
  const r = await pool.query("SELECT school_id, employee_id FROM employee_assignments WHERE id = $1 AND is_active", [eaId]);
  if (!r.rowCount) throw new HttpError(404, "الموظف غير موجود");
  return { school_id: Number(r.rows[0].school_id), employee_id: Number(r.rows[0].employee_id) };
}
function assertOwnSchool(user: AuthenticatedUser, schoolId: number) {
  if (user.schoolId !== schoolId) throw new HttpError(403, "الموظف لا يتبع لمدرستك");
}

// ---------------------------------------------------------------- FR-ATT-09/10: daily classification for a school
router.get(
  "/daily",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const schoolId = await resolveReadableSchool(req.user!, req.query.schoolId);
    const date = optionalDate(req.query.date) ?? todayLocal();
    const rows = await classifyRange(date, date, { schoolId });
    res.json({ success: true, data: { date, rows } });
  })
);

// One person's days (teacher/staff: own record; managers: in scope)
router.get(
  "/assignments/:id/days",
  requireRole("DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "TEACHER", "SUPERVISOR", "SCHOOL_STAFF"),
  handle<AuthRequest>(async (req, res) => {
    const eaId = requireId(req.params.id);
    const a = await assignmentSchool(eaId);
    const u = req.user!;
    if (["TEACHER", "SUPERVISOR", "SCHOOL_STAFF"].includes(u.role)) {
      if (a.employee_id !== u.employeeId) throw new HttpError(403, "يمكنك الاطلاع على حضورك فقط");
    } else {
      await resolveReadableSchool(u, a.school_id);
    }
    const to = optionalDate(req.query.to) ?? todayLocal();
    const from = optionalDate(req.query.from) ?? to.slice(0, 8) + "01";
    if (from > to) throw new HttpError(400, "الفترة غير صحيحة");
    const rows = await classifyRange(from, to, { assignmentId: eaId });
    res.json({ success: true, data: { from, to, rows } });
  })
);

// The logged-in employee's own assignments (for "my attendance")
router.get(
  "/my-assignments",
  handle<AuthRequest>(async (req, res) => {
    const r = await pool.query(
      `SELECT ea.id, s.name AS school_name, ea.position_type FROM employee_assignments ea JOIN schools s ON s.id = ea.school_id
        WHERE ea.employee_id = $1 AND ea.is_active ORDER BY ea.id`,
      [req.user!.employeeId ?? 0]
    );
    res.json({ success: true, data: r.rows });
  })
);

// ---------------------------------------------------------------- FR-ATT-06: raw events of one person/day
router.get(
  "/assignments/:id/events",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const eaId = requireId(req.params.id);
    await resolveReadableSchool(req.user!, (await assignmentSchool(eaId)).school_id);
    const date = requireDate(req.query.date);
    const r = await pool.query(
      `SELECT ae.id, ae.event_type, to_char(ae.event_time AT TIME ZONE 'Asia/Damascus', 'HH24:MI:SS') AS event_time,
              to_char(ae.recorded_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS received_at,
              ae.verification_method, ae.verification_status, ae.match_score, ae.manual_reason, ae.device_label,
              u.full_name AS recorded_by_name
         FROM attendance_events ae LEFT JOIN users u ON u.id = ae.recorded_by
        WHERE ae.employee_assignment_id = $1
          AND (ae.event_time AT TIME ZONE 'Asia/Damascus')::date = $2
        ORDER BY ae.event_time`,
      [eaId, date]
    );
    res.json({ success: true, data: r.rows });
  })
);

// ---------------------------------------------------------------- FR-ATT-14: manual (non-biometric) entry under the principal
router.post(
  "/events/manual",
  PRINCIPAL,
  handle<AuthRequest>(async (req, res) => {
    const eaId = requireId(req.body?.employeeAssignmentId, "الموظف");
    assertOwnSchool(req.user!, (await assignmentSchool(eaId)).school_id);
    const type = req.body?.eventType;
    if (type !== "IN" && type !== "OUT") throw new HttpError(400, "نوع الحركة غير صالح");
    const date = requireDate(req.body?.date);
    const time = String(req.body?.time ?? "");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, "الوقت غير صالح");
    const at = localMs(date, time);
    if (at > Date.now() + 5 * 60_000) throw new HttpError(400, "لا يمكن تسجيل حركة في المستقبل");
    const reason = requireString(req.body?.reason, "سبب الإدخال اليدوي", 500);
    const r = await pool.query(
      `INSERT INTO attendance_events
         (employee_assignment_id, event_type, event_time, verification_method, recorded_by, manual_reason, verification_status)
       VALUES ($1, $2, to_timestamp($3 / 1000.0), 'MANUAL', $4, $5, 'ACCEPTED') RETURNING id`,
      [eaId, type, at, req.user!.id, reason]
    );
    if (!r.rowCount) throw new HttpError(409, "توجد حركة مماثلة مسجّلة خلال دقيقتين — تم تجاهل التكرار");
    void audit({ userId: req.user!.id, action: "DATA_CREATE", entityType: "attendance_event", entityId: r.rows[0].id, details: { manual: true, type }, req });
    res.status(201).json({ success: true, message: "تم تسجيل الحركة يدوياً" });
  })
);

// ---------------------------------------------------------------- FR-ATT-12/13: corrections
router.get(
  "/corrections",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const schoolId = await resolveReadableSchool(req.user!, req.query.schoolId);
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const r = await pool.query(
      `SELECT c.id, c.work_date::text, c.corrected_status, to_char(c.corrected_in, 'HH24:MI') AS corrected_in,
              to_char(c.corrected_out, 'HH24:MI') AS corrected_out, c.reason, c.status,
              to_char(c.proposed_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS proposed_at,
              c.decision_note, pu.full_name AS proposed_by_name, pu.id AS proposed_by, du.full_name AS decided_by_name,
              e.full_name, e.employee_number, c.employee_assignment_id
         FROM attendance_corrections c
         JOIN employee_assignments ea ON ea.id = c.employee_assignment_id
         JOIN employees e ON e.id = ea.employee_id
         JOIN users pu ON pu.id = c.proposed_by
         LEFT JOIN users du ON du.id = c.decided_by
        WHERE ea.school_id = $1 AND ($2::text IS NULL OR c.status = $2)
        ORDER BY c.status = 'PENDING' DESC, c.proposed_at DESC
        LIMIT 200`,
      [schoolId, status]
    );
    res.json({ success: true, data: r.rows });
  })
);

const CORRECTED = ["PRESENT", "LATE", "EARLY_LEAVE", "ABSENT", "EXCUSED"];

router.post(
  "/corrections",
  SCHOOL_MANAGERS,
  handle<AuthRequest>(async (req, res) => {
    const eaId = requireId(req.body?.employeeAssignmentId, "الموظف");
    assertOwnSchool(req.user!, (await assignmentSchool(eaId)).school_id);
    const date = requireDate(req.body?.workDate, "تاريخ اليوم");
    if (date > todayLocal()) throw new HttpError(400, "لا يمكن تصحيح يوم مستقبلي");
    const status = String(req.body?.correctedStatus ?? "");
    if (!CORRECTED.includes(status)) throw new HttpError(400, "الحالة المقترحة غير صالحة");
    const timeOrNull = (v: unknown) => {
      if (v == null || v === "") return null;
      if (typeof v !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new HttpError(400, "الوقت غير صالح");
      return v;
    };
    const r = await pool.query(
      `INSERT INTO attendance_corrections (employee_assignment_id, work_date, corrected_status, corrected_in, corrected_out, reason, proposed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [eaId, date, status, timeOrNull(req.body?.correctedIn), timeOrNull(req.body?.correctedOut),
       requireString(req.body?.reason, "سبب التصحيح", 1000), req.user!.id]
    ).catch((e) => {
      if (e.code === "23505") throw new HttpError(409, "يوجد تصحيح معلّق لنفس الموظف ونفس اليوم");
      throw e;
    });
    void audit({ userId: req.user!.id, action: "DATA_CREATE", entityType: "attendance_correction", entityId: r.rows[0].id, req });
    res.status(201).json({ success: true, message: "تم إرسال التصحيح لاعتماد مدير المدرسة" });
  })
);

async function decide(req: AuthRequest, approve: boolean) {
  const id = requireId(req.params.id);
  const c = await pool.query(
    `SELECT c.proposed_by, c.status, ea.school_id FROM attendance_corrections c
       JOIN employee_assignments ea ON ea.id = c.employee_assignment_id WHERE c.id = $1`,
    [id]
  );
  if (!c.rowCount) throw new HttpError(404, "التصحيح غير موجود");
  // Principal approves for their school; the directorate can approve within its schools
  // (needed for corrections the principal proposed — FR-ATT-13 forbids self-approval).
  if (req.user!.role === "DIRECTORATE_ADMIN") await resolveReadableSchool(req.user!, Number(c.rows[0].school_id));
  else assertOwnSchool(req.user!, Number(c.rows[0].school_id));
  if (c.rows[0].status !== "PENDING") throw new HttpError(409, "تم البت بهذا التصحيح مسبقاً");
  // FR-ATT-13: the proposer cannot approve their own correction
  if (Number(c.rows[0].proposed_by) === req.user!.id) throw new HttpError(403, "لا يمكنك اعتماد تصحيح اقترحته بنفسك");
  const note = optionalString(req.body?.note, 500);
  if (!approve && !note) throw new HttpError(400, "يرجى كتابة سبب الرفض");
  await pool.query(
    "UPDATE attendance_corrections SET status = $1, decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $4",
    [approve ? "APPROVED" : "REJECTED", req.user!.id, note, id]
  );
  void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "attendance_correction", entityId: id, details: { approve }, req });
}

const APPROVERS = requireRole("SCHOOL_PRINCIPAL", "DIRECTORATE_ADMIN");
router.post("/corrections/:id/approve", APPROVERS, handle<AuthRequest>(async (req, res) => {
  await decide(req, true);
  res.json({ success: true, message: "تم اعتماد التصحيح" });
}));
router.post("/corrections/:id/reject", APPROVERS, handle<AuthRequest>(async (req, res) => {
  await decide(req, false);
  res.json({ success: true, message: "تم رفض التصحيح" });
}));

// ---------------------------------------------------------------- FR-ATT-18/19: outages
router.get(
  "/outages",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const schoolId = await resolveReadableSchool(req.user!, req.query.schoolId);
    const r = await pool.query(
      `SELECT o.id, o.outage_type, o.notes,
              to_char(o.starts_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS starts_at,
              to_char(o.ends_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS ends_at,
              ROUND(EXTRACT(EPOCH FROM o.ends_at - o.starts_at) / 60)::int AS minutes, u.full_name AS recorded_by_name
         FROM power_outages o JOIN users u ON u.id = o.recorded_by
        WHERE o.school_id = $1 ORDER BY o.starts_at DESC LIMIT 100`,
      [schoolId]
    );
    res.json({ success: true, data: r.rows });
  })
);

router.post(
  "/outages",
  PRINCIPAL,
  handle<AuthRequest>(async (req, res) => {
    const date = requireDate(req.body?.date);
    const from = String(req.body?.from ?? "");
    const to = String(req.body?.to ?? "");
    if (!/^\d\d:\d\d$/.test(from) || !/^\d\d:\d\d$/.test(to)) throw new HttpError(400, "يجب تحديد وقت البداية والنهاية (FR-ATT-19)");
    if (to <= from) throw new HttpError(400, "وقت النهاية يجب أن يكون بعد البداية");
    const type = req.body?.outageType === "INTERNET" ? "INTERNET" : "POWER";
    const r = await pool.query(
      `INSERT INTO power_outages (school_id, starts_at, ends_at, outage_type, notes, recorded_by)
       VALUES ($1, to_timestamp($2 / 1000.0), to_timestamp($3 / 1000.0), $4, $5, $6) RETURNING id`,
      [req.user!.schoolId, localMs(date, from), localMs(date, to), type, optionalString(req.body?.notes, 500), req.user!.id]
    );
    void audit({ userId: req.user!.id, action: "DATA_CREATE", entityType: "power_outage", entityId: r.rows[0].id, req });
    res.status(201).json({ success: true, message: "تم تسجيل حادثة الانقطاع" });
  })
);

// FR-ATT-19: number of outages per school for the directorate dashboard
router.get(
  "/outages/summary",
  requireRole("DIRECTORATE_ADMIN", "MINISTRY_ADMIN"),
  handle<AuthRequest>(async (req, res) => {
    const u = req.user!;
    const r = await pool.query(
      `SELECT s.id, s.name, COUNT(o.id)::int AS outages,
              COALESCE(ROUND(SUM(EXTRACT(EPOCH FROM o.ends_at - o.starts_at)) / 3600, 1), 0)::float AS hours
         FROM schools s
         LEFT JOIN power_outages o ON o.school_id = s.id AND o.starts_at >= now() - interval '30 days'
        WHERE ($1::bigint IS NULL OR s.directorate_id = $1)
        GROUP BY s.id ORDER BY outages DESC, s.name`,
      [u.role === "DIRECTORATE_ADMIN" ? u.directorateId : null]
    );
    res.json({ success: true, data: r.rows });
  })
);

// ---------------------------------------------------------------- FR-ATT-25/26/27: monthly Excel, principal only
router.get(
  "/export",
  PRINCIPAL,
  handle<AuthRequest>(async (req, res) => {
    const month = String(req.query.month ?? "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "صيغة الشهر غير صحيحة (YYYY-MM)");
    const schoolId = req.user!.schoolId!;
    const { buffer, fileName } = await buildMonthlyAttendanceWorkbook(schoolId, month);
    void audit({ userId: req.user!.id, action: "VIEW_TEACHER_REPORT", entityType: "attendance_excel", entityId: `${schoolId}:${month}`, req });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="attendance-${month}.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  })
);

export default router;
