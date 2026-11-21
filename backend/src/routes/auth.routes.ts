
import { audit } from "../services/audit.service.js";
import { Router, Request, Response } from "express";
import { loginUser } from "../services/auth.service.js";
import { loginLimiter, recordLoginFailure, recordLoginSuccess } from "../middleware/loginLimiter.js";
import {
  authenticateToken,
  AuthRequest,
} from "../middleware/auth.middleware.js";

const router = Router();

// Login
router.post("/login", loginLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      !username.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "يرجى إدخال اسم المستخدم وكلمة المرور",
      });
    }

    const result = await loginUser(username.trim(), password);
    recordLoginSuccess(req);
    void audit({ userId: result.user.id, action: "LOGIN", req });

    return res.status(200).json({
      success: true,
      message: "تم تسجيل الدخول بنجاح",
      data: result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "حدث خطأ أثناء تسجيل الدخول";

    const status = message.includes("غير صحيحة") ? 401 : 500;
    if (status === 401) {
      recordLoginFailure(req);
      void audit({
        userId: null,
        action: "LOGIN_FAILED",
        details: { username: String(req.body?.username ?? "").slice(0, 100) },
        req,
      });
    }

    return res.status(status).json({
      success: false,
      message,
    });
  }
});

// Get current authenticated user
router.get(
  "/me",
  authenticateToken,
  (req: AuthRequest, res: Response) => {
    return res.status(200).json({
      success: true,
      message: "تم التحقق من هوية المستخدم",
      data: req.user,
    });
  }
);

export default router;
