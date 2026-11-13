import { Router } from "express";
import pool from "../config/database.js";
import { AuthRequest, authenticateToken, requireRole } from "../middleware/auth.middleware.js";
import { resolveReadableSchool } from "../services/scope.service.js";
import { audit } from "../services/audit.service.js";
import { HttpError, handle, optionalDate, optionalString, requireId, requireString } from "../utils/http.js";

// FR-DATA-04 (students ↔ section), FR-DATA-05 (classes, sections, subjects, class roster),
// FR-DATA-06 (unique id + duplicate warning), FR-DATA-08 (linked to the current academic year)
const router = Router();
router.use(authenticateToken);

const READERS = requireRole("DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY");
const WRITERS = requireRole("SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY");

async function currentYear(): Promise<{ id: number; name: string }> {
  const r = await pool.query("SELECT id, name FROM academic_years WHERE is_current LIMIT 1");
  if (!r.rowCount) throw new HttpError(400, "لا توجد سنة دراسية حالية مفعّلة");
  return { id: Number(r.rows[0].id), name: r.rows[0].name };
}

/** Throws unless the section belongs to the user's school. */
async function assertOwnSection(sectionId: number, schoolId: number) {
  const r = await pool.query(
    "SELECT 1 FROM sections sc JOIN classes c ON c.id = sc.class_id WHERE sc.id = $1 AND c.school_id = $2",
    [sectionId, schoolId]
  );
  if (!r.rowCount) throw new HttpError(404, "الشعبة غير موجودة في مدرستك");
}

router.get(
  "/subjects",
  handle<AuthRequest>(async (_req, res) => {
    const r = await pool.query("SELECT id, name FROM subjects WHERE is_active ORDER BY id");
    res.json({ success: true, data: r.rows });
  })
);

// Classes + sections + student counts for the current year
router.get(
  "/structure",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const schoolId = await resolveReadableSchool(req.user!, req.query.schoolId);
    const year = await currentYear();
    const r = await pool.query(
      `SELECT c.id AS class_id, c.name AS class_name, c.grade_level,
              sc.id AS section_id, sc.name AS section_name, sc.capacity,
              (SELECT COUNT(*) FROM student_enrollments se
                WHERE se.section_id = sc.id AND se.status = 'ACTIVE')::int AS students_count
         FROM classes c LEFT JOIN sections sc ON sc.class_id = c.id
        WHERE c.school_id = $1 AND c.academic_year_id = $2
        ORDER BY c.grade_level, sc.name`,
      [schoolId, year.id]
    );
    const classes = new Map<number, { id: number; name: string; gradeLevel: number; sections: unknown[] }>();
    for (const row of r.rows) {
      const cid = Number(row.class_id);
      if (!classes.has(cid)) classes.set(cid, { id: cid, name: row.class_name, gradeLevel: row.grade_level, sections: [] });
      if (row.section_id) {
        classes.get(cid)!.sections.push({
          id: Number(row.section_id), name: row.section_name, capacity: row.capacity, studentsCount: row.students_count,
        });
      }
    }
    res.json({ success: true, data: { academicYear: year, classes: [...classes.values()] } });
  })
);

router.post(
  "/classes",
  WRITERS,
  handle<AuthRequest>(async (req, res) => {
    const grade = Number(req.body?.gradeLevel);
    if (!Number.isInteger(grade) || grade < 1 || grade > 12) throw new HttpError(400, "الصف يجب أن يكون بين 1 و 12");
    const year = await currentYear();
    const r = await pool.query(
      "INSERT INTO classes (school_id, academic_year_id, name, grade_level) VALUES ($1, $2, $3, $4) RETURNING id",
      [req.user!.schoolId, year.id, requireString(req.body?.name, "اسم الصف", 100), grade]
    );
    void audit({ userId: req.user!.id, action: "DATA_CREATE", entityType: "class", entityId: r.rows[0].id, req });
    res.status(201).json({ success: true, message: "تمت إضافة الصف", data: r.rows[0] });
  })
);

router.post(
  "/sections",
  WRITERS,
  handle<AuthRequest>(async (req, res) => {
    const classId = requireId(req.body?.classId, "الصف");
    const own = await pool.query("SELECT 1 FROM classes WHERE id = $1 AND school_id = $2", [classId, req.user!.schoolId]);
    if (!own.rowCount) throw new HttpError(404, "الصف غير موجود في مدرستك");
    const capacity = req.body?.capacity ? Number(req.body.capacity) : null;
    const r = await pool.query(
      "INSERT INTO sections (class_id, name, capacity) VALUES ($1, $2, $3) RETURNING id",
      [classId, requireString(req.body?.name, "اسم الشعبة", 50), capacity]
    );
    void audit({ userId: req.user!.id, action: "DATA_CREATE", entityType: "section", entityId: r.rows[0].id, req });
    res.status(201).json({ success: true, message: "تمت إضافة الشعبة", data: r.rows[0] });
  })
);

// Section roster (FR-DATA-05: names of the students in each class)
router.get(
  "/sections/:id/students",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const sectionId = requireId(req.params.id);
    const owner = await pool.query(
      "SELECT c.school_id FROM sections sc JOIN classes c ON c.id = sc.class_id WHERE sc.id = $1",
      [sectionId]
    );
    if (!owner.rowCount) throw new HttpError(404, "الشعبة غير موجودة");
    await resolveReadableSchool(req.user!, owner.rows[0].school_id);
    const r = await pool.query(
      `SELECT st.id, st.student_number, st.full_name, st.date_of_birth, st.guardian_name, st.guardian_phone,
              se.id AS enrollment_id, se.enrollment_date
         FROM student_enrollments se JOIN students st ON st.id = se.student_id
        WHERE se.section_id = $1 AND se.status = 'ACTIVE'
        ORDER BY st.full_name`,
      [sectionId]
    );
    res.json({ success: true, data: r.rows });
  })
);

function studentBody(body: Record<string, unknown> = {}) {
  return {
    fullName: requireString(body.fullName, "اسم الطالب"),
    studentNumber: optionalString(body.studentNumber, 50),
    dateOfBirth: optionalDate(body.dateOfBirth),
    guardianName: optionalString(body.guardianName, 200),
    guardianPhone: optionalString(body.guardianPhone, 30),
  };
}

router.post(
  "/students",
  WRITERS,
  handle<AuthRequest>(async (req, res) => {
    const sectionId = requireId(req.body?.sectionId, "الشعبة");
    await assertOwnSection(sectionId, req.user!.schoolId!);
    const s = studentBody(req.body);

    if (req.body?.confirmDuplicate !== true) {
      const dup = await pool.query(
        `SELECT id, student_number, full_name, date_of_birth FROM students
          WHERE lower(full_name) = lower($1) AND ($2::date IS NULL OR date_of_birth = $2) LIMIT 5`,
        [s.fullName, s.dateOfBirth]
      );
      if (dup.rowCount) {
        throw new HttpError(409, "يوجد طالب مسجّل بنفس الاسم، هل تريد المتابعة؟", { duplicates: dup.rows });
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const st = await client.query(
        `INSERT INTO students (student_number, full_name, date_of_birth, guardian_name, guardian_phone)
         VALUES (COALESCE($1, 'STU-' || (SELECT COALESCE(MAX(id), 0) + 50001 FROM students)), $2, $3, $4, $5)
         RETURNING id, student_number`,
        [s.studentNumber, s.fullName, s.dateOfBirth, s.guardianName, s.guardianPhone]
      );
      await client.query(
        "INSERT INTO student_enrollments (student_id, section_id) VALUES ($1, $2)",
        [st.rows[0].id, sectionId]
      );
      await client.query("COMMIT");
      void audit({ userId: req.user!.id, action: "DATA_CREATE", entityType: "student", entityId: st.rows[0].id, req });
      res.status(201).json({ success: true, message: "تمت إضافة الطالب", data: st.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.put(
  "/students/:id",
  WRITERS,
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    const own = await pool.query(
      `SELECT 1 FROM student_enrollments se JOIN sections sc ON sc.id = se.section_id
         JOIN classes c ON c.id = sc.class_id
        WHERE se.student_id = $1 AND se.status = 'ACTIVE' AND c.school_id = $2`,
      [id, req.user!.schoolId]
    );
    if (!own.rowCount) throw new HttpError(404, "الطالب غير موجود في مدرستك");
    const s = studentBody(req.body);
    await pool.query(
      `UPDATE students SET full_name=$1, student_number=COALESCE($2, student_number), date_of_birth=$3,
              guardian_name=$4, guardian_phone=$5, updated_at=now() WHERE id=$6`,
      [s.fullName, s.studentNumber, s.dateOfBirth, s.guardianName, s.guardianPhone, id]
    );
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "student", entityId: id, req });
    res.json({ success: true, message: "تم حفظ التعديلات" });
  })
);

export default router;
