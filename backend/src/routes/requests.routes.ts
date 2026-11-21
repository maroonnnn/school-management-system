import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import pool from "../config/database.js";
import { AuthRequest, authenticateToken, requireRole } from "../middleware/auth.middleware.js";
import { audit } from "../services/audit.service.js";
import {
  REQUEST_TYPES, STATUS_LABEL, addComment, assertCanActForSchool, listRequests, loadRequest, transition,
} from "../services/requests.service.js";
import { HttpError, handle, optionalString, requireId, requireString } from "../utils/http.js";

// FR-REQ-01..18 + teacher account requests (user requirement 2)
const router = Router();
router.use(authenticateToken);

const SCHOOL = requireRole("SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY");
const DIRECTORATE = requireRole("DIRECTORATE_ADMIN");
const PARTIES = requireRole("SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "DIRECTORATE_ADMIN");
const UPLOAD_DIR = path.resolve("uploads", "requests");
const ALLOWED_MIME: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};
const MAX_FILE = 4 * 1024 * 1024;

// ---------------------------------------------------------------- list (FR-REQ-13, 18)
router.get(
  "/",
  PARTIES,
  handle<AuthRequest>(async (req, res) => {
    const q = req.query;
    const rows = await listRequests(req.user!, {
      status: typeof q.status === "string" && q.status ? q.status : undefined,
      type: typeof q.type === "string" && q.type ? q.type : undefined,
      schoolId: q.schoolId ? Number(q.schoolId) : undefined,
      overdue: q.overdue === "1",
      q: typeof q.q === "string" && q.q.trim() ? q.q.trim().slice(0, 50) : undefined,
    });
    res.json({ success: true, data: rows });
  })
);

// ---------------------------------------------------------------- one request + timeline
router.get(
  "/:id",
  PARTIES,
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    const r = await loadRequest(req.user!, id);
    const [history, comments, files] = await Promise.all([
      pool.query(
        `SELECT h.old_status, h.new_status, h.notes, u.full_name AS by_name, r.name AS by_role,
                to_char(h.changed_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS at
           FROM request_status_history h JOIN users u ON u.id = h.changed_by JOIN roles r ON r.id = u.role_id
          WHERE h.request_id = $1 ORDER BY h.changed_at`, [id]),
      pool.query(
        `SELECT c.id, c.body, u.full_name AS by_name, r.name AS by_role,
                to_char(c.created_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS at
           FROM request_comments c JOIN users u ON u.id = c.author_id JOIN roles r ON r.id = u.role_id
          WHERE c.request_id = $1 ORDER BY c.created_at`, [id]),
      pool.query(
        `SELECT a.id, a.file_name, a.file_type, a.file_size, u.full_name AS by_name,
                to_char(a.uploaded_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS at
           FROM request_attachments a JOIN users u ON u.id = a.uploaded_by WHERE a.request_id = $1 ORDER BY a.uploaded_at`, [id]),
    ]);
    // the priority shown here comes from the same list computation (FR-ALG-04: never stored)
    const listed = (await listRequests(req.user!, { schoolId: Number(r.school_id) })).find((x) => Number(x.id) === id);
    const { priority_score: _unused, priority_reason: _unused2, ...rest } = r;
    res.json({
      success: true,
      data: {
        ...rest,
        priority: listed?.priority ?? null, priority_reason: listed?.priority_reason ?? null, overdue: listed?.overdue ?? false,
        history: history.rows, comments: comments.rows, attachments: files.rows,
      },
    });
  })
);

// ---------------------------------------------------------------- create / edit draft (FR-REQ-01..03)
function parseBody(b: Record<string, unknown> = {}) {
  const type = String(b.requestType ?? "") as (typeof REQUEST_TYPES)[number];
  if (!REQUEST_TYPES.includes(type)) throw new HttpError(400, "نوع الطلب غير صالح");
  const severity = Number(b.severity ?? 3);
  const affected = Number(b.affectedStudents ?? 0);
  if (!Number.isInteger(severity) || severity < 1 || severity > 5) throw new HttpError(400, "الخطورة بين 1 و5");
  if (!Number.isInteger(affected) || affected < 0 || affected > 100000) throw new HttpError(400, "عدد الطلاب المتأثرين غير صالح");
  return {
    type, severity, affected,
    title: requireString(b.title, "عنوان الطلب", 200),
    description: requireString(b.description, "وصف الطلب", 5000),
    targetEmployeeId: b.targetEmployeeId ? requireId(b.targetEmployeeId, "المعلم") : null,
  };
}

async function validateAccountTarget(schoolId: number, employeeId: number | null) {
  if (!employeeId) throw new HttpError(400, "اختر المعلم المطلوب إنشاء حساب له");
  const r = await pool.query(
    `SELECT 1 FROM employee_assignments ea WHERE ea.employee_id = $1 AND ea.school_id = $2 AND ea.is_active
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.employee_id = ea.employee_id)`,
    [employeeId, schoolId]
  );
  if (!r.rowCount) throw new HttpError(400, "المعلم لا يتبع لمدرستك أو لديه حساب مسبقاً");
  const open = await pool.query(
    `SELECT 1 FROM school_requests WHERE target_employee_id = $1 AND status NOT IN ('REJECTED', 'CLOSED', 'COMPLETED')`, [employeeId]);
  if (open.rowCount) throw new HttpError(409, "يوجد طلب حساب مفتوح لهذا المعلم");
}

router.post(
  "/",
  SCHOOL,
  handle<AuthRequest>(async (req, res) => {
    await assertCanActForSchool(req.user!);
    const b = parseBody(req.body);
    if (b.type === "TEACHER_ACCOUNT") await validateAccountTarget(req.user!.schoolId!, b.targetEmployeeId);
    const number = `REQ-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`; // FR-REQ-02
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `INSERT INTO school_requests (request_number, school_id, created_by, request_type, title, description, severity, affected_students, target_employee_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'DRAFT') RETURNING id, request_number`,
        [number, req.user!.schoolId, req.user!.id, b.type, b.title, b.description, b.severity, b.affected,
         b.type === "TEACHER_ACCOUNT" ? b.targetEmployeeId : null]
      );
      await client.query(
        "INSERT INTO request_status_history (request_id, old_status, new_status, changed_by) VALUES ($1, NULL, 'DRAFT', $2)",
        [r.rows[0].id, req.user!.id]
      );
      await client.query("COMMIT");
      void audit({ userId: req.user!.id, action: "DATA_CREATE", entityType: "school_request", entityId: r.rows[0].id, req });
      res.status(201).json({ success: true, message: `تم حفظ المسودة برقم ${r.rows[0].request_number}`, data: r.rows[0] });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

router.put(
  "/:id",
  SCHOOL,
  handle<AuthRequest>(async (req, res) => {
    await assertCanActForSchool(req.user!);
    const id = requireId(req.params.id);
    const cur = await loadRequest(req.user!, id);
    if (cur.status !== "DRAFT") throw new HttpError(409, "لا يمكن تعديل الطلب بعد تقديمه");
    const b = parseBody(req.body);
    if (b.type === "TEACHER_ACCOUNT" && Number(cur.target_employee_id) !== b.targetEmployeeId) {
      await validateAccountTarget(req.user!.schoolId!, b.targetEmployeeId);
    }
    await pool.query(
      `UPDATE school_requests SET request_type=$1, title=$2, description=$3, severity=$4, affected_students=$5,
              target_employee_id=$6, updated_at=now() WHERE id=$7`,
      [b.type, b.title, b.description, b.severity, b.affected, b.type === "TEACHER_ACCOUNT" ? b.targetEmployeeId : null, id]
    );
    res.json({ success: true, message: "تم حفظ التعديلات" });
  })
);

router.delete(
  "/:id",
  SCHOOL,
  handle<AuthRequest>(async (req, res) => {
    await assertCanActForSchool(req.user!);
    const id = requireId(req.params.id);
    const cur = await loadRequest(req.user!, id);
    if (cur.status !== "DRAFT") throw new HttpError(409, "يمكن حذف المسودات فقط");
    await pool.query("DELETE FROM request_status_history WHERE request_id = $1", [id]);
    await pool.query("DELETE FROM school_requests WHERE id = $1", [id]);
    res.json({ success: true, message: "تم حذف المسودة" });
  })
);

// ---------------------------------------------------------------- workflow actions (FR-REQ-05, 06, 10, 11, 14)
router.post(
  "/:id/actions/:action",
  PARTIES,
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    const action = String(req.params.action);
    const note = optionalString(req.body?.note, 2000);
    const t = await transition(req.user!, id, action, note);
    void audit({ userId: req.user!.id, action: "REQUEST_STATUS_CHANGE", entityType: "school_request", entityId: id, details: { ...t, note }, req });
    res.json({ success: true, message: `تم: ${STATUS_LABEL[t.to]}` });
  })
);

// ---------------------------------------------------------------- comments (FR-REQ-09, FR-MSG-11)
router.post(
  "/:id/comments",
  PARTIES,
  handle<AuthRequest>(async (req, res) => {
    await addComment(req.user!, requireId(req.params.id), requireString(req.body?.body, "نص التعليق", 2000));
    res.status(201).json({ success: true, message: "تمت إضافة التعليق" });
  })
);

// ---------------------------------------------------------------- assignment to a department / employee (FR-REQ-08)
router.put(
  "/:id/assign",
  DIRECTORATE,
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    const r = await loadRequest(req.user!, id);
    if (["REJECTED", "CLOSED"].includes(r.status)) throw new HttpError(409, "الطلب مغلق");
    const department = optionalString(req.body?.department, 150);
    const assignedTo = req.body?.assignedTo ? requireId(req.body.assignedTo, "الموظف") : null;
    if (assignedTo) {
      const ok = await pool.query("SELECT 1 FROM users WHERE id = $1 AND directorate_id = $2 AND is_active", [assignedTo, req.user!.directorateId]);
      if (!ok.rowCount) throw new HttpError(400, "الموظف المختار لا يتبع للمديرية");
    }
    if (!department && !assignedTo) throw new HttpError(400, "حدّد القسم أو الموظف");
    await pool.query("UPDATE school_requests SET assigned_department = $1, assigned_to = $2, updated_at = now() WHERE id = $3", [department, assignedTo, id]);
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "school_request_assignment", entityId: id, details: { department, assignedTo }, req });
    res.json({ success: true, message: "تم تحويل الطلب" });
  })
);

router.get(
  "/meta/directorate-staff",
  DIRECTORATE,
  handle<AuthRequest>(async (req, res) => {
    const r = await pool.query("SELECT id, full_name FROM users WHERE directorate_id = $1 AND is_active ORDER BY full_name", [req.user!.directorateId]);
    res.json({ success: true, data: r.rows });
  })
);

// Teachers of my school without an account (for TEACHER_ACCOUNT requests)
router.get(
  "/meta/teachers-without-account",
  SCHOOL,
  handle<AuthRequest>(async (req, res) => {
    const r = await pool.query(
      `SELECT e.id, e.full_name, e.employee_number, ea.position_type
         FROM employees e JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.is_active AND ea.school_id = $1
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.employee_id = e.id) ORDER BY e.full_name`,
      [req.user!.schoolId]
    );
    res.json({ success: true, data: r.rows });
  })
);

// ---------------------------------------------------------------- teacher account request: the directorate creates it (user requirement 2)
router.post(
  "/:id/create-account",
  DIRECTORATE,
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    const r = await loadRequest(req.user!, id);
    if (r.request_type !== "TEACHER_ACCOUNT") throw new HttpError(400, "هذا ليس طلب حساب معلم");
    if (!["APPROVED", "IN_PROGRESS"].includes(r.status)) throw new HttpError(409, "يجب قبول الطلب أولاً");
    const employeeNumber = requireString(req.body?.employeeNumber, "الرقم الوظيفي (التسلسلي)", 50);
    const password = String(req.body?.password ?? "");
    if (password.length < 8) throw new HttpError(400, "كلمة المرور 8 أحرف على الأقل");
    const username = `t${employeeNumber.replace(/\D/g, "")}`;
    if (username.length < 2) throw new HttpError(400, "الرقم الوظيفي يجب أن يحتوي أرقاماً");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const emp = await client.query("SELECT full_name, email FROM employees WHERE id = $1", [r.target_employee_id]);
      await client.query("UPDATE employees SET employee_number = $1, updated_at = now() WHERE id = $2", [employeeNumber, r.target_employee_id]);
      const roleId = (await client.query("SELECT id FROM roles WHERE name = 'TEACHER'")).rows[0].id;
      const u = await client.query(
        `INSERT INTO users (role_id, school_id, full_name, username, password_hash, employee_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [roleId, r.school_id, emp.rows[0].full_name, username, await bcrypt.hash(password, 10), r.target_employee_id]
      );
      await client.query("UPDATE school_requests SET status = 'COMPLETED', updated_at = now() WHERE id = $1", [id]);
      const note = `تم إنشاء الحساب: اسم المستخدم ${username} — الرقم الوظيفي ${employeeNumber}. كلمة المرور تُسلَّم للمعلم من المديرية.`;
      await client.query(
        "INSERT INTO request_status_history (request_id, old_status, new_status, changed_by, notes) VALUES ($1, $2, 'COMPLETED', $3, $4)",
        [id, r.status, req.user!.id, note]
      );
      await client.query(
        "INSERT INTO notifications (school_id, title, body, link, request_id) VALUES ($1, $2, $3, $4, $5)",
        [r.school_id, `الطلب ${r.request_number}: تم إنشاء حساب المعلم`, note, `/requests?open=${id}`, id]
      );
      await client.query("COMMIT");
      void audit({ userId: req.user!.id, action: "USER_CREATE", entityType: "user", entityId: u.rows[0].id, details: { viaRequest: id, role: "TEACHER" }, req });
      res.status(201).json({ success: true, message: `تم إنشاء الحساب ${username}. سلّم كلمة المرور للمعلم بشكل آمن — لن تُعرض مرة أخرى.`, data: { username } });
    } catch (e) {
      await client.query("ROLLBACK");
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "الرقم الوظيفي أو اسم المستخدم مستخدم مسبقاً");
      throw e;
    } finally {
      client.release();
    }
  })
);

// ---------------------------------------------------------------- attachments (FR-REQ-03, 09) — base64 JSON, ≤ 4 MB
router.post(
  "/:id/attachments",
  PARTIES,
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    const r = await loadRequest(req.user!, id);
    if (["CLOSED", "REJECTED"].includes(r.status)) throw new HttpError(409, "الطلب مغلق");
    if (req.user!.role !== "DIRECTORATE_ADMIN") await assertCanActForSchool(req.user!);
    const name = requireString(req.body?.fileName, "اسم الملف", 200).replace(/[\\/:*?"<>|]/g, "_");
    const mime = String(req.body?.mimeType ?? "");
    const ext = ALLOWED_MIME[mime];
    if (!ext) throw new HttpError(400, "نوع الملف غير مسموح (PDF، صور، Word)");
    const data = Buffer.from(String(req.body?.dataBase64 ?? "").replace(/^data:[^,]+,/, ""), "base64");
    if (!data.length || data.length > MAX_FILE) throw new HttpError(400, "حجم الملف يجب أن يكون أقل من 4 ميغابايت");
    const dir = path.join(UPLOAD_DIR, String(id));
    await fs.mkdir(dir, { recursive: true });
    const stored = path.join(dir, `${crypto.randomUUID()}.${ext}`); // never the user's file name on disk
    await fs.writeFile(stored, data);
    await pool.query(
      `INSERT INTO request_attachments (request_id, uploaded_by, file_name, file_path, file_type, file_size) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, req.user!.id, name, path.relative(UPLOAD_DIR, stored), mime, data.length]
    );
    await pool.query("UPDATE school_requests SET updated_at = now() WHERE id = $1", [id]);
    res.status(201).json({ success: true, message: "تم رفع المرفق" });
  })
);

router.get(
  "/:id/attachments/:fileId",
  PARTIES,
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    await loadRequest(req.user!, id);
    const f = await pool.query("SELECT file_name, file_path, file_type FROM request_attachments WHERE id = $1 AND request_id = $2", [requireId(req.params.fileId), id]);
    if (!f.rowCount) throw new HttpError(404, "المرفق غير موجود");
    const full = path.resolve(UPLOAD_DIR, f.rows[0].file_path);
    if (!full.startsWith(UPLOAD_DIR + path.sep)) throw new HttpError(400, "مسار غير صالح");
    res.setHeader("Content-Type", f.rows[0].file_type);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(f.rows[0].file_name)}`);
    res.send(await fs.readFile(full));
  })
);

export default router;
