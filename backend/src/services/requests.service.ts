import pool from "../config/database.js";
import type { PoolClient } from "pg";
import type { AuthenticatedUser } from "../middleware/auth.middleware.js";
import { readableSchoolIds } from "./scope.service.js";
import { computePriority, DEFAULT_WEIGHTS, type PriorityWeights } from "../algorithms/requestPriority.js";
import { HttpError } from "../utils/http.js";

// FR-REQ-01..18 — school requests to the directorate

export const REQUEST_TYPES = ["MAINTENANCE", "TEACHERS", "TEXTBOOKS", "FURNITURE", "COMPUTERS", "OTHER", "TEACHER_ACCOUNT"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const OPEN_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "RETURNED", "APPROVED", "IN_PROGRESS"];

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "مسودة", SUBMITTED: "تم التقديم", UNDER_REVIEW: "قيد المراجعة", RETURNED: "مُعاد للتوضيح",
  APPROVED: "مقبول", REJECTED: "مرفوض", IN_PROGRESS: "قيد التنفيذ", COMPLETED: "تم التنفيذ", CLOSED: "مغلق",
};

/**
 * Allowed transitions (FR-REQ-05/06/10/11). `by` = who may perform it; `note` = a text note is mandatory.
 */
export const TRANSITIONS: Record<string, { from: string[]; to: string; by: "SCHOOL" | "DIRECTORATE"; note?: string }> = {
  submit:   { from: ["DRAFT"], to: "SUBMITTED", by: "SCHOOL" },
  review:   { from: ["SUBMITTED"], to: "UNDER_REVIEW", by: "DIRECTORATE" },
  return:   { from: ["SUBMITTED", "UNDER_REVIEW"], to: "RETURNED", by: "DIRECTORATE", note: "يرجى كتابة المطلوب توضيحه" },
  reply:    { from: ["RETURNED"], to: "UNDER_REVIEW", by: "SCHOOL", note: "يرجى كتابة ردّ المدرسة" },
  approve:  { from: ["SUBMITTED", "UNDER_REVIEW"], to: "APPROVED", by: "DIRECTORATE" },
  reject:   { from: ["SUBMITTED", "UNDER_REVIEW"], to: "REJECTED", by: "DIRECTORATE", note: "سبب الرفض مطلوب" },
  start:    { from: ["APPROVED"], to: "IN_PROGRESS", by: "DIRECTORATE" },
  complete: { from: ["APPROVED", "IN_PROGRESS"], to: "COMPLETED", by: "DIRECTORATE" },
  confirm:  { from: ["COMPLETED"], to: "CLOSED", by: "SCHOOL" },  // FR-REQ-11: only the school closes
};

const isSchoolManager = (u: AuthenticatedUser) => u.role === "SCHOOL_PRINCIPAL" || u.role === "SCHOOL_DEPUTY";

/** Principal always; deputy only with an active authorization from the principal (kept from the original rules). */
export async function assertCanActForSchool(u: AuthenticatedUser) {
  if (u.role === "SCHOOL_PRINCIPAL") return;
  if (u.role !== "SCHOOL_DEPUTY") throw new HttpError(403, "ليس لديك صلاحية طلبات المدرسة");
  const r = await pool.query(
    `SELECT 1 FROM school_deputy_authorizations WHERE school_id = $1 AND deputy_user_id = $2 AND is_active`,
    [u.schoolId, u.id]
  );
  if (!r.rowCount) throw new HttpError(403, "النائب غير مخوّل بطلبات هذه المدرسة — يحتاج تفويضاً من المدير");
}

/** Loads a request the user is allowed to see (school managers: own school; directorate: its schools). */
export async function loadRequest(u: AuthenticatedUser, id: number) {
  const r = await pool.query(
    `SELECT sr.*, s.name AS school_name, s.directorate_id, cu.full_name AS created_by_name,
            au.full_name AS assigned_to_name, te.full_name AS target_employee_name, te.employee_number AS target_employee_number
       FROM school_requests sr
       JOIN schools s ON s.id = sr.school_id
       JOIN users cu ON cu.id = sr.created_by
       LEFT JOIN users au ON au.id = sr.assigned_to
       LEFT JOIN employees te ON te.id = sr.target_employee_id
      WHERE sr.id = $1`,
    [id]
  );
  const req = r.rows[0];
  if (!req) throw new HttpError(404, "الطلب غير موجود");
  if (isSchoolManager(u)) {
    if (Number(req.school_id) !== u.schoolId) throw new HttpError(404, "الطلب غير موجود");
  } else if (u.role === "DIRECTORATE_ADMIN") {
    if (Number(req.directorate_id) !== u.directorateId || req.status === "DRAFT") throw new HttpError(404, "الطلب غير موجود");
  } else {
    throw new HttpError(403, "ليس لديك صلاحية الاطلاع على الطلبات");
  }
  return req;
}

async function notify(client: PoolClient, n: { schoolId?: number; directorateId?: number; title: string; body?: string; requestId: number; link: string }) {
  await client.query(
    `INSERT INTO notifications (school_id, directorate_id, title, body, link, request_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [n.schoolId ?? null, n.directorateId ?? null, n.title, n.body ?? null, n.link, n.requestId]
  );
}

/** Applies a transition + history row + notification to the other side (FR-REQ-14), in one transaction. */
export async function transition(u: AuthenticatedUser, id: number, action: string, note: string | null) {
  const t = TRANSITIONS[action];
  if (!t) throw new HttpError(400, "إجراء غير معروف");
  const req = await loadRequest(u, id);
  if (t.by === "SCHOOL") await assertCanActForSchool(u);
  else if (u.role !== "DIRECTORATE_ADMIN") throw new HttpError(403, "هذا الإجراء للمديرية فقط");
  if (!t.from.includes(req.status)) {
    throw new HttpError(409, `لا يمكن تنفيذ هذا الإجراء والطلب بحالة «${STATUS_LABEL[req.status]}»`);
  }
  if (t.note && !note?.trim()) throw new HttpError(400, t.note);
  if (action === "complete" && req.request_type === "TEACHER_ACCOUNT") {
    throw new HttpError(400, "طلب حساب المعلم يُنفَّذ بإنشاء الحساب من شاشة الطلب");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE school_requests SET status = $1::varchar, updated_at = now(),
              submitted_at = CASE WHEN $1::varchar = 'SUBMITTED' THEN COALESCE(submitted_at, now()) ELSE submitted_at END,
              closed_at = CASE WHEN $1::varchar IN ('CLOSED', 'REJECTED') THEN now() ELSE closed_at END
        WHERE id = $2`,
      [t.to, id]
    );
    await client.query(
      `INSERT INTO request_status_history (request_id, old_status, new_status, changed_by, notes) VALUES ($1, $2, $3, $4, $5)`,
      [id, req.status, t.to, u.id, note?.trim() || null]
    );
    const title = `الطلب ${req.request_number}: ${STATUS_LABEL[t.to]}`;
    if (t.by === "DIRECTORATE") {
      await notify(client, { schoolId: Number(req.school_id), title, body: note ?? undefined, requestId: id, link: `/requests?open=${id}` });
    } else {
      await notify(client, { directorateId: Number(req.directorate_id), title: `${req.school_name} — ${title}`, body: note ?? undefined, requestId: id, link: `/requests/review?open=${id}` });
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { from: req.status, to: t.to };
}

export async function addComment(u: AuthenticatedUser, id: number, body: string) {
  const req = await loadRequest(u, id);
  if (isSchoolManager(u)) await assertCanActForSchool(u);
  if (["DRAFT", "CLOSED"].includes(req.status) && u.role === "DIRECTORATE_ADMIN") throw new HttpError(409, "لا يمكن التعليق على هذا الطلب");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO request_comments (request_id, author_id, body) VALUES ($1, $2, $3)", [id, u.id, body]);
    await client.query("UPDATE school_requests SET updated_at = now() WHERE id = $1", [id]);
    if (req.status !== "DRAFT") {
      // FR-MSG-11: directorate replies appear in the school inbox (and vice versa), without re-typing
      if (u.role === "DIRECTORATE_ADMIN") {
        await notify(client, { schoolId: Number(req.school_id), title: `تعليق من المديرية على الطلب ${req.request_number}`, body, requestId: id, link: `/requests?open=${id}` });
      } else {
        await notify(client, { directorateId: Number(req.directorate_id), title: `${req.school_name} — تعليق على الطلب ${req.request_number}`, body, requestId: id, link: `/requests/review?open=${id}` });
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------- listing with computed priority (FR-REQ-15..18, FR-ALG-04)
export interface ListFilters { status?: string; type?: string; schoolId?: number; overdue?: boolean; q?: string }

export async function listRequests(u: AuthenticatedUser, f: ListFilters) {
  let schoolIds: number[];
  if (isSchoolManager(u)) schoolIds = [u.schoolId!];
  else if (u.role === "DIRECTORATE_ADMIN") schoolIds = (await readableSchoolIds(u)) ?? [];
  else throw new HttpError(403, "ليس لديك صلاحية الاطلاع على الطلبات");
  if (f.schoolId) {
    if (!schoolIds.includes(f.schoolId)) throw new HttpError(403, "المدرسة خارج نطاقك");
    schoolIds = [f.schoolId];
  }

  const rows = (await pool.query(
    `SELECT sr.id, sr.request_number, sr.school_id, s.name AS school_name, sr.request_type, sr.title, sr.status,
            sr.severity, sr.affected_students, sr.assigned_department, au.full_name AS assigned_to_name,
            to_char(sr.submitted_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD') AS submitted_date,
            to_char(sr.updated_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS updated_at,
            EXTRACT(EPOCH FROM now() - COALESCE(sr.submitted_at, sr.created_at)) / 86400 AS waiting_days,
            cu.full_name AS created_by_name
       FROM school_requests sr
       JOIN schools s ON s.id = sr.school_id
       JOIN users cu ON cu.id = sr.created_by
       LEFT JOIN users au ON au.id = sr.assigned_to
      WHERE sr.school_id = ANY($1::bigint[])
        AND ($2::text IS NOT NULL OR sr.status <> 'DRAFT' OR $3)
        AND ($2::text IS NULL OR sr.status = $2)
        AND ($4::text IS NULL OR sr.request_type = $4)
        AND ($5::text IS NULL OR sr.request_number ILIKE '%' || $5 || '%' OR sr.title ILIKE '%' || $5 || '%')
      ORDER BY sr.updated_at DESC`,
    [schoolIds, f.status ?? null, isSchoolManager(u), f.type ?? null, f.q ?? null]
  )).rows;
  if (u.role === "DIRECTORATE_ADMIN") {
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].status === "DRAFT") rows.splice(i, 1); // drafts stay private to the school
  }

  const ctx = await priorityContext(schoolIds);
  const out = rows.map((r) => {
    const open = OPEN_STATUSES.includes(r.status);
    const sc = ctx.schools.get(Number(r.school_id));
    const p = open
      ? computePriority({
          severity: Number(r.severity),
          affectedStudents: Number(r.affected_students),
          schoolStudents: sc?.students ?? 0,
          waitingDays: Number(r.waiting_days),
          overdueDays: ctx.overdueDays,
          schoolAbsenceRate: sc?.absenceRate ?? 0,
          schoolOpenRequests: Math.max(0, (sc?.open ?? 0) - 1),
          sameTypeRecent: Math.max(0, (ctx.sameType.get(`${r.school_id}|${r.request_type}`) ?? 0) - 1),
        }, ctx.weights)
      : null;
    // A request returned for clarification is waiting on the school, not the directorate → not "overdue"
    const overdue = (p?.overdue ?? false) && r.status !== "RETURNED";
    return { ...r, waiting_days: Math.floor(Number(r.waiting_days)), priority: p?.score ?? null, priority_reason: p?.reason ?? null, overdue };
  });
  return f.overdue ? out.filter((r) => r.overdue) : out;
}

/** Per-school figures the priority needs, computed in bulk. */
async function priorityContext(schoolIds: number[]) {
  const settings = await pool.query("SELECT key, value FROM settings WHERE key IN ('request_priority_weights', 'request_overdue_days')");
  const weights: PriorityWeights = { ...DEFAULT_WEIGHTS, ...(settings.rows.find((s) => s.key === "request_priority_weights")?.value ?? {}) };
  const overdueDays = Number(settings.rows.find((s) => s.key === "request_overdue_days")?.value ?? 7);

  const stats = await pool.query(
    `WITH days AS (
       SELECT d::date AS day FROM generate_series(CURRENT_DATE - 30, CURRENT_DATE - 1, interval '1 day') d
        WHERE EXTRACT(DOW FROM d)::int + 1 IN (SELECT jsonb_array_elements_text(value)::int FROM settings WHERE key = 'work_days')
     ), staff_days AS (
       SELECT ea.school_id, COUNT(*) AS expected,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM attendance_events ae WHERE ae.employee_assignment_id = ea.id
                                AND (ae.event_time AT TIME ZONE 'Asia/Damascus')::date = days.day)) AS with_events
         FROM employee_assignments ea CROSS JOIN days
        WHERE ea.is_active AND ea.school_id = ANY($1::bigint[]) AND ea.position_type <> 'TEACHER'
           OR (ea.is_active AND ea.school_id = ANY($1::bigint[]) AND ea.position_type = 'TEACHER'
               AND EXISTS (SELECT 1 FROM teaching_assignments ta JOIN timetable_periods tp ON tp.teaching_assignment_id = ta.id
                            WHERE ta.employee_assignment_id = ea.id AND tp.day_of_week = EXTRACT(DOW FROM days.day)::int + 1))
        GROUP BY ea.school_id
     )
     SELECT s.id,
            (SELECT COUNT(*) FROM student_enrollments se JOIN sections sc ON sc.id = se.section_id JOIN classes c ON c.id = sc.class_id
              WHERE c.school_id = s.id AND se.status = 'ACTIVE')::int AS students,
            (SELECT COUNT(*) FROM school_requests r WHERE r.school_id = s.id AND r.status = ANY($2))::int AS open,
            COALESCE(1 - sd.with_events::float / NULLIF(sd.expected, 0), 0) AS absence_rate
       FROM schools s LEFT JOIN staff_days sd ON sd.school_id = s.id
      WHERE s.id = ANY($1::bigint[])`,
    [schoolIds, OPEN_STATUSES]
  );
  const sameType = await pool.query(
    `SELECT school_id, request_type, COUNT(*)::int AS n FROM school_requests
      WHERE school_id = ANY($1::bigint[]) AND status <> 'DRAFT' AND COALESCE(submitted_at, created_at) > now() - interval '180 days'
      GROUP BY 1, 2`,
    [schoolIds]
  );
  return {
    weights,
    overdueDays,
    schools: new Map(stats.rows.map((r) => [Number(r.id), { students: r.students, open: r.open, absenceRate: Number(r.absence_rate) }])),
    sameType: new Map(sameType.rows.map((r) => [`${r.school_id}|${r.request_type}`, r.n])),
  };
}
