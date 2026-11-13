
import type { Request, Response } from "express";
import { getMonthlyAttendanceReport } from "../services/reports.service.js";
import { getMonthlyDetailedReport } from "../services/reports.service.js";

export async function getMonthlyReport(
  req: Request,
  res: Response
) {
  try {
    const employeeNumber = req.query.employeeNumber;
    const month = req.query.month;

    if (
      typeof employeeNumber !== "string" ||
      typeof month !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "يجب إرسال رقم المدرس والشهر",
      });
    }

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: "صيغة الشهر غير صحيحة. استخدم YYYY-MM",
      });
    }

    const report = await getMonthlyAttendanceReport(
      employeeNumber,
      month
    );

    return res.status(200).json({
      success: true,
      data: report,
    });

  } catch (error) {
    console.error("Monthly report error:", error);

    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إنشاء التقرير الشهري",
    });
  }
}

export async function getMonthlyDetailedReportController(
  req: Request,
  res: Response
) {
  try {
    const employeeNumber = req.query.employeeNumber;
    const month = req.query.month;

    if (
      typeof employeeNumber !== "string" ||
      typeof month !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "يجب إرسال الرقم الوظيفي والشهر",
      });
    }

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: "صيغة الشهر غير صحيحة. استخدم YYYY-MM",
      });
    }

    const report = await getMonthlyDetailedReport(
      employeeNumber,
      month
    );

    return res.status(200).json({
      success: true,
      count: report.length,
      data: report,
    });

  } catch (error) {
    console.error("Monthly detailed report error:", error);

    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إنشاء التقرير التفصيلي",
    });
  }
}
