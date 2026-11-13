import { Router } from "express";
import type { PoolClient } from "pg";
import pool from "../config/database.js";
import { AuthRequest, authenticateToken, requireRole } from "../middleware/auth.middleware.js";
import { resolveReadableSchool } from "../services/scope.service.js";
import { audit } from "../services/audit.service.js";
import { HttpError, handle, optionalDate, optionalString, requireId, requireString } from "../utils/http.js";

// FR-DATA-02 (teachers), FR-DATA-03 (admin staff, principal only), FR-DATA-06 (unique id + duplicate warning)
const router = Router();
router.use(authenticateToken);

const POSITIONS = ["TEACHER", "DEPUTY", "ADMINISTRATIVE", "SUPERVISOR"] as const;
type Position = (typeof POSITIONS)[number];

const SELECT = `
  SELECT e.id, e.employee_number, e.full_name, e.phone, e.email, e.hire_date, e.is_active,
         ea.id AS assignment_id, ea.school_id, ea.position_type, ea.weekly_quota_units,
         tp.specialization, tp.qualification, tp.years_of_experience,
         u.username
    FROM employees e
    JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_active
    LEFT JOIN teacher_profiles tp ON tp.employee_id = e.id
    LEFT JOIN users u ON u.employee_id = e.id`;

router.get(
  "/",
  requireRole("DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY"),
  handle<AuthRequest>(async (req, res) => {
    const schoolId = await resolveReadableSchool(req.user!, req.query.schoolId);
    const result = await pool.query(
      `${SELECT} WHERE ea.school_id = $1 ORDER BY ea.position_type, e.full_name`,
      [schoolId]
    );
    res.json({ success: true, data: result.rows });
  })
);

interface EmployeeInput {
  fullName: string;
  employeeNumber: string | null;
  phone: string | null;
  email: string | null;
  hireDate: string | null;
  position: Position;
  specialization: string | null;
  qualification: string | null;
  years: number;
}

function parseBody(body: Record<string, unknown> = {}): EmployeeInput {
  const position = body.position as Position;
  if (!POSITIONS.includes(position)) throw new HttpError(400, "نوع الوظيفة غير صالح");
  const years = Number(body.yearsOfExperience ?? 0);
  if (!Number.isInteger(years) || years < 0 || years > 60) throw new HttpError(400, "سنوات الخبرة غير صالحة");
  return {
    fullName: requireString(body.fullName, "الاسم الكامل"),
    employeeNumber: optionalString(body.employeeNumber, 50),
    phone: optionalString(body.phone, 30),
    email: optionalString(body.email),
    hireDate: optionalDate(body.hireDate),
    position,
    specialization: optionalString(body.specialization, 150),
    qualification: optionalString(body.qualification, 200),
    years,
  };
}

/** FR-DATA-06: warn when a similar person already exists (same name + phone, or same name in school). */
async function findDuplicates(input: EmployeeInput, schoolId: number, excludeId?: number) {
  const result = await pool.query(
    `SELECT e.id, e.employee_number, e.full_name, e.phone
       FROM employees e
       LEFT JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_active
      WHERE e.id <> COALESCE($4, 0)
        AND lower(e.full_name) = lower($1)
        AND (($2::text IS NOT NULL AND e.phone = $2) OR ea.school_id = $3)
      LIMIT 5`,
    [input.fullName, input.phone, schoolId, excludeId ?? null]
  );
  return result.rows;
}

async function upsertTeacherProfile(client: PoolClient, employeeId: number, input: EmployeeInput) {
  if (input.position !== "TEACHER") return;
  await client.query(
    `INSERT INTO teacher_profiles (employee_id, specialization, qualification, years_of_experience)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (employee_id) DO UPDATE
       SET specialization = EXCLUDED.specialization, qualification = EXCLUDED.qualification,
           years_of_experience = EXCLUDED.years_of_experience`,
    [employeeId, input.specialization, input.qualification, input.years]
  );
}

router.post(
  "/",
  requireRole("SCHOOL_PRINCIPAL"),
  handle<AuthRequest>(async (req, res) => {
    const schoolId = req.user!.schoolId!;
    const input = parseBody(req.body);

    if (req.body?.confirmDuplicate !== true) {
      const duplicates = await findDuplicates(input, schoolId);
      if (duplicates.length) {
        throw new HttpError(409, "يوجد سجل مشابه بنفس الاسم، هل تريد المتابعة؟", { duplicates });
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const emp = await client.query(
        `INSERT INTO employees (employee_number, full_name, phone, email, hire_date)
         VALUES (COALESCE($1, 'EMP-' || (SELECT COALESCE(MAX(id), 0) + 1001 FROM employees)), $2, $3, $4, $5)
         RETURNING id, employee_number`,
        [input.employeeNumber, input.fullName, input.phone, input.email, input.hireDate]
      );
      const employeeId = Number(emp.rows[0].id);
      await client.query(
        `INSERT INTO employee_assignments
           (employee_id, school_id, position_type, work_schedule_type, weekly_quota_units, start_date)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)`,
        [employeeId, schoolId, input.position,
         input.position === "TEACHER" ? "TEACHING_TIMETABLE" : "FULL_DAY",
         input.position === "TEACHER" ? 22 : null]
      );
      await upsertTeacherProfile(client, employeeId, input);
      await client.query("COMMIT");
      void audit({ userId: req.user!.id, action: "DATA_CREATE", entityType: "employee", entityId: employeeId, req });
      res.status(201).json({ success: true, message: "تمت إضافة الموظف", data: emp.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.put(
  "/:id",
  requireRole("SCHOOL_PRINCIPAL"),
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    const schoolId = req.user!.schoolId!;
    const input = parseBody(req.body);

    const current = await pool.query(
      `SELECT ea.position_type FROM employee_assignments ea
        WHERE ea.employee_id = $1 AND ea.school_id = $2 AND ea.is_active`,
      [id, schoolId]
    );
    if (!current.rowCount) throw new HttpError(404, "الموظف غير موجود في مدرستك");
    if (current.rows[0].position_type !== input.position) {
      throw new HttpError(400, "لا يمكن تغيير نوع الوظيفة من التعديل");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE employees SET full_name=$1, phone=$2, email=$3, hire_date=$4,
                employee_number=COALESCE($5, employee_number), updated_at=now() WHERE id=$6`,
        [input.fullName, input.phone, input.email, input.hireDate, input.employeeNumber, id]
      );
      await upsertTeacherProfile(client, id, input);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "employee", entityId: id, req });
    res.json({ success: true, message: "تم حفظ التعديلات" });
  })
);

export default router;
