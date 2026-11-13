
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { audit } from "../services/audit.service.js";

export type Role =
  | "MINISTRY_ADMIN"
  | "DIRECTORATE_ADMIN"
  | "SCHOOL_PRINCIPAL"
  | "SCHOOL_DEPUTY"
  | "SCHOOL_STAFF"
  | "TEACHER";

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

export function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "يجب تسجيل الدخول أولاً",
    });
  }

  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return res.status(500).json({
      success: false,
      message: "إعدادات المصادقة غير مكتملة",
    });
  }

  try {
    const decoded = jwt.verify(token, secret) as AuthenticatedUser;

    req.user = decoded;

    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "رمز الدخول غير صالح أو منتهي الصلاحية",
    });
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
