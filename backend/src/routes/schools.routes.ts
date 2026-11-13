import { Router } from "express";
import pool from "../config/database.js";
import { AuthRequest, authenticateToken, requireRole } from "../middleware/auth.middleware.js";
import { readableSchoolIds } from "../services/scope.service.js";
import { audit } from "../services/audit.service.js";
import { HttpError, handle, optionalString, requireId, requireString } from "../utils/http.js";

// FR-DATA-01: schools, each linked to exactly one directorate.
const router = Router();
router.use(authenticateToken);

const SELECT = `
  SELECT s.id, s.name, s.school_code, s.address, s.phone, s.school_type, s.is_active,
         s.directorate_id, d.name AS directorate_name,
         (SELECT COUNT(*) FROM employee_assignments ea WHERE ea.school_id = s.id AND ea.is_active)::int AS employees_count,
         (SELECT COUNT(*) FROM student_enrollments se JOIN sections sc ON sc.id = se.section_id
            JOIN classes c ON c.id = sc.class_id WHERE c.school_id = s.id AND se.status = 'ACTIVE')::int AS students_count
    FROM schools s JOIN directorates d ON d.id = s.directorate_id`;

router.get(
  "/",
  handle<AuthRequest>(async (req, res) => {
    const ids = await readableSchoolIds(req.user!);
    const result = ids === null
      ? await pool.query(`${SELECT} ORDER BY s.id`)
      : await pool.query(`${SELECT} WHERE s.id = ANY($1::bigint[]) ORDER BY s.id`, [ids]);
    res.json({ success: true, data: result.rows });
  })
);

router.get(
  "/directorates",
  requireRole("MINISTRY_ADMIN", "DIRECTORATE_ADMIN"),
  handle<AuthRequest>(async (req, res) => {
    const u = req.user!;
    const result = u.role === "MINISTRY_ADMIN"
      ? await pool.query("SELECT id, name FROM directorates ORDER BY name")
      : await pool.query("SELECT id, name FROM directorates WHERE id = $1", [u.directorateId]);
    res.json({ success: true, data: result.rows });
  })
);

/** Ministry may use any directorate; directorate admin only its own. */
function targetDirectorate(req: AuthRequest): number {
  const u = req.user!;
  if (u.role === "DIRECTORATE_ADMIN") return u.directorateId!;
  return requireId(req.body?.directorateId, "المديرية");
}

function schoolBody(req: AuthRequest) {
  const b = req.body ?? {};
  return [
    requireString(b.name, "اسم المدرسة"),
    optionalString(b.schoolCode, 50),
    optionalString(b.address),
    optionalString(b.phone, 30),
    optionalString(b.schoolType, 50),
  ];
}

router.post(
  "/",
  requireRole("MINISTRY_ADMIN", "DIRECTORATE_ADMIN"),
  handle<AuthRequest>(async (req, res) => {
    const directorateId = targetDirectorate(req);
    const result = await pool.query(
      `INSERT INTO schools (name, school_code, address, phone, school_type, directorate_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [...schoolBody(req), directorateId]
    );
    const id = result.rows[0].id;
    void audit({ userId: req.user!.id, action: "DATA_CREATE", entityType: "school", entityId: id, req });
    res.status(201).json({ success: true, message: "تمت إضافة المدرسة", data: { id } });
  })
);

router.put(
  "/:id",
  requireRole("MINISTRY_ADMIN", "DIRECTORATE_ADMIN"),
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    const allowed = await readableSchoolIds(req.user!);
    if (allowed !== null && !allowed.includes(id)) throw new HttpError(403, "لا تملك صلاحية تعديل هذه المدرسة");
    const directorateId = targetDirectorate(req);
    const isActive = req.body?.isActive !== false;
    const result = await pool.query(
      `UPDATE schools SET name=$1, school_code=$2, address=$3, phone=$4, school_type=$5,
              directorate_id=$6, is_active=$7 WHERE id=$8`,
      [...schoolBody(req), directorateId, isActive, id]
    );
    if (!result.rowCount) throw new HttpError(404, "المدرسة غير موجودة");
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "school", entityId: id, req });
    res.json({ success: true, message: "تم حفظ التعديلات" });
  })
);

export default router;
