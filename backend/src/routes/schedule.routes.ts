import { Router } from "express";
import pool from "../config/database.js";
import { AuthRequest, AuthenticatedUser, authenticateToken, requireRole } from "../middleware/auth.middleware.js";
import { resolveReadableSchool } from "../services/scope.service.js";
import { audit } from "../services/audit.service.js";
import { getLessons, getQuotaSummary, getSetting, weekRange } from "../services/schedule.service.js";
import { HttpError, handle, optionalDate, optionalString, requireId } from "../utils/http.js";

// FR-SCH-01, 05, 06, 07, 08, 09, 10, 11
const router = Router();
router.use(authenticateToken);

const READERS = requireRole("DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY");
const EDITORS = requireRole("SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY");
const PRINCIPAL = requireRole("SCHOOL_PRINCIPAL");

async function sectionSchool(sectionId: number): Promise<number> {
  const r = await pool.query(
    "SELECT c.school_id FROM sections sc JOIN classes c ON c.id = sc.class_id WHERE sc.id = $1",
    [sectionId]
  );
  if (!r.rowCount) throw new HttpError(404, "الشعبة غير موجودة");
  return Number(r.rows[0].school_id);
}

function assertOwnSchool(user: AuthenticatedUser, schoolId: number) {
  if (user.schoolId !== schoolId) throw new HttpError(403, "هذه الشعبة لا تتبع لمدرستك");
}

// ---------------------------------------------------------------- settings used by the grid
router.get(
  "/config",
  handle<AuthRequest>(async (_req, res) => {
    res.json({
      success: true,
      data: {
        periodTimes: await getSetting<Record<string, string>>("period_times"),
        workDays: await getSetting<number[]>("work_days"),
        lessonMinutes: Number(await getSetting<number>("lesson_duration_minutes")),
      },
    });
  })
);

// ---------------------------------------------------------------- FR-SCH-01: section timetable
router.get(
  "/sections/:id/timetable",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const sectionId = requireId(req.params.id);
    await resolveReadableSchool(req.user!, await sectionSchool(sectionId));
    const periods = await pool.query(
      `SELECT tp.id, tp.day_of_week, tp.period_number, to_char(tp.start_time, 'HH24:MI') AS start_time,
              ta.id AS teaching_assignment_id, sub.name AS subject_name, e.full_name AS teacher_name
         FROM timetable_periods tp
         JOIN timetables t ON t.id = tp.timetable_id AND t.is_active
         JOIN teaching_assignments ta ON ta.id = tp.teaching_assignment_id
         JOIN subjects sub ON sub.id = ta.subject_id
         JOIN employee_assignments ea ON ea.id = ta.employee_assignment_id
         JOIN employees e ON e.id = ea.employee_id
        WHERE tp.section_id = $1`,
      [sectionId]
    );
    // What can be placed in this section: its subject ↔ teacher assignments, with scheduled vs. planned units
    const options = await pool.query(
      `SELECT ta.id AS teaching_assignment_id, sub.name AS subject_name, e.full_name AS teacher_name,
              ta.weekly_quota_units::float AS planned_units,
              (SELECT COUNT(*) FROM timetable_periods tp WHERE tp.teaching_assignment_id = ta.id)::int AS scheduled_units
         FROM teaching_assignments ta
         JOIN subjects sub ON sub.id = ta.subject_id
         JOIN employee_assignments ea ON ea.id = ta.employee_assignment_id AND ea.is_active
         JOIN employees e ON e.id = ea.employee_id
        WHERE ta.section_id = $1 AND ta.is_active
        ORDER BY sub.id`,
      [sectionId]
    );
    res.json({ success: true, data: { periods: periods.rows, options: options.rows } });
  })
);

// Assign a subject in a section to a teacher of this school
router.post(
  "/teaching-assignments",
  EDITORS,
  handle<AuthRequest>(async (req, res) => {
    const sectionId = requireId(req.body?.sectionId, "الشعبة");
    assertOwnSchool(req.user!, await sectionSchool(sectionId));
    const subjectId = requireId(req.body?.subjectId, "المادة");
    const eaId = requireId(req.body?.employeeAssignmentId, "المعلم");
    const units = Number(req.body?.weeklyUnits);
    if (!(units > 0 && units <= 12)) throw new HttpError(400, "عدد الحصص الأسبوعية غير صالح");
    const own = await pool.query(
      "SELECT 1 FROM employee_assignments WHERE id = $1 AND school_id = $2 AND is_active AND position_type = 'TEACHER'",
      [eaId, req.user!.schoolId]
    );
    if (!own.rowCount) throw new HttpError(400, "المعلم لا يتبع لمدرستك");
    const dup = await pool.query(
      "SELECT 1 FROM teaching_assignments WHERE section_id = $1 AND subject_id = $2 AND is_active",
      [sectionId, subjectId]
    );
    if (dup.rowCount) throw new HttpError(409, "هذه المادة مسندة مسبقاً لمعلم في هذه الشعبة");
    const r = await pool.query(
      `INSERT INTO teaching_assignments (employee_assignment_id, section_id, subject_id, weekly_quota_units, start_date)
       VALUES ($1, $2, $3, $4, CURRENT_DATE) RETURNING id`,
      [eaId, sectionId, subjectId, units]
    );
    void audit({ userId: req.user!.id, action: "DATA_CREATE", entityType: "teaching_assignment", entityId: r.rows[0].id, req });
    res.status(201).json({ success: true, message: "تم إسناد المادة للمعلم", data: r.rows[0] });
  })
);

// Put a lesson in a cell (replaces what is there)
router.put(
  "/sections/:id/periods",
  EDITORS,
  handle<AuthRequest>(async (req, res) => {
    const sectionId = requireId(req.params.id);
    assertOwnSchool(req.user!, await sectionSchool(sectionId));
    const day = Number(req.body?.dayOfWeek);
    const period = Number(req.body?.periodNumber);
    const workDays = await getSetting<number[]>("work_days");
    const times = await getSetting<Record<string, string>>("period_times");
    if (!workDays.includes(day)) throw new HttpError(400, "اليوم ليس من أيام الدوام");
    if (!times[String(period)]) throw new HttpError(400, "رقم الحصة غير معرّف بالإعدادات");
    const taId = requireId(req.body?.teachingAssignmentId, "المادة/المعلم");
    const ta = await pool.query("SELECT 1 FROM teaching_assignments WHERE id = $1 AND section_id = $2 AND is_active", [taId, sectionId]);
    if (!ta.rowCount) throw new HttpError(400, "الإسناد لا يتبع لهذه الشعبة");
    const minutes = Number(await getSetting<number>("lesson_duration_minutes"));

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let tt = await client.query(
        "SELECT id FROM timetables WHERE section_id = $1 AND is_active ORDER BY id DESC LIMIT 1",
        [sectionId]
      );
      if (!tt.rowCount) {
        tt = await client.query(
          `INSERT INTO timetables (section_id, academic_year_id, name, effective_from, is_approved)
           VALUES ($1, (SELECT id FROM academic_years WHERE is_current LIMIT 1), $2, CURRENT_DATE, true) RETURNING id`,
          [sectionId, `برنامج الشعبة ${sectionId}`]
        );
      }
      const ttId = tt.rows[0].id;
      // Keep lesson history: only delete a cell that has no recorded execution
      const existing = await client.query(
        "SELECT id FROM timetable_periods WHERE timetable_id = $1 AND day_of_week = $2 AND period_number = $3",
        [ttId, day, period]
      );
      if (existing.rowCount) {
        await client.query(
          "UPDATE timetable_periods SET teaching_assignment_id = $1 WHERE id = $2",
          [taId, existing.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO timetable_periods (timetable_id, teaching_assignment_id, section_id, day_of_week, period_number, start_time, end_time)
           VALUES ($1, $2, $3, $4, $5, $6::time, $6::time + make_interval(mins => $7))`,
          [ttId, taId, sectionId, day, period, times[String(period)], minutes]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "timetable", entityId: sectionId, details: { day, period, taId }, req });
    res.json({ success: true, message: "تم حفظ الحصة" });
  })
);

router.delete(
  "/sections/:id/periods",
  EDITORS,
  handle<AuthRequest>(async (req, res) => {
    const sectionId = requireId(req.params.id);
    assertOwnSchool(req.user!, await sectionSchool(sectionId));
    const day = Number(req.query.dayOfWeek);
    const period = Number(req.query.periodNumber);
    const r = await pool.query(
      `DELETE FROM timetable_periods tp USING timetables t
        WHERE t.id = tp.timetable_id AND t.is_active AND tp.section_id = $1 AND tp.day_of_week = $2 AND tp.period_number = $3
          AND NOT EXISTS (SELECT 1 FROM lesson_executions le WHERE le.timetable_period_id = tp.id)`,
      [sectionId, day, period]
    );
    if (!r.rowCount) throw new HttpError(409, "لا يمكن حذف هذه الحصة (غير موجودة أو لها سجل تنفيذ)");
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "timetable", entityId: sectionId, details: { day, period, removed: true }, req });
    res.json({ success: true, message: "تم حذف الحصة" });
  })
);

// ---------------------------------------------------------------- FR-SCH-06/07/10: weekly quota per teacher
router.get(
  "/quota",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const schoolId = await resolveReadableSchool(req.user!, req.query.schoolId);
    const week = weekRange(typeof req.query.date === "string" ? req.query.date : undefined);
    const rows = await getQuotaSummary(week.from, week.to, { schoolId });
    res.json({ success: true, data: { week, teachers: rows } });
  })
);

/** Which assignment may the user see lessons for? Teachers: only their own (FR-SCH-11). */
async function resolveAssignment(user: AuthenticatedUser, raw: unknown): Promise<number> {
  const eaId = requireId(raw, "المعلم");
  const r = await pool.query(
    "SELECT employee_id, school_id FROM employee_assignments WHERE id = $1 AND position_type = 'TEACHER'",
    [eaId]
  );
  if (!r.rowCount) throw new HttpError(404, "المعلم غير موجود");
  if (user.role === "TEACHER") {
    if (Number(r.rows[0].employee_id) !== user.employeeId) throw new HttpError(403, "يمكنك الاطلاع على جدولك فقط");
  } else {
    await resolveReadableSchool(user, r.rows[0].school_id);
  }
  return eaId;
}

// Lessons of one teacher assignment in a week + summary (used by the teacher page and the principal drill-down)
router.get(
  "/assignments/:id/week",
  requireRole("DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "TEACHER"),
  handle<AuthRequest>(async (req, res) => {
    const eaId = await resolveAssignment(req.user!, req.params.id);
    const week = weekRange(typeof req.query.date === "string" ? req.query.date : undefined);
    const [lessons, summary] = await Promise.all([
      getLessons(week.from, week.to, { assignmentId: eaId }),
      getQuotaSummary(week.from, week.to, { assignmentId: eaId }),
    ]);
    res.json({ success: true, data: { week, lessons, summary: summary[0] ?? null } });
  })
);

// The logged-in teacher's assignments (a contract teacher may have several schools)
router.get(
  "/my-assignments",
  requireRole("TEACHER"),
  handle<AuthRequest>(async (req, res) => {
    const r = await pool.query(
      `SELECT ea.id, s.name AS school_name FROM employee_assignments ea JOIN schools s ON s.id = ea.school_id
        WHERE ea.employee_id = $1 AND ea.is_active AND ea.position_type = 'TEACHER' ORDER BY ea.id`,
      [req.user!.employeeId]
    );
    res.json({ success: true, data: r.rows });
  })
);

// ---------------------------------------------------------------- FR-SCH-08: principal corrects a lesson's status
router.put(
  "/lessons",
  PRINCIPAL,
  handle<AuthRequest>(async (req, res) => {
    const periodId = requireId(req.body?.periodId, "الحصة");
    const date = optionalDate(req.body?.lessonDate);
    if (!date) throw new HttpError(400, "تاريخ الحصة مطلوب");
    if (date > new Date().toISOString().slice(0, 10)) throw new HttpError(400, "لا يمكن تسجيل تنفيذ حصة مستقبلية");
    const status = req.body?.status;
    const own = await pool.query(
      `SELECT 1 FROM timetable_periods tp JOIN sections sc ON sc.id = tp.section_id JOIN classes c ON c.id = sc.class_id
        WHERE tp.id = $1 AND c.school_id = $2 AND tp.day_of_week = EXTRACT(DOW FROM $3::date)::int + 1`,
      [periodId, req.user!.schoolId, date]
    );
    if (!own.rowCount) throw new HttpError(404, "الحصة غير موجودة في مدرستك بهذا التاريخ");

    if (status === null || status === "AUTO") {
      await pool.query("DELETE FROM lesson_executions WHERE timetable_period_id = $1 AND lesson_date = $2", [periodId, date]);
    } else {
      if (!["EXECUTED", "NOT_EXECUTED", "COMPENSATED"].includes(status)) throw new HttpError(400, "حالة الحصة غير صالحة");
      const notes = optionalString(req.body?.notes, 500);
      if (status !== "EXECUTED" && !notes) throw new HttpError(400, "يرجى كتابة ملاحظة توضح سبب التعديل");
      await pool.query(
        `INSERT INTO lesson_executions (timetable_period_id, lesson_date, status, notes, recorded_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (timetable_period_id, lesson_date)
         DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes, recorded_by = EXCLUDED.recorded_by, recorded_at = now()`,
        [periodId, date, status, notes, req.user!.id]
      );
    }
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "lesson_execution", entityId: `${periodId}@${date}`, details: { status }, req });
    res.json({ success: true, message: "تم تحديث حالة الحصة" });
  })
);

// ---------------------------------------------------------------- FR-SCH-09: leaves and official assignments
const LEAVE_TYPES = ["ANNUAL", "SICK", "OFFICIAL_ASSIGNMENT", "TRAINING", "OTHER"];

router.get(
  "/leaves",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const schoolId = await resolveReadableSchool(req.user!, req.query.schoolId);
    const r = await pool.query(
      `SELECT lv.id, lv.leave_type, lv.start_date, lv.end_date, lv.notes, e.full_name, e.employee_number,
              u.full_name AS created_by_name
         FROM employee_leaves lv
         JOIN employees e ON e.id = lv.employee_id
         JOIN users u ON u.id = lv.created_by
        WHERE EXISTS (SELECT 1 FROM employee_assignments ea WHERE ea.employee_id = lv.employee_id AND ea.school_id = $1 AND ea.is_active)
        ORDER BY lv.start_date DESC`,
      [schoolId]
    );
    res.json({ success: true, data: r.rows });
  })
);

router.post(
  "/leaves",
  PRINCIPAL,
  handle<AuthRequest>(async (req, res) => {
    const employeeId = requireId(req.body?.employeeId, "الموظف");
    const type = String(req.body?.leaveType ?? "");
    if (!LEAVE_TYPES.includes(type)) throw new HttpError(400, "نوع الإجازة غير صالح");
    const start = optionalDate(req.body?.startDate);
    const end = optionalDate(req.body?.endDate) ?? start;
    if (!start || !end || end < start) throw new HttpError(400, "تواريخ الإجازة غير صحيحة");
    const own = await pool.query(
      "SELECT 1 FROM employee_assignments WHERE employee_id = $1 AND school_id = $2 AND is_active",
      [employeeId, req.user!.schoolId]
    );
    if (!own.rowCount) throw new HttpError(404, "الموظف لا يتبع لمدرستك");
    const overlap = await pool.query(
      "SELECT 1 FROM employee_leaves WHERE employee_id = $1 AND start_date <= $3 AND end_date >= $2",
      [employeeId, start, end]
    );
    if (overlap.rowCount) throw new HttpError(409, "توجد إجازة مسجّلة تتقاطع مع هذه الفترة");
    const r = await pool.query(
      `INSERT INTO employee_leaves (employee_id, leave_type, start_date, end_date, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [employeeId, type, start, end, optionalString(req.body?.notes, 500), req.user!.id]
    );
    void audit({ userId: req.user!.id, action: "DATA_CREATE", entityType: "employee_leave", entityId: r.rows[0].id, req });
    res.status(201).json({ success: true, message: "تم تسجيل الإجازة", data: r.rows[0] });
  })
);

router.delete(
  "/leaves/:id",
  PRINCIPAL,
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    const r = await pool.query(
      `DELETE FROM employee_leaves lv
        WHERE lv.id = $1 AND EXISTS (SELECT 1 FROM employee_assignments ea
                                      WHERE ea.employee_id = lv.employee_id AND ea.school_id = $2 AND ea.is_active)`,
      [id, req.user!.schoolId]
    );
    if (!r.rowCount) throw new HttpError(404, "الإجازة غير موجودة");
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "employee_leave", entityId: id, details: { removed: true }, req });
    res.json({ success: true, message: "تم حذف الإجازة" });
  })
);

// ---------------------------------------------------------------- FR-SCH-04/05: settings (directorate / ministry)
const EDITABLE_SETTINGS = ["permanent_quota_rules", "contract_lesson_rate", "lesson_duration_minutes", "late_tolerance_minutes", "period_times"];

router.get(
  "/settings",
  requireRole("MINISTRY_ADMIN", "DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL"),
  handle<AuthRequest>(async (_req, res) => {
    const r = await pool.query(
      "SELECT key, value, description, updated_at FROM settings WHERE key = ANY($1) ORDER BY key",
      [EDITABLE_SETTINGS]
    );
    res.json({ success: true, data: r.rows });
  })
);

router.put(
  "/settings/:key",
  requireRole("MINISTRY_ADMIN", "DIRECTORATE_ADMIN"),
  handle<AuthRequest>(async (req, res) => {
    const key = String(req.params.key);
    if (!EDITABLE_SETTINGS.includes(key)) throw new HttpError(404, "إعداد غير معروف");
    const value = req.body?.value;
    validateSetting(key, value);
    if (key === "lesson_duration_minutes") {
      throw new HttpError(400, "تغيير مدة الحصة يتطلب إعادة توليد البرامج الحالية — غير مدعوم من الواجهة حالياً");
    }
    await pool.query(
      "UPDATE settings SET value = $1, updated_by = $2, updated_at = now() WHERE key = $3",
      [JSON.stringify(value), req.user!.id, key]
    );
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "setting", entityId: key, details: { value }, req });
    res.json({ success: true, message: "تم حفظ الإعداد" });
  })
);

function validateSetting(key: string, value: unknown) {
  const bad = () => { throw new HttpError(400, "قيمة الإعداد غير صالحة"); };
  if (key === "permanent_quota_rules") {
    if (!Array.isArray(value) || value.length === 0) bad();
    for (const r of value as { minYears: unknown; quota: unknown }[]) {
      if (!Number.isInteger(r?.minYears) || !Number.isInteger(r?.quota) || (r.quota as number) < 1 || (r.quota as number) > 40) bad();
    }
    if (!(value as { minYears: number }[]).some((r) => r.minYears === 0)) {
      throw new HttpError(400, "يجب وجود قاعدة تبدأ من 0 سنة");
    }
  } else if (key === "period_times") {
    if (typeof value !== "object" || value === null) bad();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!/^\d+$/.test(k) || typeof v !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) bad();
    }
  } else if (typeof value !== "number" || value < 0) {
    bad();
  }
}

export default router;
