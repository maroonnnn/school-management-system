
import pool from "../config/database.js";
import { randomUUID } from "node:crypto";

export type RequestType =
  | "MAINTENANCE"
  | "TEACHERS"
  | "TEXTBOOKS"
  | "FURNITURE"
  | "COMPUTERS"
  | "OTHER";

const allowedTypes: RequestType[] = [
  "MAINTENANCE",
  "TEACHERS",
  "TEXTBOOKS",
  "FURNITURE",
  "COMPUTERS",
  "OTHER",
];

export async function createDraftRequest(
  userId: number,
  requestType: RequestType,
  title: string,
  description: string
) {
  if (!allowedTypes.includes(requestType)) {
    throw new Error("نوع الطلب غير صالح");
  }

  if (!title.trim() || !description.trim()) {
    throw new Error("عنوان الطلب ووصفه مطلوبان");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Verify the current user and their actual role
    const userResult = await client.query(
      `SELECT
          u.id,
          u.school_id,
          u.is_active,
          r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1
       LIMIT 1`,
      [userId]
    );

    const user = userResult.rows[0];

    if (!user || !user.is_active || !user.school_id) {
      throw new Error("حساب المستخدم غير نشط أو غير مرتبط بمدرسة");
    }

    if (
      user.role_name !== "SCHOOL_PRINCIPAL" &&
      user.role_name !== "SCHOOL_DEPUTY"
    ) {
      throw new Error("ليس لديك صلاحية إنشاء طلبات المدرسة");
    }

    // A deputy must have an active authorization
    if (user.role_name === "SCHOOL_DEPUTY") {
      const authorizationResult = await client.query(
        `SELECT 1
         FROM school_deputy_authorizations a
         JOIN users principal
           ON principal.id = a.authorized_by
         JOIN roles principal_role
           ON principal_role.id = principal.role_id
         WHERE a.school_id = $1
           AND a.deputy_user_id = $2
           AND a.is_active = TRUE
           AND a.revoked_at IS NULL
           AND principal.school_id = a.school_id
           AND principal.is_active = TRUE
           AND principal_role.name = 'SCHOOL_PRINCIPAL'
         LIMIT 1`,
        [user.school_id, user.id]
      );

      if (authorizationResult.rowCount === 0) {
        throw new Error("النائب غير مخوّل بتقديم طلبات هذه المدرسة");
      }
    }

    const requestNumber =
      `REQ-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8).toUpperCase()}`;

    // Create the draft request
    const requestResult = await client.query(
      `INSERT INTO school_requests (
          request_number,
          school_id,
          created_by,
          request_type,
          title,
          description,
          status
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT')
       RETURNING
          id,
          request_number,
          school_id,
          created_by,
          request_type,
          title,
          description,
          status,
          created_at`,
      [
        requestNumber,
        user.school_id,
        user.id,
        requestType,
        title.trim(),
        description.trim(),
      ]
    );

    const newRequest = requestResult.rows[0];

    // Record the initial status in history
    await client.query(
      `INSERT INTO request_status_history (
          request_id,
          old_status,
          new_status,
          changed_by,
          notes
       )
       VALUES ($1, NULL, 'DRAFT', $2, $3)`,
      [newRequest.id, user.id, "إنشاء مسودة طلب"]
    );

    await client.query("COMMIT");

    return newRequest;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function submitDraftRequest(
  userId: number,
  requestId: number
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // التحقق من المستخدم وصلاحياته الحالية
    const userResult = await client.query(
      `SELECT u.id, u.school_id, u.is_active, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1
       LIMIT 1`,
      [userId]
    );

    const user = userResult.rows[0];

    if (!user || !user.is_active || !user.school_id) {
      throw new Error("حساب المستخدم غير نشط أو غير مرتبط بمدرسة");
    }

    if (
      user.role_name !== "SCHOOL_PRINCIPAL" &&
      user.role_name !== "SCHOOL_DEPUTY"
    ) {
      throw new Error("ليس لديك صلاحية تقديم طلبات المدرسة");
    }

    // التحقق من أن النائب مخوّل حالياً
    if (user.role_name === "SCHOOL_DEPUTY") {
      const authorizationResult = await client.query(
        `SELECT 1
         FROM school_deputy_authorizations a
         JOIN users principal ON principal.id = a.authorized_by
         JOIN roles principal_role ON principal_role.id = principal.role_id
         WHERE a.school_id = $1
           AND a.deputy_user_id = $2
           AND a.is_active = TRUE
           AND a.revoked_at IS NULL
           AND principal.school_id = a.school_id
           AND principal.is_active = TRUE
           AND principal_role.name = 'SCHOOL_PRINCIPAL'
         LIMIT 1`,
        [user.school_id, user.id]
      );

      if (authorizationResult.rowCount === 0) {
        throw new Error("النائب غير مخوّل بتقديم طلبات هذه المدرسة");
      }
    }

    // جلب الطلب والتأكد من أنه تابع لمدرسة المستخدم
    const requestResult = await client.query(
      `SELECT id, school_id, status
       FROM school_requests
       WHERE id = $1 AND school_id = $2
       FOR UPDATE`,
      [requestId, user.school_id]
    );

    const request = requestResult.rows[0];

    if (!request) {
      throw new Error("الطلب غير موجود أو لا يتبع لمدرستك");
    }

    if (request.status !== "DRAFT") {
      throw new Error("لا يمكن تقديم الطلب لأنه ليس في حالة مسودة");
    }

    // تحويل حالة الطلب إلى SUBMITTED
    const updateResult = await client.query(
      `UPDATE school_requests
       SET status = 'SUBMITTED',
           submitted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, request_number, school_id, status, submitted_at`,
      [requestId]
    );

    // تسجيل العملية في سجل تاريخ الحالات
    await client.query(
      `INSERT INTO request_status_history (
         request_id, old_status, new_status, changed_by, notes
       )
       VALUES ($1, 'DRAFT', 'SUBMITTED', $2, $3)`,
      [requestId, user.id, "تم تقديم الطلب إلى مديرية التربية"]
    );

    await client.query("COMMIT");

    return updateResult.rows[0];

  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function getDirectorateRequests(userId: number) {
  // التحقق من حساب مدير المديرية وصلاحيته
  const userResult = await pool.query(
    `SELECT u.id, u.directorate_id, u.is_active, r.name AS role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );

  const user = userResult.rows[0];

  if (!user || !user.is_active) {
    throw new Error("حساب المستخدم غير نشط");
  }

  if (user.role_name !== "DIRECTORATE_ADMIN") {
    throw new Error("ليس لديك صلاحية عرض طلبات المديرية");
  }

  if (!user.directorate_id) {
    throw new Error("حساب المديرية غير مرتبط بمديرية");
  }

  // جلب الطلبات التابعة لمديرية المستخدم فقط
  const requestsResult = await pool.query(
    `SELECT
       sr.id,
       sr.request_number,
       sr.request_type,
       sr.title,
       sr.description,
       sr.status,
       sr.created_at,
       sr.submitted_at,
       s.name AS school_name,
       u.full_name AS created_by_name
     FROM school_requests sr
     JOIN schools s ON s.id = sr.school_id
     JOIN users u ON u.id = sr.created_by
     WHERE s.directorate_id = $1
       AND sr.status <> 'DRAFT'
     ORDER BY sr.submitted_at DESC NULLS LAST`,
    [user.directorate_id]
  );

  return requestsResult.rows;
}

export type DirectorateRequestStatus =
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED";

export async function transitionDirectorateRequest(
  userId: number,
  requestId: number,
  newStatus: DirectorateRequestStatus,
  rejectionReason?: string
) {
  if (newStatus === "REJECTED" && !rejectionReason?.trim()) {
    throw new Error("سبب الرفض مطلوب");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT u.id, u.directorate_id, u.is_active, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1
       LIMIT 1`,
      [userId]
    );

    const user = userResult.rows[0];

    if (!user || !user.is_active) {
      throw new Error("حساب المستخدم غير نشط");
    }

    if (user.role_name !== "DIRECTORATE_ADMIN") {
      throw new Error("ليس لديك صلاحية مراجعة طلبات المديرية");
    }

    if (!user.directorate_id) {
      throw new Error("حساب المديرية غير مرتبط بمديرية");
    }

    const requestResult = await client.query(
      `SELECT sr.id, sr.status
       FROM school_requests sr
       JOIN schools s ON s.id = sr.school_id
       WHERE sr.id = $1 AND s.directorate_id = $2
       FOR UPDATE OF sr`,
      [requestId, user.directorate_id]
    );

    const request = requestResult.rows[0];

    if (!request) {
      throw new Error("الطلب غير موجود أو لا يتبع لمديريتك");
    }

    const expectedStatus =
      newStatus === "UNDER_REVIEW" ? "SUBMITTED" : "UNDER_REVIEW";

    if (request.status !== expectedStatus) {
      throw new Error(
        `حالة الطلب الحالية لا تسمح بهذا الإجراء؛ الحالة المطلوبة هي ${expectedStatus}`
      );
    }

    const notes =
      newStatus === "UNDER_REVIEW"
        ? "تم بدء مراجعة الطلب من مديرية التربية"
        : newStatus === "APPROVED"
          ? "تمت الموافقة على الطلب من مديرية التربية"
          : `تم رفض الطلب: ${rejectionReason!.trim()}`;

    const updateResult = await client.query(
      `UPDATE school_requests
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, request_number, school_id, status, updated_at`,
      [newStatus, requestId]
    );

    await client.query(
      `INSERT INTO request_status_history (
         request_id, old_status, new_status, changed_by, notes
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [requestId, request.status, newStatus, user.id, notes]
    );

    await client.query("COMMIT");

    return updateResult.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}