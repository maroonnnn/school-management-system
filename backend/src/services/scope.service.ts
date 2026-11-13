import pool from "../config/database.js";
import type { AuthenticatedUser } from "../middleware/auth.middleware.js";

export class ScopeError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

interface EmployeeScope {
  employee_id: number;
  school_id: number | null;
  directorate_id: number | null;
}

/**
 * FR-AUTH-04 / FR-RPT-09: can this user see an individual employee's records?
 * - TEACHER: only themself
 * - SCHOOL_PRINCIPAL / SCHOOL_DEPUTY: employees of their school
 * - DIRECTORATE_ADMIN: employees of schools in their directorate
 * - MINISTRY_ADMIN / SCHOOL_STAFF: no individual access (ministry sees aggregates only — FR-AUTH-09)
 */
export async function assertCanViewEmployee(
  user: AuthenticatedUser,
  employeeNumber: string
): Promise<EmployeeScope> {
  const result = await pool.query<EmployeeScope>(
    `SELECT e.id AS employee_id,
            COALESCE(ea.school_id, NULL) AS school_id,
            COALESCE(s.directorate_id, ea.directorate_id) AS directorate_id
       FROM employees e
       JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_active
       LEFT JOIN schools s ON s.id = ea.school_id
      WHERE e.employee_number = $1
      LIMIT 1`,
    [employeeNumber]
  );
  const emp = result.rows[0];
  if (!emp) throw new ScopeError("الموظف غير موجود", 404);

  const allowed =
    (user.role === "TEACHER" && Number(emp.employee_id) === user.employeeId) ||
    ((user.role === "SCHOOL_PRINCIPAL" || user.role === "SCHOOL_DEPUTY") &&
      emp.school_id != null && Number(emp.school_id) === user.schoolId) ||
    (user.role === "DIRECTORATE_ADMIN" &&
      emp.directorate_id != null && Number(emp.directorate_id) === user.directorateId);

  // Same message as "not found" for out-of-scope users would hide existence; we keep 403 for clarity in the pilot.
  if (!allowed) throw new ScopeError("لا تملك صلاحية الاطلاع على بيانات هذا الموظف");
  return emp;
}
