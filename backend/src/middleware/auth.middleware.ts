
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import pool from "../config/database.js";
import { audit } from "../services/audit.service.js";

export type Role =
  | "MINISTRY_ADMIN"
  | "DIRECTORATE_ADMIN"
  | "SCHOOL_PRINCIPAL"
  | "SCHOOL_DEPUTY"
  | "SCHOOL_STAFF"
  | "TEACHER"
  | "SUPERVISOR";

export interface AuthenticatedUser {
  id: number;
  role: Role;
  employeeId: number | null;
  schoolId: number | null;
  directorateId: number | null;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

/** Server-side idle timeout (FR-AUTH-02): a token lives 30 minutes and is re-issued (sliding) while the user is active. */
export const SESSION_MINUTES = 30;
const REFRESH_AFTER_SECONDS = 5 * 60;

export function signSession(u: AuthenticatedUser, secret: string): string {
  return jwt.sign(
    { id: u.id, role: u.role, employeeId: u.employeeId, schoolId: u.schoolId, directorateId: u.directorateId },
    secret,
    { expiresIn: `${SESSION_MINUTES}m`, algorithm: "HS256" }
  );
}

export async function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
  if (!token) {
    return res.status(401).json({ success: false, message: "يجب تسجيل الدخول أولاً" });
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ success: false, message: "إعدادات المصادقة غير مكتملة" });
  }
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as AuthenticatedUser & { purpose?: string; iat?: number };
    // Other signed tokens (e.g. the face-challenge token) must never act as a login token
    if (decoded.purpose || !decoded.role || !Number.isInteger(decoded.id)) throw new Error("not a session token");

    // A deactivated account loses access immediately, not when its token expires
    const active = await pool.query("SELECT is_active FROM users WHERE id = $1", [decoded.id]);
    if (!active.rowCount || !active.rows[0].is_active) throw new Error("inactive");

    req.user = { id: decoded.id, role: decoded.role, employeeId: decoded.employeeId, schoolId: decoded.schoolId, directorateId: decoded.directorateId };
    if (Math.floor(Date.now() / 1000) - (decoded.iat ?? 0) > REFRESH_AFTER_SECONDS) {
      res.setHeader("X-Refreshed-Token", signSession(req.user, secret));
    }
    next();
  } catch {
    return res.status(401).json({ success: false, message: "رمز الدخول غير صالح أو منتهي الصلاحية" });
  }
}

/** Use after authenticateToken. Rejects (403) and audits any role not in the list (FR-AUTH-06). */
export function requireRole(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user && roles.includes(req.user.role)) return next();
    void audit({
      userId: req.user?.id ?? null,
      action: "ACCESS_DENIED",
      entityType: "route",
      entityId: `${req.method} ${req.originalUrl}`.slice(0, 100),
      details: { role: req.user?.role },
      req,
    });
    return res.status(403).json({
      success: false,
      message: "ليس لديك صلاحية لتنفيذ هذا الإجراء",
    });
  };
}
