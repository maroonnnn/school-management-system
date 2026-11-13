import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import {
  getMonthlyAttendanceReport,
  getMonthlyDetailedReport,
} from "../services/reports.service.js";
import { assertCanViewEmployee, ScopeError } from "../services/scope.service.js";
import { audit } from "../services/audit.service.js";

/** Validates query, enforces scope (FR-AUTH-04, FR-RPT-09) and audits the view (FR-AUTH-08). */
async function resolveReportQuery(req: AuthRequest, res: Response, reportType: string) {
  const { employeeNumber, month } = req.query;

  if (typeof employeeNumber !== "string" || typeof month !== "string" || !employeeNumber.trim()) {
    res.status(400).json({ success: false, message: "يجب إرسال الرقم الوظيفي والشهر" });
    return null;
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    res.status(400).json({ success: false, message: "صيغة الشهر غير صحيحة. استخدم YYYY-MM" });
    return null;
  }

  try {
    const emp = await assertCanViewEmployee(req.user!, employeeNumber.trim());
    void audit({
      userId: req.user!.id,
      action: "VIEW_TEACHER_REPORT",
      entityType: "employee",
      entityId: emp.employee_id,
      details: { reportType, month },
      req,
    });
  } catch (error) {
    if (error instanceof ScopeError) {
      if (error.status === 403) {
        void audit({
          userId: req.user!.id,
          action: "ACCESS_DENIED",
          entityType: "employee",
          entityId: employeeNumber,
          details: { reportType, month },
          req,
        });
      }
      res.status(error.status).json({ success: false, message: error.message });
      return null;
    }
    throw error;
  }

  return { employeeNumber: employeeNumber.trim(), month };
}

export async function getMonthlyReport(req: AuthRequest, res: Response) {
  try {
    const q = await resolveReportQuery(req, res, "monthly");
    if (!q) return;
    const report = await getMonthlyAttendanceReport(q.employeeNumber, q.month);
    return res.status(200).json({ success: true, data: report });
  } catch (error) {
    console.error("Monthly report error:", error);
    return res.status(500).json({ success: false, message: "حدث خطأ أثناء إنشاء التقرير الشهري" });
  }
}

export async function getMonthlyDetailedReportController(req: AuthRequest, res: Response) {
  try {
    const q = await resolveReportQuery(req, res, "monthly_detailed");
    if (!q) return;
    const report = await getMonthlyDetailedReport(q.employeeNumber, q.month);
    return res.status(200).json({ success: true, count: report.length, data: report });
  } catch (error) {
    console.error("Monthly detailed report error:", error);
    return res.status(500).json({ success: false, message: "حدث خطأ أثناء إنشاء التقرير التفصيلي" });
  }
}
