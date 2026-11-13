import { Router } from "express";
import pool from "../config/database.js";
import { AuthRequest, AuthenticatedUser, authenticateToken, requireRole } from "../middleware/auth.middleware.js";
import { resolveReadableSchool } from "../services/scope.service.js";
import { audit } from "../services/audit.service.js";
import { HttpError, handle, optionalDate, requireId, requireString } from "../utils/http.js";

// FR-DATA-07 / FR-AUTH-13: supervisor enters results, principal approves.
// Flow: DRAFT (supervisor edits) → SUBMITTED (waiting) → APPROVED (frozen by DB trigger). Principal may return SUBMITTED → DRAFT.
const router = Router();
router.use(authenticateToken);

const READERS = requireRole("SUPERVISOR", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "DIRECTORATE_ADMIN");
const SUPERVISOR = requireRole("SUPERVISOR");
const PRINCIPAL = requireRole("SCHOOL_PRINCIPAL");

const TYPES = ["QUIZ", "MIDTERM", "FINAL", "HOMEWORK", "ORAL"];

/** Loads an assessment and checks the user's school scope. */
async function loadAssessment(user: AuthenticatedUser, id: number) {
  const r = await pool.query(
    `SELECT a.*, sub.name AS subject_name, sc.id AS section_id, sc.name AS section_name,
            c.name AS class_name, c.school_id, e.full_name AS teacher_name,
            cu.full_name AS created_by_name, au.full_name AS approved_by_name
       FROM assessments a
       JOIN teaching_assignments ta ON ta.id = a.teaching_assignment_id
       JOIN subjects sub ON sub.id = ta.subject_id
       JOIN sections sc ON sc.id = ta.section_id
       JOIN classes c ON c.id = sc.class_id
       JOIN employee_assignments ea ON ea.id = ta.employee_assignment_id
       JOIN employees e ON e.id = ea.employee_id
       LEFT JOIN users cu ON cu.id = a.created_by
       LEFT JOIN users au ON au.id = a.approved_by
      WHERE a.id = $1`,
    [id]
  );
  if (!r.rowCount) throw new HttpError(404, "النتيجة غير موجودة");
  await resolveReadableSchool(user, r.rows[0].school_id);
  return r.rows[0];
}

// Subjects taught in a section (to pick when creating an assessment)
router.get(
  "/sections/:id/subjects",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const sectionId = requireId(req.params.id);
    const r = await pool.query(
      `SELECT ta.id AS teaching_assignment_id, sub.name AS subject_name, e.full_name AS teacher_name, c.school_id
         FROM teaching_assignments ta
         JOIN subjects sub ON sub.id = ta.subject_id
         JOIN sections sc ON sc.id = ta.section_id JOIN classes c ON c.id = sc.class_id
         JOIN employee_assignments ea ON ea.id = ta.employee_assignment_id
         JOIN employees e ON e.id = ea.employee_id
        WHERE ta.section_id = $1 AND ta.is_active ORDER BY sub.id`,
      [sectionId]
    );
    if (r.rowCount) await resolveReadableSchool(req.user!, r.rows[0].school_id);
    res.json({ success: true, data: r.rows });
  })
);

// Assessments list: by section, or ?status=SUBMITTED for the principal's approval queue
router.get(
  "/assessments",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const schoolId = await resolveReadableSchool(req.user!, req.query.schoolId);
    const params: unknown[] = [schoolId];
    let where = "c.school_id = $1";
    if (req.query.sectionId) {
      params.push(requireId(req.query.sectionId, "الشعبة"));
      where += ` AND sc.id = $${params.length}`;
    }
    if (typeof req.query.status === "string") {
      params.push(req.query.status);
      where += ` AND a.status = $${params.length}`;
    }
    const r = await pool.query(
      `SELECT a.id, a.title, a.assessment_type, a.assessment_date, a.max_score, a.status, a.return_note,
              sub.name AS subject_name, c.name AS class_name, sc.name AS section_name,
              (SELECT COUNT(*) FROM grades g WHERE g.assessment_id = a.id)::int AS graded_count,
              (SELECT ROUND(AVG(g.score), 2) FROM grades g WHERE g.assessment_id = a.id) AS average
         FROM assessments a
         JOIN teaching_assignments ta ON ta.id = a.teaching_assignment_id
         JOIN subjects sub ON sub.id = ta.subject_id
         JOIN sections sc ON sc.id = ta.section_id JOIN classes c ON c.id = sc.class_id
        WHERE ${where}
        ORDER BY a.assessment_date DESC, a.id DESC`,
      params
    );
    res.json({ success: true, data: r.rows });
  })
);

router.post(
  "/assessments",
  SUPERVISOR,
  handle<AuthRequest>(async (req, res) => {
    const b = req.body ?? {};
    const taId = requireId(b.teachingAssignmentId, "المادة");
    const type = String(b.assessmentType ?? "");
    if (!TYPES.includes(type)) throw new HttpError(400, "نوع الاختبار غير صالح");
    const maxScore = Number(b.maxScore);
    if (!(maxScore > 0 && maxScore <= 1000)) throw new HttpError(400, "العلامة العظمى غير صالحة");
    const own = await pool.query(
      `SELECT 1 FROM teaching_assignments ta JOIN sections sc ON sc.id = ta.section_id
         JOIN classes c ON c.id = sc.class_id WHERE ta.id = $1 AND c.school_id = $2`,
      [taId, req.user!.schoolId]
    );
    if (!own.rowCount) throw new HttpError(404, "المادة غير موجودة في مدرستك");
    const r = await pool.query(
      `INSERT INTO assessments (teaching_assignment_id, title, assessment_type, assessment_date, max_score, created_by)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6) RETURNING id`,
      [taId, requireString(b.title, "عنوان الاختبار"), type, optionalDate(b.assessmentDate), maxScore, req.user!.id]
    );
    void audit({ userId: req.user!.id, action: "DATA_CREATE", entityType: "assessment", entityId: r.rows[0].id, req });
    res.status(201).json({ success: true, message: "تم إنشاء الاختبار", data: r.rows[0] });
  })
);

// One assessment + full section roster with scores
router.get(
  "/assessments/:id",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const a = await loadAssessment(req.user!, requireId(req.params.id));
    const roster = await pool.query(
      `SELECT se.id AS enrollment_id, st.student_number, st.full_name, g.score
         FROM student_enrollments se JOIN students st ON st.id = se.student_id
         LEFT JOIN grades g ON g.enrollment_id = se.id AND g.assessment_id = $1
        WHERE se.section_id = $2 AND se.status = 'ACTIVE'
        ORDER BY st.full_name`,
      [a.id, a.section_id]
    );
    res.json({ success: true, data: { assessment: a, students: roster.rows } });
  })
);

router.put(
  "/assessments/:id/scores",
  SUPERVISOR,
  handle<AuthRequest>(async (req, res) => {
    const a = await loadAssessment(req.user!, requireId(req.params.id));
    if (a.status !== "DRAFT") throw new HttpError(409, "لا يمكن تعديل العلامات بعد إرسالها للاعتماد");
    const scores = req.body?.scores;
    if (!Array.isArray(scores)) throw new HttpError(400, "قائمة العلامات مطلوبة");
    const max = Number(a.max_score);

    const valid = await pool.query(
      "SELECT id FROM student_enrollments WHERE section_id = $1 AND status = 'ACTIVE'",
      [a.section_id]
    );
    const enrolled = new Set(valid.rows.map((r) => Number(r.id)));

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const item of scores) {
        const enrollmentId = Number(item?.enrollmentId);
        if (!enrolled.has(enrollmentId)) throw new HttpError(400, "طالب غير مسجّل في هذه الشعبة");
        if (item.score === null || item.score === "") {
          await client.query("DELETE FROM grades WHERE assessment_id = $1 AND enrollment_id = $2", [a.id, enrollmentId]);
          continue;
        }
        const score = Number(item.score);
        if (!(score >= 0 && score <= max)) throw new HttpError(400, `العلامة يجب أن تكون بين 0 و ${max}`);
        await client.query(
          `INSERT INTO grades (assessment_id, enrollment_id, score, recorded_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (assessment_id, enrollment_id)
           DO UPDATE SET score = EXCLUDED.score, recorded_by = EXCLUDED.recorded_by, updated_at = now()`,
          [a.id, enrollmentId, score, req.user!.id]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "assessment_scores", entityId: a.id, details: { count: scores.length }, req });
    res.json({ success: true, message: "تم حفظ العلامات" });
  })
);

/** Status transition with an expected current status. */
async function transition(req: AuthRequest, from: string, to: string, extraSql: string, extraParams: unknown[]) {
  const a = await loadAssessment(req.user!, requireId(req.params.id));
  if (a.status !== from) throw new HttpError(409, "حالة النتيجة لا تسمح بهذا الإجراء");
  await pool.query(
    `UPDATE assessments SET status = $1 ${extraSql} WHERE id = $2`,
    [to, a.id, ...extraParams]
  );
  void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "assessment_status", entityId: a.id, details: { from, to }, req });
  return a;
}

router.post(
  "/assessments/:id/submit",
  SUPERVISOR,
  handle<AuthRequest>(async (req, res) => {
    const a = await loadAssessment(req.user!, requireId(req.params.id));
    const count = await pool.query("SELECT COUNT(*)::int AS n FROM grades WHERE assessment_id = $1", [a.id]);
    if (count.rows[0].n === 0) throw new HttpError(400, "لا يمكن إرسال نتيجة بدون علامات");
    await transition(req, "DRAFT", "SUBMITTED", ", submitted_at = now(), return_note = NULL", []);
    res.json({ success: true, message: "تم إرسال النتيجة لمدير المدرسة للاعتماد" });
  })
);

router.post(
  "/assessments/:id/approve",
  PRINCIPAL,
  handle<AuthRequest>(async (req, res) => {
    await transition(req, "SUBMITTED", "APPROVED", ", approved_by = $3, approved_at = now()", [req.user!.id]);
    res.json({ success: true, message: "تم اعتماد النتيجة" });
  })
);

router.post(
  "/assessments/:id/return",
  PRINCIPAL,
  handle<AuthRequest>(async (req, res) => {
    const note = requireString(req.body?.note, "سبب الإعادة", 1000);
    await transition(req, "SUBMITTED", "DRAFT", ", return_note = $3", [note]);
    res.json({ success: true, message: "تمت إعادة النتيجة للموجّه" });
  })
);

export default router;
