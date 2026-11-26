import jwt from "jsonwebtoken";
import pool from "../config/database.js";
import type { AuthenticatedUser } from "../middleware/auth.middleware.js";
import { HttpError } from "../utils/http.js";
import { decryptBlob, encryptBlob, findBestMatch, isChallenge, processFrames } from "./face.service.js";

// Offline attendance (ATT-21, decision 2026-11-26). The kiosk stores encrypted captures while the internet is down and
// sends them later. Here every capture is verified exactly like an online one (liveness sequence + face match) and
// becomes a normal attendance event with its ORIGINAL time. Anything doubtful waits in a review queue for the principal.

const MAX_SKEW_SECONDS = 10 * 60;          // device clock more than 10 minutes off → needs review
const WINDOW_TOLERANCE_MS = 5 * 60_000;    // capture time vs the signed challenge's validity window
const MAX_AGE_MS = 7 * 24 * 3600_000;      // captures older than a week are not auto-accepted
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface IncomingCapture { clientEventId: string; capturedAt: string; challengeToken: string; frames: string[] }
export interface CaptureOutcome {
  clientEventId: string;
  status: "ACCEPTED" | "NEEDS_REVIEW" | "REJECTED";
  reason?: string;
  duplicate?: boolean;
  eventType?: "IN" | "OUT";
  fullName?: string;
  at?: string;
}

interface ChallengeClaims { purpose: string; challenge: unknown; schoolId?: number; n: string; iat: number; exp: number }

/** Verifies the signature but not the expiry: the capture time (not the sync time) must fall inside the challenge window. */
function readSignedChallenge(token: string, schoolId: number): ChallengeClaims | null {
  try {
    const c = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ["HS256"], ignoreExpiration: true }) as ChallengeClaims;
    if (c.purpose !== "face" || !isChallenge(c.challenge) || typeof c.n !== "string" || Number(c.schoolId) !== schoolId) return null;
    return c;
  } catch {
    return null;
  }
}

/** IN/OUT = opposite of the person's last accepted event BEFORE the capture time on that day (first of the day = IN). */
async function eventTypeAt(assignmentId: number, when: Date): Promise<"IN" | "OUT"> {
  const r = await pool.query(
    `SELECT event_type FROM attendance_events
      WHERE employee_assignment_id = $1 AND verification_status = 'ACCEPTED' AND event_time <= $2
        AND (event_time AT TIME ZONE 'Asia/Damascus')::date = ($2::timestamptz AT TIME ZONE 'Asia/Damascus')::date
      ORDER BY event_time DESC LIMIT 1`,
    [assignmentId, when]
  );
  return r.rows[0]?.event_type === "IN" ? "OUT" : "IN";
}

async function expireOld(schoolId: number) {
  await pool.query(
    `UPDATE offline_captures SET status = 'EXPIRED', frames_enc = NULL, frames_iv = NULL, frames_tag = NULL, resolved_at = now()
      WHERE school_id = $1 AND status = 'NEEDS_REVIEW' AND received_at < now() - interval '7 days'`,
    [schoolId]
  );
}

export async function processOfflineCapture(user: AuthenticatedUser, c: IncomingCapture, skewSeconds: number): Promise<CaptureOutcome> {
  const schoolId = user.schoolId!;
  const id = c.clientEventId;
  if (!UUID.test(id) || typeof c.challengeToken !== "string" || !Array.isArray(c.frames)) {
    return { clientEventId: String(id), status: "REJECTED", reason: "BAD_REQUEST" };
  }
  // idempotent: a capture that was already received is never processed twice
  const existing = await pool.query("SELECT status, reason, school_id FROM offline_captures WHERE client_event_id = $1", [id]);
  if (existing.rowCount) {
    if (Number(existing.rows[0].school_id) !== schoolId) return { clientEventId: id, status: "REJECTED", reason: "BAD_REQUEST" };
    return { clientEventId: id, status: existing.rows[0].status === "ACCEPTED" ? "ACCEPTED" : existing.rows[0].status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "REJECTED", reason: existing.rows[0].reason ?? undefined, duplicate: true };
  }

  const claims = readSignedChallenge(c.challengeToken, schoolId);
  if (!claims) return { clientEventId: id, status: "REJECTED", reason: "BAD_CHALLENGE" };
  const steps = claims.challenge as string[];
  const deviceMs = Date.parse(c.capturedAt);
  if (Number.isNaN(deviceMs)) return { clientEventId: id, status: "REJECTED", reason: "BAD_REQUEST" };
  const correctedMs = deviceMs + skewSeconds * 1000;
  const corrected = new Date(correctedMs);

  // a signed challenge can back ONE capture only (replay protection)
  const used = await pool.query("SELECT 1 FROM offline_captures WHERE challenge_nonce = $1", [claims.n]);
  if (used.rowCount) return { clientEventId: id, status: "REJECTED", reason: "CHALLENGE_REUSED" };

  const flags: string[] = [];
  if (Math.abs(skewSeconds) > MAX_SKEW_SECONDS) flags.push("CLOCK_DRIFT");
  if (correctedMs < claims.iat * 1000 - WINDOW_TOLERANCE_MS || correctedMs > claims.exp * 1000 + WINDOW_TOLERANCE_MS) flags.push("CHALLENGE_WINDOW");
  if (correctedMs > Date.now() + WINDOW_TOLERANCE_MS) flags.push("FUTURE_TIME");
  if (Date.now() - correctedMs > MAX_AGE_MS) flags.push("TOO_OLD");

  const result = await processFrames(c.frames, steps); // throws 503 if the face service is down → nothing stored, the kiosk retries
  let reason: string | null = flags[0] ?? null;
  let bestScore: number | null = null;
  let match: Awaited<ReturnType<typeof findBestMatch>>["best"] = null;
  if (!result.ok || !result.embedding) {
    reason = result.reason ?? "FACE_FAILED";
  } else {
    const m = await findBestMatch(schoolId, result.embedding);
    bestScore = m.best ? Number(m.best.score.toFixed(4)) : null;
    if (m.best && m.best.score >= m.threshold) match = m.best;
    else reason = reason ?? "NO_MATCH";
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (match && flags.length === 0) {
      const assignmentId = Number(match.row.assignment_id);
      const eventType = await eventTypeAt(assignmentId, corrected);
      const ev = await client.query(
        `INSERT INTO attendance_events (employee_assignment_id, event_type, event_time, verification_method, match_score, verification_status, client_event_id, device_label)
         VALUES ($1, $2, $3, 'FACE', $4, 'ACCEPTED', $5, $6) RETURNING id`,
        [assignmentId, eventType, corrected, bestScore, id, `kiosk-offline:user${user.id}`]
      );
      await client.query(
        `INSERT INTO offline_captures (school_id, kiosk_user_id, client_event_id, challenge_nonce, challenge, captured_at, device_captured_at, clock_skew_seconds,
                                       status, reason, best_score, matched_assignment_id, event_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACCEPTED', $9, $10, $11, $12)`,
        [schoolId, user.id, id, claims.n, JSON.stringify(steps), corrected, new Date(deviceMs), skewSeconds,
          ev.rowCount ? null : "DUPLICATE_EVENT", bestScore, assignmentId, ev.rows[0]?.id ?? null]
      );
      await client.query("COMMIT");
      return { clientEventId: id, status: "ACCEPTED", eventType, fullName: match.row.full_name, at: corrected.toISOString(), reason: ev.rowCount ? undefined : "DUPLICATE_EVENT" };
    }
    // doubtful → keep the encrypted frames for the principal
    const enc = encryptBlob(Buffer.from(JSON.stringify(c.frames)));
    await client.query(
      `INSERT INTO offline_captures (school_id, kiosk_user_id, client_event_id, challenge_nonce, challenge, captured_at, device_captured_at, clock_skew_seconds,
                                     status, reason, best_score, matched_assignment_id, frames_enc, frames_iv, frames_tag)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NEEDS_REVIEW', $9, $10, $11, $12, $13, $14)`,
      [schoolId, user.id, id, claims.n, JSON.stringify(steps), corrected, new Date(deviceMs), skewSeconds,
        reason ?? "REVIEW", bestScore, match ? Number(match.row.assignment_id) : null, enc.data, enc.iv, enc.tag]
    );
    await client.query("COMMIT");
    return { clientEventId: id, status: "NEEDS_REVIEW", reason: reason ?? "REVIEW" };
  } catch (e) {
    await client.query("ROLLBACK");
    if ((e as { code?: string }).code === "23505") return { clientEventId: id, status: "NEEDS_REVIEW", duplicate: true }; // concurrent duplicate
    throw e;
  } finally {
    client.release();
  }
}

export async function listReview(schoolId: number) {
  await expireOld(schoolId);
  const r = await pool.query(
    `SELECT oc.id, oc.reason, oc.best_score::float AS best_score, oc.clock_skew_seconds,
            to_char(oc.captured_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS captured_at,
            to_char(oc.received_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS received_at,
            oc.matched_assignment_id, e.full_name AS suggested_name, e.employee_number AS suggested_number
       FROM offline_captures oc
       LEFT JOIN employee_assignments ea ON ea.id = oc.matched_assignment_id
       LEFT JOIN employees e ON e.id = ea.employee_id
      WHERE oc.school_id = $1 AND oc.status = 'NEEDS_REVIEW'
      ORDER BY oc.captured_at`,
    [schoolId]
  );
  return r.rows;
}

export async function loadFrames(schoolId: number, id: number): Promise<string[]> {
  const r = await pool.query(
    "SELECT frames_enc, frames_iv, frames_tag FROM offline_captures WHERE id = $1 AND school_id = $2 AND status = 'NEEDS_REVIEW'",
    [id, schoolId]
  );
  if (!r.rowCount || !r.rows[0].frames_enc) throw new HttpError(404, "اللقطة غير موجودة أو تمت معالجتها");
  return JSON.parse(decryptBlob(r.rows[0].frames_enc, r.rows[0].frames_iv, r.rows[0].frames_tag).toString("utf8")) as string[];
}

/** Principal decision on a doubtful capture: attach it to an employee (recorded as a manual event with the reason) or reject it. */
export async function resolveCapture(user: AuthenticatedUser, id: number, body: { action?: string; employeeAssignmentId?: number; reason?: string }) {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) throw new HttpError(400, "سبب القرار مطلوب");
  const cap = await pool.query("SELECT id, client_event_id, captured_at FROM offline_captures WHERE id = $1 AND school_id = $2 AND status = 'NEEDS_REVIEW'", [id, user.schoolId]);
  if (!cap.rowCount) throw new HttpError(404, "اللقطة غير موجودة أو تمت معالجتها");
  if (body.action === "REJECT") {
    await pool.query(
      `UPDATE offline_captures SET status = 'REJECTED', reason = COALESCE(reason, 'REJECTED_BY_PRINCIPAL'), frames_enc = NULL, frames_iv = NULL, frames_tag = NULL,
              resolved_by = $2, resolved_at = now() WHERE id = $1`,
      [id, user.id]
    );
    return { status: "REJECTED" };
  }
  if (body.action !== "ACCEPT") throw new HttpError(400, "إجراء غير معروف");
  const ea = await pool.query("SELECT id FROM employee_assignments WHERE id = $1 AND school_id = $2 AND is_active", [body.employeeAssignmentId, user.schoolId]);
  if (!ea.rowCount) throw new HttpError(400, "الموظف غير تابع لمدرستك");
  const when = new Date(cap.rows[0].captured_at);
  const eventType = await eventTypeAt(Number(ea.rows[0].id), when);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ev = await client.query(
      `INSERT INTO attendance_events (employee_assignment_id, event_type, event_time, verification_method, recorded_by, manual_reason, verification_status, client_event_id, device_label)
       VALUES ($1, $2, $3, 'MANUAL', $4, $5, 'ACCEPTED', $6, 'offline-review') RETURNING id`,
      [ea.rows[0].id, eventType, when, user.id, `اعتماد لقطة دون اتصال: ${reason}`, cap.rows[0].client_event_id]
    );
    await client.query(
      `UPDATE offline_captures SET status = 'RESOLVED', matched_assignment_id = $2, event_id = $3, frames_enc = NULL, frames_iv = NULL, frames_tag = NULL,
              resolved_by = $4, resolved_at = now() WHERE id = $1`,
      [id, ea.rows[0].id, ev.rows[0]?.id ?? null, user.id]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { status: "RESOLVED", eventType };
}
