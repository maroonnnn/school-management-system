import ExcelJS from "exceljs";

// FR-RPT-07/08: generic Arabic RTL workbook used by every report export.
export interface SheetSpec {
  name: string;
  title: string;
  columns: { header: string; key: string; width?: number }[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
}

const GREEN = "FF0B3B2E";
const GOLD = "FFB9A26A";

export async function buildWorkbook(sheets: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "نظام إدارة ومتابعة المدارس";
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31), { views: [{ rightToLeft: true, state: "frozen", ySplit: 3 }] });
    const n = s.columns.length;
    ws.columns = s.columns.map((c) => ({ key: c.key, width: c.width ?? 14 }));
    ws.mergeCells(1, 1, 1, n);
    const t = ws.getCell(1, 1);
    t.value = s.title;
    t.font = { bold: true, size: 14, color: { argb: GREEN }, name: "Arial" };
    t.alignment = { horizontal: "center" };
    ws.mergeCells(2, 1, 2, n);
    const sub = ws.getCell(2, 1);
    sub.value = `الجمهورية العربية السورية — وزارة التربية والتعليم · تاريخ الاستخراج: ${new Date().toLocaleString("ar-SY")}`;
    sub.font = { size: 9, color: { argb: "FF5F6F69" }, name: "Arial" };
    sub.alignment = { horizontal: "center" };
    ws.addRow(s.columns.map((c) => c.header));
    ws.getRow(3).eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = { bottom: { style: "medium", color: { argb: GOLD } } };
    });
    ws.getRow(3).height = 30;
    for (const r of s.rows) ws.addRow(s.columns.map((c) => r[c.key] ?? ""));
    if (s.totals) {
      const row = ws.addRow(s.columns.map((c) => s.totals![c.key] ?? ""));
      row.font = { bold: true };
      row.eachCell((c) => { c.border = { top: { style: "thin", color: { argb: GREEN } } }; });
    }
    if (s.rows.length) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: n } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
