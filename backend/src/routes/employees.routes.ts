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
         tp.employment_type, tp.contract_weekly_hours, q.required_weekly_quota, q.years_of_service,
         (SELECT COUNT(*) FROM employee_assignments x WHERE x.employee_id = e.id AND x.is_active)::int AS schools_count,
         u.username
    FROM employees e
    JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_active
    LEFT JOIN teacher_profiles tp ON tp.employee_id = e.id
    LEFT JOIN v_teacher_quota q ON q.employee_assignment_id = ea.id
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

function parseEmployment(position: string, body: Record<string, unknown>) {
  if (position !== "TEACHER") return { employmentType: "PERMANENT" as const, contractWeeklyHours: null, hoursAtSchool: null };
  const employmentType = body.employmentType === "CONTRACT" ? "CONTRACT" as const : "PERMANENT" as const;
  if (employmentType === "PERMANENT") return { employmentType, contractWeeklyHours: null, hoursAtSchool: null };
  const allot = Number(body.contractWeeklyHours);
  const here = Number(body.hoursAtSchool ?? allot);
  if (!(allot > 0 && allot <= 40)) throw new HttpError(400, "ساعات تكليف الوكيل الأسبوعية غير صالحة");
  if (!(here > 0 && here <= allot)) throw new HttpError(400, "ساعات الوكيل في هذه المدرسة يجب أن تكون بين 1 وساعات تكليفه");
  return { employmentType, contractWeeklyHours: allot, hoursAtSchool: here };
}

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
  employmentType: "PERMANENT" | "CONTRACT";
  contractWeeklyHours: number | null; // total allotment from the directorate
  hoursAtSchool: number | null;       // part of the allotment taught at this school
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
    ...parseEmployment(position, body),
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
    `INSERT INTO teacher_profiles
       (employee_id, specialization, qualification, years_of_experience, employment_type, contract_weekly_hours)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (employee_id) DO UPDATE
       SET specialization = EXCLUDED.specialization, qualification = EXCLUDED.qualification,
           years_of_experience = EXCLUDED.years_of_experience,
           employment_type = EXCLUDED.employment_type, contract_weekly_hours = EXCLUDED.contract_weekly_hours`,
    [employeeId, input.specialization, input.qualification, input.years, input.employmentType, input.contractWeeklyHours]
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
      // Profile first: the contract-hours DB check reads the allotment from it
      await upsertTeacherProfile(client, employeeId, input);
      // Permanent teachers: quota comes from years of service (v_teacher_quota). Contract: hours at this school.
      await client.query(
        `INSERT INTO employee_assignments
           (employee_id, school_id, position_type, work_schedule_type, weekly_quota_units, start_date)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)`,
        [employeeId, schoolId, input.position,
         input.position === "TEACHER" ? "TEACHING_TIMETABLE" : "FULL_DAY",
         input.hoursAtSchool]
      );
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
      if (input.position === "TEACHER") {
        await client.query(
          `UPDATE employee_assignments SET weekly_quota_units = $1
            WHERE employee_id = $2 AND school_id = $3 AND is_active`,
          [input.hoursAtSchool, id, schoolId]
        );
      }
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
