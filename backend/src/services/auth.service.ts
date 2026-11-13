
import pool from "../config/database.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

interface LoginResult {
  id: number;
  full_name: string;
  username: string;
  password_hash: string;
  role_name: string;
  school_id: number | null;
  directorate_id: number | null;
  employee_id: number | null;
  employee_number: string | null;
  is_active: boolean;
}

export async function loginUser(username: string, password: string) {
  const result = await pool.query<LoginResult>(
    `SELECT
        u.id,
        u.full_name,
        u.username,
        u.password_hash,
        u.school_id,
        u.directorate_id,
        u.is_active,
        u.employee_id,
        e.employee_number,
        r.name AS role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN employees e ON e.id = u.employee_id
     WHERE u.username = $1
     LIMIT 1`,
    [username]
  );

  const user = result.rows[0];

  if (!user || !user.is_active) {
    throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة");
  }

  const passwordMatches = await bcrypt.compare(
    password,
    user.password_hash
  );

  if (!passwordMatches) {
    throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة");
  }

  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET غير مضبوط في إعدادات الخادم");
  }

  const token = jwt.sign(
    {
      id: Number(user.id),
      role: user.role_name,
      employeeId: user.employee_id ? Number(user.employee_id) : null,
      schoolId: user.school_id ? Number(user.school_id) : null,
      directorateId: user.directorate_id
        ? Number(user.directorate_id)
        : null,
    },
    secret,
    { expiresIn: "8h" }
  );

  return {
    token,
    user: {
      id: Number(user.id),
      fullName: user.full_name,
      username: user.username,
      role: user.role_name,
      employeeNumber: user.employee_number,
      schoolId: user.school_id ? Number(user.school_id) : null,
      directorateId: user.directorate_id
        ? Number(user.directorate_id)
        : null,
    },
  };
}
