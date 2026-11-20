/**
 * AI idea 4 (user choice 2026-11-18) — school performance index + composite need index (FR-ALG-08, FR-DASH-07).
 * Pure function: no DB, no clock — unit-testable (NFR-13).
 *
 * performance (0–100, higher = better): attendance, quota completion, request handling speed, results level.
 * need        (0–100, higher = needs more support): staff shortage, absence, overdue requests, results decline (ALG-08).
 * Each factor is normalised to [0, 1] on a fixed, explainable scale. A factor with no data is left out and the
 * remaining weights are re-normalised — the explanation says so. Supports decisions only, never decides (FR-ALG-10).
 */

export interface PerformanceWeights { attendance: number; quota: number; requests: number; results: number }
export interface NeedWeights { shortage: number; absence: number; overdue: number; decline: number }

export const DEFAULT_PERFORMANCE_WEIGHTS: PerformanceWeights = { attendance: 0.35, quota: 0.3, requests: 0.15, results: 0.2 };
export const DEFAULT_NEED_WEIGHTS: NeedWeights = { shortage: 0.3, absence: 0.3, overdue: 0.2, decline: 0.2 };

export interface SchoolInput {
  schoolId: number;
  schoolName: string;
  attendanceRate: number | null;     // % of required days attended
  possibleAbsenceRate: number | null;// % of required days with no attendance
  quotaCompletion: number | null;    // % of due lessons executed
  avgDaysToDecision: number | null;  // requests submitted in the period
  overdueDays: number;               // request_overdue_days setting
  requestsOverdue: number;           // open requests past the threshold
  staffShortage: number;             // open "teacher shortage" requests
  resultsAverage: number | null;     // current term, 0–100
  previousResultsAverage: number | null; // previous term, for the decline factor
}

export interface Factor { key: string; label: string; value: number | null; weight: number; contribution: number; detail: string }
export interface SchoolScore {
  schoolId: number;
  schoolName: string;
  performance: number;
  need: number;
  rank: number;
  performanceFactors: Factor[];
  needFactors: Factor[];
  strengths: string[];
  weaknesses: string[];
  reason: string;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Weighted sum over factors that have data; weights re-normalised over those factors. */
function combine(raw: { key: string; label: string; value: number | null; weight: number; detail: string }[]): { score: number; factors: Factor[] } {
  const present = raw.filter((f) => f.value != null && f.weight > 0);
  const total = present.reduce((s, f) => s + f.weight, 0);
  const factors = raw.map((f) => {
    const w = f.value != null && total > 0 ? Math.max(0, f.weight) / total : 0;
    return { ...f, weight: r1(w * 100) / 100, contribution: f.value != null ? r1(w * f.value * 100) : 0 };
  });
  return { score: total > 0 ? Math.round(factors.reduce((s, f) => s + f.contribution, 0)) : 0, factors };
}

export function performanceFactors(i: SchoolInput, w: PerformanceWeights = DEFAULT_PERFORMANCE_WEIGHTS) {
  return combine([
    {
      key: "attendance", label: "الحضور", weight: w.attendance,
      // 80% or less → 0, 100% → 1 (below 80% is already a serious problem)
      value: i.attendanceRate == null ? null : clamp01((i.attendanceRate - 80) / 20),
      detail: i.attendanceRate == null ? "لا بيانات حضور" : `نسبة الحضور ${i.attendanceRate}%`,
    },
    {
      key: "quota", label: "إنجاز النصاب", weight: w.quota,
      value: i.quotaCompletion == null ? null : clamp01(i.quotaCompletion / 100),
      detail: i.quotaCompletion == null ? "لا حصص في الفترة" : `أنجزت ${i.quotaCompletion}% من الحصص المطلوبة`,
    },
    {
      key: "requests", label: "سرعة معالجة الطلبات", weight: w.requests,
      // decided immediately → 1, at twice the overdue threshold or later → 0
      value: i.avgDaysToDecision == null ? null : clamp01(1 - i.avgDaysToDecision / (2 * Math.max(1, i.overdueDays))),
      detail: i.avgDaysToDecision == null ? "لا طلبات مقرَّرة في الفترة" : `متوسط ${i.avgDaysToDecision} يوم حتى القرار`,
    },
    {
      key: "results", label: "مستوى المحصّلات", weight: w.results,
      value: i.resultsAverage == null ? null : clamp01(i.resultsAverage / 100),
      detail: i.resultsAverage == null ? "لم تُرفع محصّلات" : `متوسط المحصّلات ${i.resultsAverage}`,
    },
  ]);
}

export function needFactors(i: SchoolInput, w: NeedWeights = DEFAULT_NEED_WEIGHTS) {
  const decline = i.resultsAverage != null && i.previousResultsAverage != null ? i.previousResultsAverage - i.resultsAverage : null;
  return combine([
    { key: "shortage", label: "نقص الكادر", weight: w.shortage, value: clamp01(i.staffShortage / 2),
      detail: `${i.staffShortage} طلب نقص مدرّسين مفتوح` },
    { key: "absence", label: "الغياب", weight: w.absence,
      // 10% possible absence → 1
      value: i.possibleAbsenceRate == null ? null : clamp01(i.possibleAbsenceRate / 10),
      detail: i.possibleAbsenceRate == null ? "لا بيانات حضور" : `غياب محتمل ${i.possibleAbsenceRate}% من أيام الدوام` },
    { key: "overdue", label: "طلبات متأخرة", weight: w.overdue, value: clamp01(i.requestsOverdue / 3),
      detail: `${i.requestsOverdue} طلب متأخر` },
    { key: "decline", label: "تراجع النتائج", weight: w.decline,
      // a drop of 10 points between terms → 1; improvement → 0
      value: decline == null ? null : clamp01(decline / 10),
      detail: decline == null ? "لا يوجد فصل سابق للمقارنة" : decline > 0 ? `تراجع ${r1(decline)} نقطة عن الفصل السابق` : "لا تراجع عن الفصل السابق" },
  ]);
}

/** Scores every school, ranks by performance (ties: lower need first, then name), and explains each score. */
export function rankSchools(inputs: SchoolInput[], pw?: PerformanceWeights, nw?: NeedWeights): SchoolScore[] {
  const scored = inputs.map((i) => {
    const p = performanceFactors(i, pw);
    const n = needFactors(i, nw);
    const usable = p.factors.filter((f) => f.value != null);
    const strengths = usable.filter((f) => f.value! >= 0.8).map((f) => `${f.label}: ${f.detail}`);
    const weaknesses = usable.filter((f) => f.value! < 0.5).map((f) => `${f.label}: ${f.detail}`);
    const missing = p.factors.filter((f) => f.value == null).map((f) => f.label);
    const topNeed = n.factors.filter((f) => f.contribution >= 5).sort((a, b) => b.contribution - a.contribution).map((f) => f.detail);
    const reason = [
      weaknesses.length ? `خفّض الأداء: ${weaknesses.join("، ")}` : "لا نقاط ضعف واضحة في الأداء",
      topNeed.length ? `رفع الاحتياج: ${topNeed.join("، ")}` : "",
      missing.length ? `(بدون بيانات: ${missing.join("، ")} — وُزّعت أوزانها على باقي العوامل)` : "",
    ].filter(Boolean).join(" · ");
    return { schoolId: i.schoolId, schoolName: i.schoolName, performance: p.score, need: n.score, rank: 0,
      performanceFactors: p.factors, needFactors: n.factors, strengths, weaknesses, reason };
  });
  scored.sort((a, b) => b.performance - a.performance || a.need - b.need || a.schoolName.localeCompare(b.schoolName, "ar"));
  // equal performance and need → equal rank
  scored.forEach((s, idx) => {
    const prev = scored[idx - 1];
    s.rank = prev && prev.performance === s.performance && prev.need === s.need ? prev.rank : idx + 1;
  });
  return scored;
}
