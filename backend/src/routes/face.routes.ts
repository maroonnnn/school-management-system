import { Router } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import pool from "../config/database.js";
import { AuthRequest, authenticateToken, requireRole } from "../middleware/auth.middleware.js";
import { resolveReadableSchool } from "../services/scope.service.js";
import { audit } from "../services/audit.service.js";
import { encryptVector, findBestMatch, isChallenge, layoutFor, processFrames, randomChallenge } from "../services/face.service.js";
import { listReview, loadFrames, processOfflineCapture, resolveCapture, type IncomingCapture } from "../services/offlineAttendance.service.js";
import { HttpError, handle, requireId } from "../utils/http.js";

// FR-ATT-01..05, 22, 24 — enrollment by the principal, check-in kiosk at the school
const router = Router();
router.use(authenticateToken);

const KIOSK = requireRole("SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "SCHOOL_STAFF");

// ---------------------------------------------------------------- liveness challenge (FR-ATT-22)
// The server picks an ordered two-step head-turn sequence (e.g. RIGHT then LEFT) and signs it, so a client cannot
// choose or replay it. Online: valid 90 s. Offline pool: valid 72 h, each token backs ONE capture (checked at sync).
function signChallenge(req: AuthRequest, ttl: string) {
  const challenge = randomChallenge();
  const token = jwt.sign({ purpose: "face", challenge, uid: req.user!.id, schoolId: req.user!.schoolId, n: crypto.randomUUID() },
    process.env.JWT_SECRET!, { expiresIn: ttl as jwt.SignOptions["expiresIn"], algorithm: "HS256" });
  return { challenge, layout: layoutFor(challenge), token };
}

router.get(
  "/challenge",
  handle<AuthRequest>(async (req, res) => {
    res.json({ success: true, data: signChallenge(req, "90s") });
  })
);

// Offline pool for the kiosk: fetched while online, used while the internet is down
router.get(
  "/challenges",
  KIOSK,
  handle<AuthRequest>(async (req, res) => {
    const count = Math.min(Math.max(Number(req.query.count) || 100, 1), 200);
    res.json({ success: true, data: Array.from({ length: count }, () => signChallenge(req, "72h")) });
  })
);

function readChallenge(req: AuthRequest): string[] {
  try {
    const p = jwt.verify(String(req.body?.challengeToken ?? ""), process.env.JWT_SECRET!, { algorithms: ["HS256"] }) as { purpose: string; challenge: unknown; uid: number };
    if (p.purpose !== "face" || p.uid !== req.user!.id || !isChallenge(p.challenge)) throw new Error();
    return p.challenge;
  } catch {
    throw new HttpError(400, "انتهت صلاحية التحدي — أعد المحاولة");
  }
}

// ---------------------------------------------------------------- enrollment status per school
router.get(
  "/enrollments",
  requireRole("SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "DIRECTORATE_ADMIN"),
  handle<AuthRequest>(async (req, res) => {
    const schoolId = await resolveReadableSchool(req.user!, req.query.schoolId);
    const r = await pool.query(
      `SELECT ea.id AS assignment_id, e.id AS employee_id, e.full_name, e.employee_number, ea.position_type,
              to_char(fe.enrolled_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS enrolled_at,
              u.full_name AS enrolled_by_name
         FROM employee_assignments ea
         JOIN employees e ON e.id = ea.employee_id
         LEFT JOIN face_embeddings fe ON fe.employee_id = e.id
         LEFT JOIN users u ON u.id = fe.enrolled_by
        WHERE ea.school_id = $1 AND ea.is_active
        ORDER BY fe.employee_id IS NOT NULL, ea.position_type <> 'TEACHER', e.full_name`,
      [schoolId]
    );
    res.json({ success: true, data: r.rows });
  })
);

// ---------------------------------------------------------------- FR-ATT-01/02/24: enroll (principal only)
router.post(
  "/enroll",
  requireRole("SCHOOL_PRINCIPAL"),
  handle<AuthRequest>(async (req, res) => {
    const eaId = requireId(req.body?.employeeAssignmentId, "الموظف");
    const a = await pool.query("SELECT employee_id, school_id FROM employee_assignments WHERE id = $1 AND is_active", [eaId]);
    if (!a.rowCount || Number(a.rows[0].school_id) !== req.user!.schoolId) throw new HttpError(404, "الموظف لا يتبع لمدرستك");
    const challenge = readChallenge(req);
    const result = await processFrames(req.body?.frames, challenge);
    if (!result.ok || !result.embedding) {
      return res.status(422).json({ success: false, message: result.message ?? "تعذّر تسجيل الوجه", reason: result.reason });
    }
    const { ciphertext, iv, authTag } = encryptVector(result.embedding);
    await pool.query(
      `INSERT INTO face_embeddings (employee_id, ciphertext, iv, auth_tag, model, quality, enrolled_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (employee_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag,
         model = EXCLUDED.model, quality = EXCLUDED.quality, enrolled_by = EXCLUDED.enrolled_by, enrolled_at = now()`,
      [a.rows[0].employee_id, ciphertext, iv, authTag, result.model, JSON.stringify(result.quality), req.user!.id]
    );
    // NFR-06: the vector itself is never written to the audit log
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "face_enrollment", entityId: a.rows[0].employee_id, details: { quality: result.quality }, req });
    res.json({ success: true, message: "تم تسجيل الوجه بنجاح (لم تُحفظ أي صورة)", data: { quality: result.quality } });
  })
);

router.delete(
  "/enrollments/:employeeId",
  requireRole("SCHOOL_PRINCIPAL"),
  handle<AuthRequest>(async (req, res) => {
    const employeeId = requireId(req.params.employeeId);
    const r = await pool.query(
      `DELETE FROM face_embeddings fe WHERE fe.employee_id = $1
          AND EXISTS (SELECT 1 FROM employee_assignments ea WHERE ea.employee_id = fe.employee_id AND ea.school_id = $2 AND ea.is_active)`,
      [employeeId, req.user!.schoolId]
    );
    if (!r.rowCount) throw new HttpError(404, "لا يوجد تسجيل وجه لهذا الموظف");
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "face_enrollment", entityId: employeeId, details: { removed: true }, req });
    res.json({ success: true, message: "تم حذف تسجيل الوجه" });
  })
);

// ---------------------------------------------------------------- FR-ATT-03/04/05: check-in / check-out at the school device
router.post(
  "/check",
  KIOSK,
  handle<AuthRequest>(async (req, res) => {
    const schoolId = req.user!.schoolId!;
    const challenge = readChallenge(req);
    const result = await processFrames(req.body?.frames, challenge);
    if (!result.ok || !result.embedding) {
      return res.status(422).json({ success: false, message: result.message ?? "تعذّر التعرّف", reason: result.reason });
    }
    const { best, candidates, threshold } = await findBestMatch(schoolId, result.embedding);
    if (!best || best.score < threshold) {
      void audit({ userId: req.user!.id, action: "ACCESS_DENIED", entityType: "face_check", entityId: schoolId,
        details: { reason: "NO_MATCH", bestScore: best ? Number(best.score.toFixed(3)) : null, candidates }, req });
      return res.status(422).json({ success: false, reason: "NO_MATCH", message: "لم يتم التعرّف على الوجه — راجع إدارة المدرسة للإدخال اليدوي" });
    }

    // IN or OUT: opposite of the person's last accepted event today (first scan of the day = IN)
    const last = await pool.query(
      `SELECT event_type FROM attendance_events
        WHERE employee_assignment_id = $1 AND verification_status = 'ACCEPTED'
          AND (event_time AT TIME ZONE 'Asia/Damascus')::date = (now() AT TIME ZONE 'Asia/Damascus')::date
        ORDER BY event_time DESC LIMIT 1`,
      [best.row.assignment_id]
    );
    const eventType = last.rows[0]?.event_type === "IN" ? "OUT" : "IN";
    const ins = await pool.query(
      `INSERT INTO attendance_events (employee_assignment_id, event_type, event_time, verification_method, match_score, verification_status, device_label)
       VALUES ($1, $2, now(), 'FACE', $3, 'ACCEPTED', $4) RETURNING to_char(event_time AT TIME ZONE 'Asia/Damascus', 'HH24:MI') AS at`,
      [best.row.assignment_id, eventType, Number(best.score.toFixed(4)), `kiosk:user${req.user!.id}`]
    );
    const duplicate = ins.rowCount === 0;
    res.json({
      success: true,
      message: duplicate ? "تم تسجيل حركتك قبل لحظات" : eventType === "IN" ? "تم تسجيل الدخول" : "تم تسجيل الخروج",
      data: {
        fullName: best.row.full_name,
        employeeNumber: best.row.employee_number,
        positionType: best.row.position_type,
        eventType,
        at: ins.rows[0]?.at ?? null,
        score: Number(best.score.toFixed(3)),
        duplicate,
      },
    });
  })
);

// ---------------------------------------------------------------- offline attendance: sync + review queue (ATT-21)
// The kiosk sends the captures it stored while the internet was down (max 5 per call, oldest first).
router.post(
  "/sync",
  KIOSK,
  handle<AuthRequest>(async (req, res) => {
    const list = req.body?.captures as IncomingCapture[] | undefined;
    const deviceNow = Date.parse(String(req.body?.deviceNow ?? ""));
    if (!Array.isArray(list) || list.length < 1 || list.length > 5) throw new HttpError(400, "أرسل من 1 إلى 5 لقطات في الطلب الواحد");
    if (Number.isNaN(deviceNow)) throw new HttpError(400, "وقت الجهاز غير صالح");
    const skewSeconds = Math.round((Date.now() - deviceNow) / 1000); // server time − device time (clock drift)
    const sorted = [...list].sort((a, b) => Date.parse(a?.capturedAt) - Date.parse(b?.capturedAt));
    const results = [];
    for (const c of sorted) results.push(await processOfflineCapture(req.user!, c, skewSeconds));
    const accepted = results.filter((r) => r.status === "ACCEPTED").length;
    void audit({ userId: req.user!.id, action: "DATA_CREATE", entityType: "offline_sync", entityId: req.user!.schoolId!,
      details: { received: results.length, accepted, needsReview: results.filter((r) => r.status === "NEEDS_REVIEW").length, skewSeconds }, req });
    res.json({ success: true, data: { skewSeconds, results } });
  })
);

const PRINCIPAL = requireRole("SCHOOL_PRINCIPAL");

router.get(
  "/offline/review",
  PRINCIPAL,
  handle<AuthRequest>(async (req, res) => {
    res.json({ success: true, data: await listReview(req.user!.schoolId!) });
  })
);

router.get(
  "/offline/:id/preview",
  PRINCIPAL,
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    const frames = await loadFrames(req.user!.schoolId!, id);
    void audit({ userId: req.user!.id, action: "FACE_CAPTURE_VIEW", entityType: "offline_capture", entityId: id, req });
    // the first frame is the frontal one (the person looking at the camera)
    res.json({ success: true, data: { image: frames[0] } });
  })
);

router.post(
  "/offline/:id/resolve",
  PRINCIPAL,
  handle<AuthRequest>(async (req, res) => {
    const id = requireId(req.params.id);
    const out = await resolveCapture(req.user!, id, req.body ?? {});
    void audit({ userId: req.user!.id, action: "DATA_UPDATE", entityType: "offline_capture", entityId: id, details: { decision: out.status }, req });
    res.json({ success: true, message: out.status === "RESOLVED" ? "تم اعتماد الحركة وتسجيلها" : "تم رفض اللقطة وحذفها", data: out });
  })
);

export default router;
