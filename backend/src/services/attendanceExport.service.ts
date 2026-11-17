import ExcelJS from "exceljs";
import pool from "../config/database.js";

const POSITION: Record<string, string> = {
  TEACHER: "معلم", PRINCIPAL: "مدير", DEPUTY: "نائب مدير", ADMINISTRATIVE: "إداري", SUPERVISOR: "موجّه",
};
const METHOD: Record<string, string> = { FACE: "تعرّف على الوجه", MANUAL: "إدخال يدوي", FINGERPRINT: "بصمة" };

/**
 * FR-ATT-25/27: monthly attendance workbook for one school, built on demand from the accepted raw events.
 * It is a derived copy — editing a downloaded file never touches the database.
 * Sheet 1: one row per person per day (name, position, date, first IN, last OUT).
 * Sheet 2: every accepted raw event (for audit).
 */
export async function buildMonthlyAttendanceWorkbook(schoolId: number, month: string) {
  const school = await pool.query("SELECT name FROM schools WHERE id = $1", [schoolId]);
  const schoolName: string = school.rows[0]?.name ?? "";
  const range = [`${month}-01`];

  const daily = await pool.query(
    `SELECT e.full_name, e.employee_number, ea.position_type,
            (ae.event_time AT TIME ZONE 'Asia/Damascus')::date::text AS day,
            to_char(MIN(ae.event_time) FILTER (WHERE ae.event_type = 'IN') AT TIME ZONE 'Asia/Damascus', 'HH24:MI') AS first_in,
            to_char(MAX(ae.event_time) FILTER (WHERE ae.event_type = 'OUT') AT TIME ZONE 'Asia/Damascus', 'HH24:MI') AS last_out,
            bool_or(ae.verification_method = 'MANUAL') AS has_manual
       FROM attendance_events ae
       JOIN employee_assignments ea ON ea.id = ae.employee_assignment_id
       JOIN employees e ON e.id = ea.employee_id
      WHERE ea.school_id = $1 AND ae.verification_status = 'ACCEPTED'
        AND ae.event_time >= ($2::date)::timestamp AT TIME ZONE 'Asia/Damascus'
        AND ae.event_time < (($2::date + interval '1 month')::date)::timestamp AT TIME ZONE 'Asia/Damascus'
      GROUP BY 1, 2, 3, 4
      ORDER BY 4, 1`,
    [schoolId, ...range]
  );
  const raw = await pool.query(
    `SELECT e.full_name, e.employee_number, ae.event_type, ae.verification_method, ae.manual_reason,
            to_char(ae.event_time AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI:SS') AS event_time,
            to_char(ae.recorded_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI:SS') AS received_at
       FROM attendance_events ae
       JOIN employee_assignments ea ON ea.id = ae.employee_assignment_id
       JOIN employees e ON e.id = ea.employee_id
      WHERE ea.school_id = $1 AND ae.verification_status = 'ACCEPTED'
        AND ae.event_time >= ($2::date)::timestamp AT TIME ZONE 'Asia/Damascus'
        AND ae.event_time < (($2::date + interval '1 month')::date)::timestamp AT TIME ZONE 'Asia/Damascus'
      ORDER BY ae.event_time`,
    [schoolId, ...range]
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "نظام إدارة ومتابعة المدارس";
  wb.created = new Date();
  const green = "FF0B3B2E";
  const gold = "FFB9A26A";

  const styleHeader = (ws: ExcelJS.Worksheet, row: number) => {
    ws.getRow(row).eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: green } };
      c.alignment = { horizontal: "center", vertical: "middle" };
      c.border = { bottom: { style: "medium", color: { argb: gold } } };
    });
    ws.getRow(row).height = 22;
  };
  const title = (ws: ExcelJS.Worksheet, text: string, cols: number) => {
    ws.mergeCells(1, 1, 1, cols);
    const c = ws.getCell(1, 1);
    c.value = text;
    c.font = { bold: true, size: 14, color: { argb: green }, name: "Arial" };
    c.alignment = { horizontal: "center" };
    ws.mergeCells(2, 1, 2, cols);
    const s = ws.getCell(2, 1);
    s.value = `الجمهورية العربية السورية — وزارة التربية والتعليم · تاريخ الاستخراج: ${new Date().toLocaleString("ar-SY")} · نسخة مشتقة من السجلات الأصلية`;
    s.font = { size: 9, color: { argb: "FF5F6F69" }, name: "Arial" };
    s.alignment = { horizontal: "center" };
  };

  // Sheet 1 — daily
  const ws = wb.addWorksheet("الحضور اليومي", { views: [{ rightToLeft: true, state: "frozen", ySplit: 3 }] });
  ws.columns = [
    { key: "name", width: 28 }, { key: "number", width: 12 }, { key: "position", width: 12 },
    { key: "day", width: 13 }, { key: "in", width: 11 }, { key: "out", width: 11 }, { key: "note", width: 22 },
  ];
  title(ws, `سجل حضور ${schoolName} — ${month}`, 7);
  ws.addRow(["الاسم", "الرقم الوظيفي", "الصفة", "التاريخ", "وقت الدخول", "وقت الخروج", "ملاحظات"]);
  styleHeader(ws, 3);
  for (const r of daily.rows) {
    const row = ws.addRow([
      r.full_name, r.employee_number, POSITION[r.position_type] ?? r.position_type, r.day,
      r.first_in ?? "—", r.last_out ?? "—",
      [r.has_manual ? "يتضمن إدخالاً يدوياً" : "", !r.first_in || !r.last_out ? "تسجيل ناقص" : ""].filter(Boolean).join(" · "),
    ]);
    row.alignment = { vertical: "middle" };
    if (!r.first_in || !r.last_out) row.getCell(7).font = { color: { argb: "FFB45309" } };
  }
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 7 } };

  // Sheet 2 — raw events
  const ws2 = wb.addWorksheet("الأحداث الخام", { views: [{ rightToLeft: true, state: "frozen", ySplit: 3 }] });
  ws2.columns = [
    { key: "name", width: 28 }, { key: "number", width: 12 }, { key: "type", width: 9 },
    { key: "time", width: 20 }, { key: "received", width: 20 }, { key: "source", width: 16 }, { key: "reason", width: 30 },
  ];
  title(ws2, `الأحداث الخام — ${schoolName} — ${month}`, 7);
  ws2.addRow(["الاسم", "الرقم الوظيفي", "النوع", "وقت الحدث", "وقت الوصول للخادم", "المصدر", "سبب الإدخال اليدوي"]);
  styleHeader(ws2, 3);
  for (const r of raw.rows) {
    ws2.addRow([r.full_name, r.employee_number, r.event_type === "IN" ? "دخول" : "خروج", r.event_time, r.received_at,
      METHOD[r.verification_method] ?? r.verification_method, r.manual_reason ?? ""]);
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, fileName: `حضور ${schoolName} ${month}.xlsx`, rows: daily.rowCount };
}
