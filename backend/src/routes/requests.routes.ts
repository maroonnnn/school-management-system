
import { Router, Response } from "express";
import {
  AuthRequest,
  authenticateToken,
  requireRole,
} from "../middleware/auth.middleware.js";
import { audit } from "../services/audit.service.js";
import {
  createDraftRequest,
    submitDraftRequest,
     getDirectorateRequests,    
    transitionDirectorateRequest,

  RequestType,
  DirectorateRequestStatus,
} from "../services/requests.service.js";

const router = Router();

// Create a school request draft
router.post(
  "/",
  authenticateToken,
  requireRole("SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { requestType, title, description } = req.body;

      if (
        typeof requestType !== "string" ||
        typeof title !== "string" ||
        typeof description !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "يرجى إدخال نوع الطلب والعنوان والوصف",
        });
      }

      const request = await createDraftRequest(
        req.user!.id,
        requestType as RequestType,
        title,
        description
      );

      return res.status(201).json({
        success: true,
        message: "تم إنشاء مسودة الطلب بنجاح",
        data: request,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "حدث خطأ أثناء إنشاء الطلب";

      const status =
        message.includes("صلاحية") ||
        message.includes("مخوّل") ||
        message.includes("غير نشط")
          ? 403
          : 400;

      return res.status(status).json({
        success: false,
        message,
      });
    }
  }
);
// Submit a school request
router.post(
  "/:id/submit",
  authenticateToken,
  requireRole("SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY"),
  async (req: AuthRequest, res: Response) => {
    try {
      const requestId = Number(req.params.id);

      if (!Number.isInteger(requestId) || requestId <= 0) {
        return res.status(400).json({
          success: false,
          message: "رقم الطلب غير صالح",
        });
      }

      const request = await submitDraftRequest(
        req.user!.id,
        requestId
      );

      return res.status(200).json({
        success: true,
        message: "تم تقديم الطلب إلى مديرية التربية بنجاح",
        data: request,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "حدث خطأ أثناء تقديم الطلب";

      const status =
        message.includes("صلاحية") ||
        message.includes("مخوّل") ||
        message.includes("غير نشط")
          ? 403
          : message.includes("غير موجود")
            ? 404
            : 400;

      return res.status(status).json({
        success: false,
        message,
      });
    }
  }
);
// Get requests belonging to the logged-in directorate
router.get(
  "/directorate",
  authenticateToken,
  requireRole("DIRECTORATE_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const requests = await getDirectorateRequests(req.user!.id);

      return res.status(200).json({
        success: true,
        message: "تم جلب طلبات المديرية بنجاح",
        data: requests,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "حدث خطأ أثناء جلب طلبات المديرية";

      const status =
        message.includes("صلاحية")
          ? 403
          : message.includes("غير نشط") ||
              message.includes("غير مرتبط")
            ? 403
            : 400;

      return res.status(status).json({
        success: false,
        message,
      });
    }
  }
);

async function handleDirectorateTransition(
  req: AuthRequest,
  res: Response,
  newStatus: DirectorateRequestStatus
) {
  try {
    const requestId = Number(req.params.id);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({
        success: false,
        message: "رقم الطلب غير صالح",
      });
    }

    const rejectionReason = req.body?.reason;

    if (
      newStatus === "REJECTED" &&
      (typeof rejectionReason !== "string" || !rejectionReason.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "يرجى كتابة سبب الرفض",
      });
    }

    const request = await transitionDirectorateRequest(
      req.user!.id,
      requestId,
      newStatus,
      rejectionReason
    );
    void audit({
      userId: req.user!.id,
      action: "REQUEST_STATUS_CHANGE",
      entityType: "school_request",
      entityId: requestId,
      details: { newStatus, reason: rejectionReason ?? null },
      req,
    });

    const messages: Record<DirectorateRequestStatus, string> = {
      UNDER_REVIEW: "تم تحويل الطلب إلى قيد المراجعة",
      APPROVED: "تمت الموافقة على الطلب",
      REJECTED: "تم رفض الطلب",
    };

    return res.status(200).json({
      success: true,
      message: messages[newStatus],
      data: request,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "حدث خطأ أثناء تحديث الطلب";

    const status =
      message.includes("صلاحية") ||
      message.includes("غير نشط") ||
      message.includes("غير مرتبط")
        ? 403
        : message.includes("غير موجود")
          ? 404
          : message.includes("حالة الطلب")
            ? 409
            : 400;

    return res.status(status).json({
      success: false,
      message,
    });
  }
}

router.post(
  "/:id/review",
  authenticateToken,
  requireRole("DIRECTORATE_ADMIN"),
  (req: AuthRequest, res: Response) =>
    handleDirectorateTransition(req, res, "UNDER_REVIEW")
);

router.post(
  "/:id/approve",
  authenticateToken,
  requireRole("DIRECTORATE_ADMIN"),
  (req: AuthRequest, res: Response) =>
    handleDirectorateTransition(req, res, "APPROVED")
);

router.post(
  "/:id/reject",
  authenticateToken,
  requireRole("DIRECTORATE_ADMIN"),
  (req: AuthRequest, res: Response) =>
    handleDirectorateTransition(req, res, "REJECTED")
);

export default router;
