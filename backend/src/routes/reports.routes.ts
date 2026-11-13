import { Router } from "express";
import { authenticateToken, requireRole } from "../middleware/auth.middleware.js";
import {
  getMonthlyReport,
  getMonthlyDetailedReportController,
} from "../controllers/reports.controller.js";

const router = Router();

// Individual teacher reports: ministry is excluded (aggregates only — FR-AUTH-09)
const canViewTeacherReports = requireRole(
  "DIRECTORATE_ADMIN",
  "SCHOOL_PRINCIPAL",
  "SCHOOL_DEPUTY",
  "TEACHER"
);

router.use(authenticateToken);
router.get("/monthly", canViewTeacherReports, getMonthlyReport);
router.get("/monthly/detailed", canViewTeacherReports, getMonthlyDetailedReportController);

export default router;
