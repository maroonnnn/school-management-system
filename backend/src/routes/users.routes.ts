import { Router } from "express";
import bcrypt from "bcryptjs";
import pool from "../config/database.js";
import { AuthRequest, AuthenticatedUser, Role, authenticateToken, requireRole } from "../middleware/auth.middleware.js";
import { readableSchoolIds } from "../services/scope.service.js";
import { audit } from "../services/audit.service.js";
import { HttpError, handle, optionalString, requireId, requireString } from "../utils/http.js";

// FR-AUTH-05: create / disable accounts and assign roles. FR-AUTH-03: one role + one scope per user.
const router = Router();
router.use(authenticateToken, requireRole("MINISTRY_ADMIN", "DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL"));

/** Which roles may each manager create? */
const CREATABLE: Record<string, Role[]> = {
  MINISTRY_ADMIN: ["MINISTRY_ADMIN", "DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "SCHOOL_STAFF", "TEACHER"],
  DIRECTORATE_ADMIN: ["SCHOOL_PRINCIPAL"],
  SCHOOL_PRINCIPAL: ["SCHOOL_DEPUTY", "SCHOOL_STAFF", "TEACHER"],
};
const SCHOOL_ROLES: Role[] = ["SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "SCHOOL_STAFF", "TEACHER"];

/** SQL filter limiting visible/manageable users to the manager's scope. */
async function scopeFilter(u: AuthenticatedUser): Promise<{ sql: string; params: unknown[] }> {
  if (u.role === "MINISTRY_ADMIN") return { sql: "TRUE", params: [] };
  const schools = await readableSchoolIds(u);
  if (u.role === "DIRECTORATE_ADMIN") {
    return { sql: "(u.school_id = ANY($1::bigint[]) OR u.directorate_id = $2)", params: [schools, u.directorateId] };
  }
  return { sql: "u.school_id = $1", params: [u.schoolId] };
}

router.get(
  "/",
  handle<AuthRequest>(async (req, res) => {
    const f = await scopeFilter(req.user!);
    const r = await pool.query(
      `SELECT u.id, u.full_name, u.username, u.email, u.is_active, u.last_login_at,
              r.name AS role, u.school_id, s.name AS school_name, u.directorate_id,
              u.employee_id, e.employee_number
         FROM users u JOIN roles r ON r.id = u.role_id
         LEFT JOIN schools s ON s.id = u.school_id
         LEFT JOIN employees e ON e.id = u.employee_id
        WHERE ${f.sql}
        ORDER BY u.school_id NULLS FIRST, r.id, u.full_name`,
      f.params
    );
    res.json({ success: true, data: r.rows, creatableRoles: CREATABLE[req.user!.role] });
  })
);

// Employees of the principal's school who have no account yet (for linking)
router.get(
  "/linkable-employees",
  requireRole("SCHOOL_PRINCIPAL"),
  handle<AuthRequest>(async (req, res) => {
    const r = await pool.query(
      `SELECT e.id, e.employee_number, e.full_name, ea.position_type
         FROM employees e
         JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_active AND ea.school_id = $1
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.employee_id = e.id)
        ORDER BY e.full_name`,
      [req.user!.schoolId]
    );
    res.json({ success: true, data: r.rows });
  })
);

router.post(
  "/",
  handle<AuthRequest>(async (req, res) => {
    const me = req.user!;
    const b = req.body ?? {};
    const role = b.role as Role;
    if (!CREATABLE[me.role]?.includes(role)) throw new HttpError(403, "لا تملك صلاحية إنشاء حساب بهذا الدور");

    const username = requireString(b.username, "اسم المستخدم", 100);
    if (!/^[a-zA-Z0-9._-]{3,100}$/.test(username)) {
      throw new HttpError(400, "اسم المستخدم: أحرف إنكليزية وأرقام و . _ - فقط (3 أحرف على الأقل)");
    }
    const password = typeof b.password === "string" ? b.password : "";
    if (password.length < 8) throw new HttpError(400, "كلمة المرور يجب أن تكون 8 أحرف على الأقل");

    // Scope (exactly one of ministry / directorate / school)
    let ministryId: number | null = null, directorateId: number | null = null, schoolId: number | null = null;
    if (role === "MINISTRY_ADMIN") ministryId = 1;
    else if (role === "DIRECTORATE_ADMIN") directorateId = requireId(b.directorateId, "المديرية");
    else if (me.role === "SCHOOL_PRINCIPAL") schoolId = me.schoolId;
    else {
      schoolId = requireId(b.schoolId, "المدرسة");
      const allowed = await readableSchoolIds(me);
      if (allowed !== null && !allowed.includes(schoolId)) throw new HttpError(403, "المدرسة خارج نطاقك");
    }

    // Employee link: required for teachers, optional for other school roles; must belong to that school
    let employeeId: number | null = null;
    if (b.employeeId) {
      if (!SCHOOL_ROLES.includes(role)) throw new HttpError(400, "ربط الموظف متاح لحسابات المدارس فقط");
      employeeId = requireId(b.employeeId, "الموظف");
      const ok = await pool.query(
        "SELECT 1 FROM employee_assignments WHERE employee_id = $1 AND school_id = $2 AND is_active",
        [employeeId, schoolId]
      );
      if (!ok.rowCount) throw new HttpError(400, "الموظف لا يتبع لهذه المدرسة");
    } else if (role === "TEACHER") {
      throw new HttpError(400, "حساب المعلم يجب أن يُربط بملف معلم");
    }

    let fullName = optionalString(b.fullName, 200);
    if (!fullName && employeeId) {
      fullName = (await pool.query("SELECT full_name FROM employees WHERE id = $1", [employeeId])).rows[0]?.full_name;
    }
    if (!fullName) throw new HttpError(400, "الاسم الكامل مطلوب");

    const roleRow = await pool.query("SELECT id FROM roles WHERE name = $1", [role]);
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (role_id, ministry_id, directorate_id, school_id, full_name, username, email, password_hash, employee_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [roleRow.rows[0].id, ministryId, directorateId, schoolId, fullName, username,
       optionalString(b.email), hash, employeeId]
    );
    void audit({
      userId: me.id, action: "USER_CREATE", entityType: "user", entityId: r.rows[0].id,
      details: { role, schoolId, directorateId }, req,
    });
    res.status(201).json({ success: true, message: "تم إنشاء الحساب", data: r.rows[0] });
  })
);

router.patch(
  "/:id/active",
  handle<AuthRequest>(async (req, res) => {
    const me = req.user!;
    const id = requireId(req.params.id);
    if (id === me.id) throw new HttpError(400, "لا يمكنك تعطيل حسابك");
    const isActive = req.body?.isActive === true;

    const f = await scopeFilter(me);
    const target = await pool.query(
      `SELECT r.name AS role FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = $${f.params.length + 1} AND ${f.sql}`,
      [...f.params, id]
    );
    if (!target.rowCount) throw new HttpError(404, "الحساب غير موجود ضمن نطاقك");
    if (!CREATABLE[me.role]?.includes(target.rows[0].role)) throw new HttpError(403, "لا تملك صلاحية تعديل هذا الحساب");

    await pool.query("UPDATE users SET is_active = $1 WHERE id = $2", [isActive, id]);
    void audit({ userId: me.id, action: "USER_UPDATE", entityType: "user", entityId: id, details: { isActive }, req });
    res.json({ success: true, message: isActive ? "تم تفعيل الحساب" : "تم تعطيل الحساب" });
  })
);

export default router;
