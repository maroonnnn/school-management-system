/**
 * FR-ALG-02 / 03 / 04, FR-REQ-15 / 16 / 17
 * Priority score 0–100 of an open request = weighted sum of five factors, each normalised to [0, 1].
 * Pure function — computed at display time (never stored, because waiting time changes every day).
 * The score only helps ordering; it never accepts or rejects anything (FR-REQ-17).
 */

export interface PriorityWeights {
  severity: number;
  affected: number;
  waiting: number;
  fragility: number;
  repetition: number;
}

export interface PriorityInput {
  severity: number;            // 1–5 as set by the school
  affectedStudents: number;
  schoolStudents: number;      // active students in the school (to normalise "affected")
  waitingDays: number;         // since submission
  overdueDays: number;         // FR-REQ-16 threshold (default 7)
  schoolAbsenceRate: number;   // 0–1, share of "possible absence" staff-days in the last 30 days
  schoolOpenRequests: number;  // other open requests of the same school
  sameTypeRecent: number;      // same-type requests from the same school in the last 180 days (excluding this one)
}

export interface PriorityResult {
  score: number;               // 0–100, integer
  overdue: boolean;
  factors: { key: keyof PriorityWeights; value: number; contribution: number; label: string }[];
  reason: string;              // Arabic explanation of what raised the score (FR-ALG-03)
}

export const DEFAULT_WEIGHTS: PriorityWeights = { severity: 0.3, affected: 0.2, waiting: 0.2, fragility: 0.15, repetition: 0.15 };

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export function normaliseFactors(i: PriorityInput): Record<keyof PriorityWeights, number> {
  return {
    severity: clamp01((i.severity - 1) / 4),
    // share of the school's students affected; a whole-school issue = 1
    affected: i.schoolStudents > 0 ? clamp01(i.affectedStudents / i.schoolStudents) : clamp01(i.affectedStudents / 100),
    // reaches 1 at twice the overdue threshold
    waiting: clamp01(i.waitingDays / (2 * Math.max(1, i.overdueDays))),
    // fragile school: high possible-absence rate (10% → 1) and many open requests (5 → 1), averaged
    fragility: clamp01((clamp01(i.schoolAbsenceRate / 0.1) + clamp01(i.schoolOpenRequests / 5)) / 2),
    // the same need keeps coming back: 3 earlier same-type requests → 1
    repetition: clamp01(i.sameTypeRecent / 3),
  };
}

function describe(key: keyof PriorityWeights, i: PriorityInput): string {
  switch (key) {
    case "severity": return `خطورة ${i.severity} من 5`;
    case "affected": return `${i.affectedStudents} طالباً متأثراً`;
    case "waiting": return `ينتظر منذ ${Math.floor(i.waitingDays)} يوماً`;
    case "fragility": return `مدرسة هشّة (غياب محتمل ${Math.round(i.schoolAbsenceRate * 100)}%، ${i.schoolOpenRequests} طلبات مفتوحة أخرى)`;
    case "repetition": return `تكرّر نفس النوع ${i.sameTypeRecent} مرات خلال 6 أشهر`;
  }
}

export function computePriority(input: PriorityInput, weights: PriorityWeights = DEFAULT_WEIGHTS): PriorityResult {
  const f = normaliseFactors(input);
  const keys = Object.keys(DEFAULT_WEIGHTS) as (keyof PriorityWeights)[];
  const totalWeight = keys.reduce((s, k) => s + Math.max(0, weights[k] ?? 0), 0) || 1;
  const factors = keys.map((k) => {
    const w = Math.max(0, weights[k] ?? 0) / totalWeight;
    return { key: k, value: f[k], contribution: w * f[k] * 100, label: describe(k, input) };
  });
  const score = Math.round(factors.reduce((s, x) => s + x.contribution, 0));
  const top = [...factors].filter((x) => x.contribution >= 3).sort((a, b) => b.contribution - a.contribution).slice(0, 3);
  const overdue = input.waitingDays > input.overdueDays;
  const reason = top.length
    ? `رفع الأولوية: ${top.map((x) => `${x.label} (+${Math.round(x.contribution)})`).join("، ")}${overdue ? " — متأخر" : ""}`
    : "أولوية منخفضة: لا عوامل مؤثرة بشكل واضح";
  return { score, overdue, factors, reason };
}
