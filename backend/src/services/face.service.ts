import crypto from "node:crypto";
import pool from "../config/database.js";
import { HttpError } from "../utils/http.js";

/**
 * Face vectors (FR-ATT-02, NFR-06): stored only as AES-256-GCM ciphertext; the key lives in env (FACE_KEY),
 * never in the DB. Vectors are never written to the audit log or returned to the browser.
 */
function key(): Buffer {
  const hex = process.env.FACE_KEY ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new HttpError(500, "مفتاح تشفير الوجوه غير مضبوط (FACE_KEY)");
  return Buffer.from(hex, "hex");
}

export function encryptVector(v: number[]) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const plain = Buffer.from(new Float32Array(v).buffer);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decryptVector(ciphertext: Buffer, iv: Buffer, authTag: Buffer): Float32Array {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return new Float32Array(plain.buffer, plain.byteOffset, plain.byteLength / 4);
}

/** Cosine similarity of two L2-normalised vectors. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

export interface FaceResult {
  ok: boolean;
  reason?: string;
  message?: string;
  embedding?: number[];
  quality?: Record<string, number>;
  liveness?: Record<string, unknown>;
  model?: string;
}

/** Sends camera frames to the local Python service (it keeps nothing). */
export async function processFrames(frames: unknown, challenge: string): Promise<FaceResult> {
  if (!Array.isArray(frames) || frames.length < 3 || frames.length > 12 || frames.some((f) => typeof f !== "string" || f.length > 600_000)) {
    throw new HttpError(400, "يجب إرسال من 3 إلى 12 لقطة من الكاميرا");
  }
  const url = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:8001";
  let res: Response;
  try {
    res = await fetch(`${url}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frames, challenge }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HttpError(503, "خدمة التعرّف على الوجه غير متاحة حالياً — استخدم الإدخال اليدوي");
  }
  if (!res.ok) throw new HttpError(502, "خطأ في خدمة التعرّف على الوجه");
  return (await res.json()) as FaceResult;
}

export async function matchThreshold(): Promise<number> {
  const r = await pool.query("SELECT value FROM settings WHERE key = 'face_match_threshold'");
  return Number(r.rows[0]?.value ?? 0.42);
}

/**
 * FR-ATT-04/05: compare a probe only with staff enrolled in the SAME school; accept the best match
 * if it reaches the single configurable threshold.
 */
export async function findBestMatch(schoolId: number, probe: number[]) {
  const r = await pool.query(
    `SELECT fe.employee_id, fe.ciphertext, fe.iv, fe.auth_tag, ea.id AS assignment_id, ea.position_type,
            e.full_name, e.employee_number
       FROM face_embeddings fe
       JOIN employee_assignments ea ON ea.employee_id = fe.employee_id AND ea.is_active AND ea.school_id = $1
       JOIN employees e ON e.id = fe.employee_id`,
    [schoolId]
  );
  let best: { score: number; row: (typeof r.rows)[number] } | null = null;
  for (const row of r.rows) {
    const v = decryptVector(row.ciphertext, row.iv, row.auth_tag);
    const score = cosine(probe, v);
    if (!best || score > best.score) best = { score, row };
  }
  return { best, candidates: r.rowCount ?? 0, threshold: await matchThreshold() };
}
