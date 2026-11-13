
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthenticatedUser {
  id: number;
  role: string;
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
