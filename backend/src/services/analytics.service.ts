import pool from "../config/database.js";
import { classifyRange } from "./attendance.service.js";
import { centralReport, dayBucket, termOf, todaySy } from "./reports.service.js";
import { getSetting } from "./schedule.service.js";
import {
  DEFAULT_NEED_WEIGHTS, DEFAULT_PERFORMANCE_WEIGHTS, rankSchools,
  type NeedWeights, type PerformanceWeights, type SchoolInput,
} from "../algorithms/schoolPerformance.js";
import { detectAnomalies, type AnomalyDay } from "../algorithms/attendanceAnomalies.js";

// AI ideas 4 + 5: computed on demand (like request priority, FR-ALG-04) from the same services as reports and dashboards.

/** Performance + need index for the given schools over a period (FR-ALG-08, FR-DASH-07). */
export async function schoolScores(schoolIds: number[] | null, from: string, to: string) {
  const report = await centralReport(schoolIds, from, to);
  const term = termOf(to);
  const prevBy = new Map<number, number>();
  if (term === 2) {
    const prev = await pool.query(
      `SELECT c.school_id, ROUND(AVG(tr.score), 1)::float AS avg
         FROM term_results tr JOIN result_sheets rs ON rs.id = tr.sheet_id AND rs.status = 'SUBMITTED' AND rs.term = 1
         JOIN teaching_assignments ta ON ta.id = rs.teaching_assignment_id AND ta.is_active
         JOIN sections sc ON sc.id = ta.section_id JOIN classes c ON c.id = sc.class_id
        GROUP BY c.school_id`
    );
    for (const r of prev.rows) prevBy.set(Number(r.school_id), r.avg);
  }
  const overdueDays = Number((await getSetting<number>("request_overdue_days")) ?? 7);
  const pw = { ...DEFAULT_PERFORMANCE_WEIGHTS, ...((await getSetting<PerformanceWeights>("school_performance_weights")) ?? {}) };
  const nw = { ...DEFAULT_NEED_WEIGHTS, ...((await getSetting<NeedWeights>("school_need_weights")) ?? {}) };

  const inputs: SchoolInput[] = report.schools.map((s) => ({
    schoolId: s.schoolId, schoolName: s.schoolName, attendanceRate: s.attendanceRate, possibleAbsenceRate: s.possibleAbsenceRate,
    quotaCompletion: s.quotaCompletion, avgDaysToDecision: s.avgDaysToDecision, overdueDays, requestsOverdue: s.requestsOverdue,
    staffShortage: s.staffShortage, resultsAverage: s.resultsAverage, previousResultsAverage: prevBy.get(s.schoolId) ?? null,
  }));
  const meta = new Map(report.schools.map((s) => [s.schoolId, s]));
  const ranked = rankSchools(inputs, pw, nw).map((r) => {
    const m = meta.get(r.schoolId)!;
    return { ...r, directorateId: m.directorateId, directorateName: m.directorateName, stage: m.stage };
  });
  const avg = (k: "performance" | "need") => (ranked.length ? Math.round(ranked.reduce((t, r) => t + r[k], 0) / ranked.length) : null);
  return { period: { from, to }, term, weights: { performance: pw, need: nw }, average: { performance: avg("performance"), need: avg("need") }, schools: ranked };
}

/** Attendance anomalies as of a date, looking back 7 weeks (4-week baseline + 2 weeks for FR-ALG-11, + margin). */
export async function attendanceAlerts(schoolIds: number[], asOf = todaySy()) {
  const from = new Date(`${asOf}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 7 * 7);
  const fromIso = from.toISOString().slice(0, 10);
  const names = await pool.query("SELECT id, name FROM schools WHERE id = ANY($1)", [schoolIds]);
  const nameBy = new Map(names.rows.map((r) => [Number(r.id), r.name as string]));
  const days: AnomalyDay[] = [];
  for (const id of schoolIds) {
    for (const d of await classifyRange(fromIso, asOf, { schoolId: id })) {
      const b = dayBucket(d);
      if (!b) continue;
      days.push({
        assignmentId: d.employee_assignment_id, name: d.full_name, position: d.position_type, schoolId: id,
        schoolName: nameBy.get(id) ?? "", date: d.date, bucket: b, lateMinutes: d.lateMinutes,
      });
    }
  }
  return { asOf, alerts: detectAnomalies(days, { asOf }) };
}
