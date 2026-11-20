import { Router } from "express";
import pool from "../config/database.js";
import { AuthRequest, AuthenticatedUser, authenticateToken, requireRole } from "../middleware/auth.middleware.js";
import { resolveReadableSchool } from "../services/scope.service.js";
import { audit } from "../services/audit.service.js";
import { HttpError, handle, requireId, requireString } from "../utils/http.js";

// FR-DATA-07 (changed 2026-11-20 by the user): term results (المحصّلات).
// The teacher enters one total per student, per subject, per term → submits (final, no approval step).
// The school's supervisor sees submitted sheets and is the only one who can correct a result afterwards:
// reason is mandatory, old/new are logged in result_corrections, and the teacher gets a personal notification.
const router = Router();
router.use(authenticateToken);

const READERS = requireRole("TEACHER", "SUPERVISOR", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "DIRECTORATE_ADMIN");
const TEACHER = requireRole("TEACHER");
const SUPERVISOR = requireRole("SUPERVISOR");

function requireTerm(v: unknown): 1 | 2 {
  const t = Number(v);
  if (t !== 1 && t !== 2) throw new HttpError(400, "الفصل يجب أن يكون 1 أو 2");
  return t;
}

/** Loads a teaching assignment with its sheet for a term and checks access. */
async function loadSheet(user: AuthenticatedUser, taId: number, term: number) {
  const r = await pool.query(
    `SELECT ta.id AS teaching_assignment_id, sub.name AS subject_name, sc.id AS section_id, sc.name AS section_name,
            c.name AS class_name, c.school_id, ea.employee_id AS teacher_employee_id, e.full_name AS teacher_name,
            rs.id AS sheet_id, COALESCE(rs.status, 'DRAFT') AS status,
            to_char(rs.submitted_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS submitted_at
       FROM teaching_assignments ta
       JOIN subjects sub ON sub.id = ta.subject_id
       JOIN sections sc ON sc.id = ta.section_id JOIN classes c ON c.id = sc.class_id
       JOIN employee_assignments ea ON ea.id = ta.employee_assignment_id
       JOIN employees e ON e.id = ea.employee_id
       LEFT JOIN result_sheets rs ON rs.teaching_assignment_id = ta.id AND rs.term = $2
      WHERE ta.id = $1`,
    [taId, term]
  );
  if (!r.rowCount) throw new HttpError(404, "المادة غير موجودة");
  const s = r.rows[0];
  if (user.role === "TEACHER") {
    if (Number(s.teacher_employee_id) !== user.employeeId) throw new HttpError(403, "هذه المادة ليست من موادك");
  } else {
    await resolveReadableSchool(user, s.school_id);
  }
  return s;
}

// List of subject×section sheets for a term. Teacher: own subjects in all schools. Others: one school (optional section).
router.get(
  "/sheets",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const term = requireTerm(req.query.term ?? 1);
    const u = req.user!;
    const params: unknown[] = [term];
    let where: string;
    if (u.role === "TEACHER") {
      params.push(u.employeeId);
      where = `ea.employee_id = $2`;
    } else {
      params.push(await resolveReadableSchool(u, req.query.schoolId));
      where = `c.school_id = $2`;
      if (req.query.sectionId) {
        params.push(requireId(req.query.sectionId, "الشعبة"));
        where += ` AND sc.id = $${params.length}`;
      }
      if (req.query.status === "SUBMITTED") where += ` AND rs.status = 'SUBMITTED'`;
      if (req.query.status === "PENDING") where += ` AND rs.status IS DISTINCT FROM 'SUBMITTED'`;
    }
    const r = await pool.query(
      `SELECT ta.id AS teaching_assignment_id, sub.name AS subject_name, c.name AS class_name, sc.name AS section_name,
              s.name AS school_name, e.full_name AS teacher_name, COALESCE(rs.status, 'DRAFT') AS status,
              to_char(rs.submitted_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD') AS submitted_at,
              (SELECT COUNT(*) FROM student_enrollments se WHERE se.section_id = sc.id AND se.status = 'ACTIVE')::int AS students,
              (SELECT COUNT(*) FROM term_results tr WHERE tr.sheet_id = rs.id)::int AS entered,
              (SELECT ROUND(AVG(tr.score), 1) FROM term_results tr WHERE tr.sheet_id = rs.id) AS average,
              (SELECT COUNT(*) FROM result_corrections rc JOIN term_results tr ON tr.id = rc.result_id WHERE tr.sheet_id = rs.id)::int AS corrections
         FROM teaching_assignments ta
         JOIN subjects sub ON sub.id = ta.subject_id
         JOIN sections sc ON sc.id = ta.section_id JOIN classes c ON c.id = sc.class_id
         JOIN schools s ON s.id = c.school_id
         JOIN employee_assignments ea ON ea.id = ta.employee_assignment_id
         JOIN employees e ON e.id = ea.employee_id
         LEFT JOIN result_sheets rs ON rs.teaching_assignment_id = ta.id AND rs.term = $1
        WHERE ta.is_active AND ${where}
        ORDER BY c.grade_level, sc.name, sub.id`,
      params
    );
    res.json({ success: true, data: r.rows });
  })
);

// One sheet: roster + scores + corrections. Drafts are visible to their teacher only.
router.get(
  "/sheets/:taId/:term",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const s = await loadSheet(req.user!, requireId(req.params.taId), requireTerm(req.params.term));
    const showScores = s.status === "SUBMITTED" || req.user!.role === "TEACHER";
    const roster = await pool.query(
      `SELECT se.id AS enrollment_id, st.student_number, st.full_name,
              tr.id AS result_id, CASE WHEN $3 THEN tr.score END AS score,
              (SELECT COUNT(*) FROM result_corrections rc WHERE rc.result_id = tr.id)::int AS corrections
         FROM student_enrollments se JOIN students st ON st.id = se.student_id
         LEFT JOIN term_results tr ON tr.enrollment_id = se.id AND tr.sheet_id = $1
        WHERE se.section_id = $2 AND se.status = 'ACTIVE'
        ORDER BY st.full_name`,
      [s.sheet_id, s.section_id, showScores]
    );
    const corrections = s.sheet_id && showScores ? await pool.query(
      `SELECT rc.id, st.full_name AS student_name, rc.old_score, rc.new_score, rc.reason, u.full_name AS corrected_by_name,
              to_char(rc.corrected_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS corrected_at
         FROM result_corrections rc
         JOIN term_results tr ON tr.id = rc.result_id
         JOIN student_enrollments se ON se.id = tr.enrollment_id JOIN students st ON st.id = se.student_id
         JOIN users u ON u.id = rc.corrected_by
        WHERE tr.sheet_id = $1 ORDER BY rc.corrected_at DESC`,
      [s.sheet_id]
    ) : { rows: [] };
    res.json({ success: true, data: { sheet: s, students: roster.rows, corrections: corrections.rows } });
  })
);

// Teacher saves scores while the sheet is a draft (creates the sheet on first save).
router.put(
  "/sheets/:taId/:term/scores",
  TEACHER,
  handle<AuthRequest>(async (req, res) => {
    const term = requireTerm(req.params.term);
    const s = await loadSheet(req.user!, requireId(req.params.taId), term);
    if (s.status === "SUBMITTED") throw new HttpError(409, "المحصّلة مرفوعة — التصحيح عن طريق الموجّه فقط");
    const scores = req.body?.scores;
    if (!Array.isArray(scores)) throw new HttpError(400, "قائمة المحصّلات مطلوبة");
    const valid = await pool.query(
      "SELECT id FROM student_enrollments WHERE section_id = $1 AND status = 'ACTIVE'", [s.section_id]);
    const enrolled = new Set(valid.rows.map((r) => Number(r.id)));

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sheet = await client.query(
        `INSERT INTO result_sheets (teaching_assignment_id, term) VALUES ($1, $2)
         ON CONFLICT (teaching_assignment_id, term) DO UPDATE SET term = EXCLUDED.term RETURNING id`,
        [s.teaching_assignment_id, term]
      );
      const sheetId = sheet.rows[0].id;
      for (const item of scores) {
        const enrollmentId = Number(item?.enrollmentId);
        if (!enrolled.has(enrollmentId)) throw new HttpError(400, "طالب غير مسجّل في هذه الشعبة");
        if (item.score === null || item.score === "") {
          await client.query("DELETE FROM term_results WHERE sheet_id = $1 AND enrollment_id = $2", [sheetId, enrollmentId]);
          continue;
        }
        const score = Number(item.score);
        if (!(score >= 0 && score <= 100)) throw new HttpError(400, "المحصّلة يجب أن تكون بين 0 و 100");
        await client.query(
          `INSERT INTO term_results (sheet_id, enrollment_id, score) VALUES ($1, $2, $3)
           ON CONFLICT (sheet_id, enrollment_id) DO UPDATE SET score = EXCLUDED.score, updated_at = now()`,
          [sheetId, enrollmentId, score]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "term_results", entityId: s.teaching_assignment_id, details: { term, count: scores.length }, req });
    res.json({ success: true, message: "تم حفظ المحصّلات" });
  })
);

// Teacher submits: all active students must have a result. Final — no way back to draft.
router.post(
  "/sheets/:taId/:term/submit",
  TEACHER,
  handle<AuthRequest>(async (req, res) => {
    const term = requireTerm(req.params.term);
    const s = await loadSheet(req.user!, requireId(req.params.taId), term);
    if (s.status === "SUBMITTED") throw new HttpError(409, "المحصّلة مرفوعة مسبقاً");
    if (!s.sheet_id) throw new HttpError(400, "أدخل المحصّلات قبل الرفع");
    const missing = await pool.query(
      `SELECT COUNT(*)::int AS n FROM student_enrollments se
        WHERE se.section_id = $1 AND se.status = 'ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM term_results tr WHERE tr.sheet_id = $2 AND tr.enrollment_id = se.id)`,
      [s.section_id, s.sheet_id]
    );
    if (missing.rows[0].n > 0) throw new HttpError(400, `لا يمكن الرفع: ${missing.rows[0].n} طالب بدون محصّلة`);
    await pool.query(
      "UPDATE result_sheets SET status = 'SUBMITTED', submitted_by = $1, submitted_at = now() WHERE id = $2",
      [req.user!.id, s.sheet_id]
    );
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "result_sheet_submit", entityId: s.sheet_id, details: { term }, req });
    res.json({ success: true, message: "تم رفع المحصّلات إلى الموجّه" });
  })
);

// Supervisor corrects one submitted result: reason mandatory, logged, teacher notified.
router.post(
  "/results/:id/correct",
  SUPERVISOR,
  handle<AuthRequest>(async (req, res) => {
    const resultId = requireId(req.params.id);
    const reason = requireString(req.body?.reason, "سبب التصحيح", 1000);
    const score = Number(req.body?.score);
    if (req.body?.score === "" || req.body?.score == null || !(score >= 0 && score <= 100)) {
      throw new HttpError(400, "المحصّلة يجب أن تكون بين 0 و 100");
    }
    const r = await pool.query(
      `SELECT tr.id, tr.score, rs.status, rs.term, rs.teaching_assignment_id, c.school_id, sub.name AS subject_name,
              c.name AS class_name, sc.name AS section_name, st.full_name AS student_name,
              (SELECT u.id FROM users u WHERE u.employee_id = ea.employee_id AND u.is_active ORDER BY u.id LIMIT 1) AS teacher_user_id
         FROM term_results tr JOIN result_sheets rs ON rs.id = tr.sheet_id
         JOIN teaching_assignments ta ON ta.id = rs.teaching_assignment_id
         JOIN subjects sub ON sub.id = ta.subject_id
         JOIN sections sc ON sc.id = ta.section_id JOIN classes c ON c.id = sc.class_id
         JOIN employee_assignments ea ON ea.id = ta.employee_assignment_id
         JOIN student_enrollments se ON se.id = tr.enrollment_id JOIN students st ON st.id = se.student_id
        WHERE tr.id = $1`,
      [resultId]
    );
    if (!r.rowCount || Number(r.rows[0].school_id) !== req.user!.schoolId) throw new HttpError(404, "المحصّلة غير موجودة في مدرستك");
    const x = r.rows[0];
    if (x.status !== "SUBMITTED") throw new HttpError(409, "لا يمكن تصحيح محصّلة لم يرفعها المعلم بعد");
    if (Number(x.score) === score) throw new HttpError(400, "القيمة الجديدة مطابقة للقيمة الحالية");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL app.result_correction = 'on'");
      await client.query("UPDATE term_results SET score = $1, updated_at = now() WHERE id = $2", [score, resultId]);
      await client.query(
        "INSERT INTO result_corrections (result_id, old_score, new_score, reason, corrected_by) VALUES ($1, $2, $3, $4, $5)",
        [resultId, x.score, score, reason, req.user!.id]
      );
      if (x.teacher_user_id) {
        await client.query(
          "INSERT INTO notifications (user_id, title, body, link) VALUES ($1, $2, $3, $4)",
          [x.teacher_user_id, "تم تصحيح محصّلة من قبل الموجّه",
            `${x.student_name} — ${x.subject_name} (${x.class_name} / ${x.section_name}، الفصل ${x.term === 1 ? "الأول" : "الثاني"}): من ${Number(x.score)} إلى ${score}. السبب: ${reason}`,
            "/grades"]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "term_result_correction", entityId: resultId, details: { old: Number(x.score), new: score }, req });
    res.json({ success: true, message: "تم تصحيح المحصّلة وإشعار المعلم" });
  })
);

export default router;
