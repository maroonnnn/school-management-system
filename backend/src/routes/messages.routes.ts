import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import pool from "../config/database.js";
import { AuthRequest, AuthenticatedUser, authenticateToken, requireRole } from "../middleware/auth.middleware.js";
import { readableSchoolIds } from "../services/scope.service.js";
import { assertCanActForSchool } from "../services/requests.service.js";
import { audit } from "../services/audit.service.js";
import { HttpError, handle, requireId, requireString } from "../utils/http.js";

// FR-MSG-01..12 — circulars, notices and school ↔ directorate messages
const router = Router();
router.use(authenticateToken);
router.use(requireRole("MINISTRY_ADMIN", "DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY"));

const UPLOAD_DIR = path.resolve("uploads", "messages");
const ALLOWED_MIME: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};
const MAX_FILE = 3 * 1024 * 1024;

type Box = { type: "MINISTRY" | "DIRECTORATE" | "SCHOOL"; id: number };

/** The organisation mailbox the user acts for. */
function mailbox(u: AuthenticatedUser): Box {
  if (u.role === "MINISTRY_ADMIN") return { type: "MINISTRY", id: 1 };
  if (u.role === "DIRECTORATE_ADMIN") return { type: "DIRECTORATE", id: u.directorateId! };
  return { type: "SCHOOL", id: u.schoolId! };
}

const BOX_NAME = `CASE m.sender_type
    WHEN 'MINISTRY' THEN 'وزارة التربية والتعليم'
    WHEN 'DIRECTORATE' THEN (SELECT name FROM directorates WHERE id = m.sender_ref_id)
    ELSE (SELECT name FROM schools WHERE id = m.sender_ref_id) END`;

// ---------------------------------------------------------------- inbox (FR-MSG-03)
router.get(
  "/inbox",
  handle<AuthRequest>(async (req, res) => {
    const box = mailbox(req.user!);
    if (box.type === "MINISTRY") return res.json({ success: true, data: [] }); // nobody writes to the ministry (FR-MSG-04)
    const r = await pool.query(
      `SELECT m.id, m.kind, m.subject, left(m.body, 160) AS preview, m.requires_ack, ${BOX_NAME} AS sender_name,
              to_char(m.sent_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS sent_at,
              mr.opened_at IS NOT NULL AS opened, mr.acknowledged_at IS NOT NULL AS acknowledged,
              (SELECT COUNT(*) FROM message_attachments a WHERE a.message_id = m.id)::int AS attachments
         FROM message_recipients mr JOIN messages m ON m.id = mr.message_id
        WHERE mr.recipient_type = $1 AND mr.recipient_ref_id = $2 AND m.status = 'SENT'
        ORDER BY m.sent_at DESC LIMIT 200`,
      [box.type, box.id]
    );
    res.json({ success: true, data: r.rows });
  })
);

// ---------------------------------------------------------------- outbox + drafts, with read stats (FR-MSG-03, 10)
router.get(
  "/outbox",
  handle<AuthRequest>(async (req, res) => {
    const box = mailbox(req.user!);
    const r = await pool.query(
      `SELECT m.id, m.kind, m.subject, m.status, m.requires_ack, m.target_summary,
              to_char(COALESCE(m.sent_at, m.created_at) AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS at,
              COUNT(mr.*)::int AS recipients,
              COUNT(mr.opened_at)::int AS opened,
              COUNT(mr.acknowledged_at)::int AS acknowledged
         FROM messages m LEFT JOIN message_recipients mr ON mr.message_id = m.id
        WHERE m.sender_type = $1 AND m.sender_ref_id = $2
        GROUP BY m.id ORDER BY m.status = 'DRAFT' DESC, COALESCE(m.sent_at, m.created_at) DESC LIMIT 200`,
      [box.type, box.id]
    );
    res.json({ success: true, data: r.rows });
  })
);

/** Loads a message visible to the user's mailbox (as sender or recipient). */
async function loadMessage(u: AuthenticatedUser, id: number) {
  const box = mailbox(u);
  const r = await pool.query(
    `SELECT m.*, ${BOX_NAME} AS sender_name, su.full_name AS sender_user_name,
            to_char(m.sent_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS sent_at_text
       FROM messages m JOIN users su ON su.id = m.sender_user_id WHERE m.id = $1`,
    [id]
  );
  const m = r.rows[0];
  if (!m) throw new HttpError(404, "الرسالة غير موجودة");
  const isSender = m.sender_type === box.type && Number(m.sender_ref_id) === box.id;
  if (isSender) return { m, isSender, recipientRow: null };
  if (m.status !== "SENT") throw new HttpError(404, "الرسالة غير موجودة");
  const rr = await pool.query(
    "SELECT * FROM message_recipients WHERE message_id = $1 AND recipient_type = $2 AND recipient_ref_id = $3",
    [id, box.type, box.id]
  );
  if (!rr.rowCount) throw new HttpError(404, "الرسالة غير موجودة");
  return { m, isSender, recipientRow: rr.rows[0] };
}

router.get(
  "/:id",
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    const { m, isSender, recipientRow } = await loadMessage(req.user!, id);
    // FR-MSG-10: the first time anyone in the recipient mailbox opens it
    if (recipientRow && !recipientRow.opened_at) {
      await pool.query(
        `UPDATE message_recipients SET opened_at = now(), opened_by = $1
          WHERE message_id = $2 AND recipient_type = $3 AND recipient_ref_id = $4 AND opened_at IS NULL`,
        [req.user!.id, id, recipientRow.recipient_type, recipientRow.recipient_ref_id]
      );
    }
    const files = await pool.query("SELECT id, file_name, file_type, file_size FROM message_attachments WHERE message_id = $1 ORDER BY id", [id]);
    let recipients: unknown[] = [];
    if (isSender) {
      recipients = (await pool.query(
        `SELECT mr.recipient_type, mr.recipient_ref_id,
                CASE mr.recipient_type WHEN 'SCHOOL' THEN (SELECT name FROM schools WHERE id = mr.recipient_ref_id)
                     ELSE (SELECT name FROM directorates WHERE id = mr.recipient_ref_id) END AS name,
                to_char(mr.opened_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS opened_at, ou.full_name AS opened_by_name,
                to_char(mr.acknowledged_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS acknowledged_at, au.full_name AS acknowledged_by_name
           FROM message_recipients mr LEFT JOIN users ou ON ou.id = mr.opened_by LEFT JOIN users au ON au.id = mr.acknowledged_by
          WHERE mr.message_id = $1 ORDER BY mr.recipient_type, name`,
        [id]
      )).rows;
    }
    const { body, subject, kind, status, requires_ack, target_summary, sender_name, sender_user_name, sent_at_text, reply_to_id } = m;
    res.json({
      success: true,
      data: {
        id, body, subject, kind, status, requires_ack, target_summary, sender_name, sender_user_name, sent_at: sent_at_text, reply_to_id,
        isSender, attachments: files.rows, recipients,
        acknowledged: recipientRow ? !!recipientRow.acknowledged_at : null,
      },
    });
  })
);

router.post(
  "/:id/acknowledge",
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    const { recipientRow } = await loadMessage(req.user!, id);
    if (!recipientRow) throw new HttpError(400, "لا يمكن تأكيد رسالة أرسلتها");
    await pool.query(
      `UPDATE message_recipients SET acknowledged_at = now(), acknowledged_by = $1, opened_at = COALESCE(opened_at, now()), opened_by = COALESCE(opened_by, $1)
        WHERE message_id = $2 AND recipient_type = $3 AND recipient_ref_id = $4 AND acknowledged_at IS NULL`,
      [req.user!.id, id, recipientRow.recipient_type, recipientRow.recipient_ref_id]
    );
    res.json({ success: true, message: "تم تأكيد الاستلام" });
  })
);

// ---------------------------------------------------------------- compose (draft) — FR-MSG-01, 02, 04, 08
interface Target { mode: "ALL_SCHOOLS" | "DIRECTORATES" | "SCHOOLS" | "MY_DIRECTORATE"; ids?: number[] }

/** Resolves who receives the message and enforces who may write to whom. */
async function resolveRecipients(u: AuthenticatedUser, t: Target) {
  const ids = Array.isArray(t?.ids) ? t.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  const rows: { type: "DIRECTORATE" | "SCHOOL"; id: number }[] = [];
  let summary = "";
  if (u.role === "MINISTRY_ADMIN") {
    let schools: { id: number; directorate_id: number }[];
    if (t.mode === "ALL_SCHOOLS") {
      schools = (await pool.query("SELECT id, directorate_id FROM schools WHERE is_active")).rows;
      summary = "كل المدارس";
    } else if (t.mode === "DIRECTORATES") {
      if (!ids.length) throw new HttpError(400, "اختر مديرية واحدة على الأقل");
      schools = (await pool.query("SELECT id, directorate_id FROM schools WHERE is_active AND directorate_id = ANY($1)", [ids])).rows;
      const names = (await pool.query("SELECT name FROM directorates WHERE id = ANY($1)", [ids])).rows.map((r) => r.name);
      summary = `مدارس ${names.join("، ")}`;
    } else if (t.mode === "SCHOOLS") {
      if (!ids.length) throw new HttpError(400, "اختر مدرسة واحدة على الأقل");
      schools = (await pool.query("SELECT id, directorate_id FROM schools WHERE is_active AND id = ANY($1)", [ids])).rows;
      summary = `${schools.length} مدارس محددة`;
    } else throw new HttpError(400, "جهة الإرسال غير صالحة");
    schools.forEach((s) => rows.push({ type: "SCHOOL", id: Number(s.id) }));
    // directorates get a copy of ministry circulars that concern their schools
    [...new Set(schools.map((s) => Number(s.directorate_id)))].forEach((d) => rows.push({ type: "DIRECTORATE", id: d }));
  } else if (u.role === "DIRECTORATE_ADMIN") {
    const mine = (await readableSchoolIds(u)) ?? [];
    let chosen: number[];
    if (t.mode === "ALL_SCHOOLS") { chosen = mine; summary = "كل مدارس المديرية"; }
    else if (t.mode === "SCHOOLS") {
      if (!ids.length) throw new HttpError(400, "اختر مدرسة واحدة على الأقل");
      if (ids.some((i) => !mine.includes(i))) throw new HttpError(403, "يمكن المراسلة لمدارس مديريتك فقط (FR-MSG-02)");
      chosen = ids;
      summary = `${ids.length} مدارس محددة`;
    } else throw new HttpError(400, "المديرية تراسل مدارسها فقط");
    chosen.forEach((s) => rows.push({ type: "SCHOOL", id: s }));
  } else {
    // FR-MSG-04: a school writes only to its own directorate
    if (t.mode !== "MY_DIRECTORATE") throw new HttpError(403, "يمكن للمدرسة مراسلة مديريتها فقط");
    const d = await pool.query("SELECT directorate_id FROM schools WHERE id = $1", [u.schoolId]);
    rows.push({ type: "DIRECTORATE", id: Number(d.rows[0].directorate_id) });
    summary = "المديرية";
  }
  if (!rows.length) throw new HttpError(400, "لا توجد جهات مستلمة");
  return { rows, summary };
}

function kindFor(u: AuthenticatedUser) {
  return u.role === "MINISTRY_ADMIN" ? "CIRCULAR" : u.role === "DIRECTORATE_ADMIN" ? "NOTICE" : "MESSAGE";
}

async function saveAttachments(client: PoolClient, messageId: number, files: unknown) {
  if (files == null) return;
  if (!Array.isArray(files) || files.length > 3) throw new HttpError(400, "حتى 3 مرفقات فقط");
  for (const f of files as { fileName?: unknown; mimeType?: unknown; dataBase64?: unknown }[]) {
    const name = requireString(f?.fileName, "اسم الملف", 200).replace(/[\\/:*?"<>|]/g, "_");
    const ext = ALLOWED_MIME[String(f?.mimeType ?? "")];
    if (!ext) throw new HttpError(400, "نوع المرفق غير مسموح (PDF، صور، Word)");
    const data = Buffer.from(String(f?.dataBase64 ?? "").replace(/^data:[^,]+,/, ""), "base64");
    if (!data.length || data.length > MAX_FILE) throw new HttpError(400, "حجم كل مرفق أقل من 3 ميغابايت");
    const dir = path.join(UPLOAD_DIR, String(messageId));
    await fs.mkdir(dir, { recursive: true });
    const stored = path.join(dir, `${crypto.randomUUID()}.${ext}`);
    await fs.writeFile(stored, data);
    await client.query(
      "INSERT INTO message_attachments (message_id, file_name, file_path, file_type, file_size) VALUES ($1, $2, $3, $4, $5)",
      [messageId, name, path.relative(UPLOAD_DIR, stored), String(f.mimeType), data.length]
    );
  }
}

async function sendNow(client: PoolClient, u: AuthenticatedUser, id: number) {
  const m = (await client.query("SELECT subject, kind FROM messages WHERE id = $1", [id])).rows[0];
  const rec = (await client.query("SELECT recipient_type, recipient_ref_id FROM message_recipients WHERE message_id = $1", [id])).rows;
  await client.query("UPDATE messages SET status = 'SENT', sent_at = now() WHERE id = $1", [id]);
  const label = m.kind === "CIRCULAR" ? "تعميم من الوزارة" : m.kind === "NOTICE" ? "إشعار من المديرية" : "رسالة من مدرسة";
  for (const r of rec) {
    await client.query(
      `INSERT INTO notifications (school_id, directorate_id, title, body, link, message_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [r.recipient_type === "SCHOOL" ? r.recipient_ref_id : null, r.recipient_type === "DIRECTORATE" ? r.recipient_ref_id : null,
       `${label}: ${m.subject}`, null, `/messages?box=inbox&open=${id}`, id]
    );
  }
  void u;
}

router.post(
  "/",
  handle<AuthRequest>(async (req, res) => {
    const u = req.user!;
    if (u.role === "SCHOOL_PRINCIPAL" || u.role === "SCHOOL_DEPUTY") await assertCanActForSchool(u);
    const subject = requireString(req.body?.subject, "عنوان الرسالة", 200);
    const body = requireString(req.body?.body, "نص الرسالة", 20000);
    const { rows, summary } = await resolveRecipients(u, req.body?.target);
    const replyTo = req.body?.replyToId ? requireId(req.body.replyToId, "الرسالة") : null;
    if (replyTo) await loadMessage(u, replyTo);
    const box = mailbox(u);
    const send = req.body?.send === true;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const m = await client.query(
        `INSERT INTO messages (kind, sender_type, sender_ref_id, sender_user_id, subject, body, requires_ack, reply_to_id, target_summary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [kindFor(u), box.type, box.id, u.id, subject, body, req.body?.requiresAck === true && u.role !== "SCHOOL_PRINCIPAL" && u.role !== "SCHOOL_DEPUTY", replyTo, summary]
      );
      const id = Number(m.rows[0].id);
      for (const r of rows) {
        await client.query("INSERT INTO message_recipients (message_id, recipient_type, recipient_ref_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id, r.type, r.id]);
      }
      await saveAttachments(client, id, req.body?.attachments);
      if (send) await sendNow(client, u, id);
      await client.query("COMMIT");
      void audit({ userId: u.id, action: "DATA_CREATE", entityType: "message", entityId: id, details: { send, recipients: rows.length }, req });
      res.status(201).json({ success: true, message: send ? `تم الإرسال إلى ${summary}` : "تم حفظ المسودة", data: { id } });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

/** Drafts can still be edited (FR-MSG-08); the DB blocks any change after sending (FR-MSG-07). */
async function loadOwnDraft(u: AuthenticatedUser, id: number) {
  const { m, isSender } = await loadMessage(u, id);
  if (!isSender) throw new HttpError(404, "الرسالة غير موجودة");
  if (m.status !== "DRAFT") throw new HttpError(409, "لا يمكن تعديل الرسالة أو حذفها بعد إرسالها");
  return m;
}

router.put(
  "/:id",
  handle<AuthRequest>(async (req, res) => {
    const u = req.user!;
    const id = requireId(req.params.id);
    await loadOwnDraft(u, id);
    const subject = requireString(req.body?.subject, "عنوان الرسالة", 200);
    const body = requireString(req.body?.body, "نص الرسالة", 20000);
    const { rows, summary } = await resolveRecipients(u, req.body?.target);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE messages SET subject = $1, body = $2, requires_ack = $3, target_summary = $4 WHERE id = $5",
        [subject, body, req.body?.requiresAck === true && u.role !== "SCHOOL_PRINCIPAL" && u.role !== "SCHOOL_DEPUTY", summary, id]);
      await client.query("DELETE FROM message_recipients WHERE message_id = $1", [id]);
      for (const r of rows) {
        await client.query("INSERT INTO message_recipients (message_id, recipient_type, recipient_ref_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id, r.type, r.id]);
      }
      await saveAttachments(client, id, req.body?.attachments);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    res.json({ success: true, message: "تم حفظ المسودة" });
  })
);

router.post(
  "/:id/send",
  handle<AuthRequest>(async (req, res) => {
    const u = req.user!;
    if (u.role === "SCHOOL_PRINCIPAL" || u.role === "SCHOOL_DEPUTY") await assertCanActForSchool(u);
    const id = requireId(req.params.id);
    const m = await loadOwnDraft(u, id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await sendNow(client, u, id);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    void audit({ userId: u.id, action: "DATA_UPDATE", entityType: "message", entityId: id, details: { sent: true }, req });
    res.json({ success: true, message: `تم الإرسال إلى ${m.target_summary}` });
  })
);

router.delete(
  "/:id",
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    await loadOwnDraft(req.user!, id);
    await pool.query("DELETE FROM messages WHERE id = $1", [id]);
    res.json({ success: true, message: "تم حذف المسودة" });
  })
);

router.get(
  "/:id/attachments/:fileId",
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    await loadMessage(req.user!, id);
    const f = await pool.query("SELECT file_name, file_path, file_type FROM message_attachments WHERE id = $1 AND message_id = $2", [requireId(req.params.fileId), id]);
    if (!f.rowCount) throw new HttpError(404, "المرفق غير موجود");
    const full = path.resolve(UPLOAD_DIR, f.rows[0].file_path);
    if (!full.startsWith(UPLOAD_DIR + path.sep)) throw new HttpError(400, "مسار غير صالح");
    res.setHeader("Content-Type", f.rows[0].file_type);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(f.rows[0].file_name)}`);
    res.send(await fs.readFile(full));
  })
);

// Options for the compose form
router.get(
  "/meta/targets",
  handle<AuthRequest>(async (req, res) => {
    const u = req.user!;
    const directorates = u.role === "MINISTRY_ADMIN" ? (await pool.query("SELECT id, name FROM directorates ORDER BY name")).rows : [];
    const ids = await readableSchoolIds(u);
    const schools = u.role === "MINISTRY_ADMIN" || u.role === "DIRECTORATE_ADMIN"
      ? (await pool.query("SELECT id, name, directorate_id FROM schools WHERE is_active AND ($1::bigint[] IS NULL OR id = ANY($1)) ORDER BY name", [ids])).rows
      : [];
    res.json({ success: true, data: { directorates, schools } });
  })
);

export default router;
