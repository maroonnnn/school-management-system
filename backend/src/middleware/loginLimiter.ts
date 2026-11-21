import type { NextFunction, Request, Response } from "express";
import { audit } from "../services/audit.service.js";

// Brute-force protection for /auth/login (NFR-04/05). In-memory, per username + IP — enough for one API instance.
// 5 failed attempts within 15 minutes lock that username+IP pair for 15 minutes; a success clears the counter.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;

interface Entry { failures: number; first: number; lockedUntil: number }
const attempts = new Map<string, Entry>();

const keyOf = (req: Request) => `${String(req.body?.username ?? "").trim().toLowerCase().slice(0, 100)}|${req.ip}`;

export function loginLimiter(req: Request, res: Response, next: NextFunction) {
  const e = attempts.get(keyOf(req));
  const now = Date.now();
  if (e && e.lockedUntil > now) {
    const minutes = Math.ceil((e.lockedUntil - now) / 60_000);
    res.setHeader("Retry-After", String(Math.ceil((e.lockedUntil - now) / 1000)));
    return res.status(429).json({ success: false, message: `محاولات كثيرة خاطئة. حاول بعد ${minutes} دقيقة.` });
  }
  next();
}

export function recordLoginFailure(req: Request) {
  const k = keyOf(req);
  const now = Date.now();
  let e = attempts.get(k);
  if (!e || now - e.first > WINDOW_MS) e = { failures: 0, first: now, lockedUntil: 0 };
  e.failures++;
  if (e.failures >= MAX_FAILURES) {
    e.lockedUntil = now + WINDOW_MS;
    void audit({ userId: null, action: "ACCESS_DENIED", entityType: "login_lockout", details: { username: String(req.body?.username ?? "").slice(0, 100) }, req });
  }
  attempts.set(k, e);
  if (attempts.size > 5000) for (const [key, v] of attempts) if (now - v.first > WINDOW_MS && v.lockedUntil < now) attempts.delete(key);
}

export function recordLoginSuccess(req: Request) {
  attempts.delete(keyOf(req));
}

/** Test helper. */
export function resetLoginLimiter() {
  attempts.clear();
}
