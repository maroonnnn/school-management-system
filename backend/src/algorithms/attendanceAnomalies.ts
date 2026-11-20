/**
 * AI idea 5 (user choice 2026-11-18) — local statistical anomaly detection on classified attendance days.
 * Feeds alerts FR-ALG-07 (3 consecutive absences), FR-ALG-11 (school weekly absence z-score), and two pattern alerts
 * (lateness concentrated on one weekday, repeated incomplete registrations). Pure function — unit-testable (NFR-13).
 * Every alert carries the numbers that caused it (FR-ALG-09). Alerts inform; they never decide anything (FR-ALG-10).
 * Leaves and power-outage days are excluded before detection (bucket "excused" / "outage").
 */

export type Bucket = "present" | "late" | "earlyLeave" | "incomplete" | "possibleAbsence" | "absent" | "excused" | "outage";

export interface AnomalyDay {
  assignmentId: number;
  name: string;
  position: string;
  schoolId: number;
  schoolName: string;
  date: string;          // YYYY-MM-DD (working day)
  bucket: Bucket;
  lateMinutes: number;
}

export type AlertType = "CONSECUTIVE_ABSENCE" | "SCHOOL_ABSENCE_SPIKE" | "WEEKDAY_LATENESS" | "REPEATED_INCOMPLETE";
export interface AnomalyAlert {
  type: AlertType;
  severity: "HIGH" | "MEDIUM" | "LOW";
  schoolId: number;
  schoolName: string;
  assignmentId: number | null;
  name: string | null;
  title: string;
  reason: string;
  evidence: Record<string, number | string>;
  dates: string[];
}

export interface AnomalyOptions {
  asOf: string;                 // last date considered
  consecutiveDays: number;      // ALG-07: 3
  zThreshold: number;           // ALG-11: 2
  baselineWeeks: number;        // ALG-11: 4
  patternWeeks: number;         // lateness / incomplete window: 4
  minSdPoints: number;          // floor for the weekly standard deviation (percentage points) — avoids z = ∞ on flat history
}
export const DEFAULT_ANOMALY_OPTIONS: Omit<AnomalyOptions, "asOf"> = { consecutiveDays: 3, zThreshold: 2, baselineWeeks: 4, patternWeeks: 4, minSdPoints: 1 };

const WEEKDAY = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const ABSENT: Bucket[] = ["possibleAbsence", "absent"];
const DUTY: Bucket[] = ["present", "late", "earlyLeave", "incomplete", "possibleAbsence", "absent"];
const r1 = (x: number) => Math.round(x * 10) / 10;
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
export function weekStart(d: string): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - x.getUTCDay());
  return x.toISOString().slice(0, 10);
}
function shift(d: string, days: number) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}
function groupBy<T>(xs: T[], key: (x: T) => string | number) {
  const m = new Map<string | number, T[]>();
  for (const x of xs) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };

/** FR-ALG-07: teacher absent on N consecutive duty days. Leave/outage days are skipped (they neither count nor break the run). */
function consecutiveAbsence(days: AnomalyDay[], o: AnomalyOptions): AnomalyAlert[] {
  const out: AnomalyAlert[] = [];
  for (const [, list] of groupBy(days.filter((d) => d.position === "TEACHER"), (d) => d.assignmentId)) {
    const duty = list.filter((d) => DUTY.includes(d.bucket)).sort((a, b) => a.date.localeCompare(b.date));
    let run: AnomalyDay[] = [];
    const flush = () => {
      if (run.length >= o.consecutiveDays) {
        const p = run[0]!;
        out.push({
          type: "CONSECUTIVE_ABSENCE", severity: run.length >= o.consecutiveDays + 2 ? "HIGH" : "MEDIUM",
          schoolId: p.schoolId, schoolName: p.schoolName, assignmentId: p.assignmentId, name: p.name,
          title: `غياب ${run.length} أيام دوام متتالية`,
          reason: `لا يوجد تسجيل حضور للمعلم من ${run[0]!.date} إلى ${run[run.length - 1]!.date} (${run.length} أيام دوام متتالية، بعد استثناء الإجازات والانقطاعات). يُرجى التحقق من السبب.`,
          evidence: { days: run.length, from: run[0]!.date, to: run[run.length - 1]!.date },
          dates: run.map((d) => d.date),
        });
      }
      run = [];
    };
    for (const d of duty) ABSENT.includes(d.bucket) ? run.push(d) : flush();
    flush();
  }
  return out;
}

/** FR-ALG-11: school weekly absence rate above mean + z·sd of the previous N weeks, for two consecutive weeks. */
function schoolSpike(days: AnomalyDay[], o: AnomalyOptions): AnomalyAlert[] {
  const out: AnomalyAlert[] = [];
  const lastWeek = shift(weekStart(o.asOf), dow(o.asOf) >= 4 ? 0 : -7); // current week counts once it has ≥ 5 days of data (Sun–Thu)
  for (const [, list] of groupBy(days, (d) => d.schoolId)) {
    const weekly = new Map<string, { duty: number; absent: number }>();
    for (const d of list) {
      if (!DUTY.includes(d.bucket)) continue;
      const w = weekStart(d.date);
      const t = weekly.get(w) ?? { duty: 0, absent: 0 };
      t.duty++;
      if (ABSENT.includes(d.bucket)) t.absent++;
      weekly.set(w, t);
    }
    const rate = (w: string) => { const t = weekly.get(w); return t && t.duty ? (t.absent / t.duty) * 100 : null; };
    const check = (w: string) => {
      const x = rate(w);
      const base = Array.from({ length: o.baselineWeeks }, (_, k) => rate(shift(w, -7 * (k + 1)))).filter((v): v is number => v != null);
      if (x == null || base.length < o.baselineWeeks) return null;
      const m = mean(base);
      const s = Math.max(sd(base), o.minSdPoints);
      return { week: w, rate: r1(x), mean: r1(m), sd: r1(s), z: r1((x - m) / s) };
    };
    const a = check(shift(lastWeek, -7));
    const b = check(lastWeek);
    if (a && b && a.z > o.zThreshold && b.z > o.zThreshold) {
      const s = list[0]!;
      out.push({
        type: "SCHOOL_ABSENCE_SPIKE", severity: "HIGH", schoolId: s.schoolId, schoolName: s.schoolName, assignmentId: null, name: null,
        title: "ارتفاع غير طبيعي في غياب المدرسة لأسبوعين متتاليين",
        reason: `نسبة الغياب الأسبوعية ${a.rate}% ثم ${b.rate}% مقابل متوسط ${b.mean}% (انحراف معياري ${b.sd}) في الأسابيع ${o.baselineWeeks} السابقة — Z = ${a.z} و ${b.z} (العتبة ${o.zThreshold}).`,
        evidence: { week1: a.week, rate1: a.rate, z1: a.z, week2: b.week, rate2: b.rate, z2: b.z, baselineMean: b.mean, baselineSd: b.sd },
        dates: [a.week, b.week],
      });
    }
  }
  return out;
}

/** Lateness concentrated on one weekday over the last N weeks (late ≥ 3 times and ≥ 75% of that weekday, ≤ 25% on other days). */
function weekdayLateness(days: AnomalyDay[], o: AnomalyOptions): AnomalyAlert[] {
  const out: AnomalyAlert[] = [];
  const from = shift(o.asOf, -7 * o.patternWeeks + 1);
  for (const [, list] of groupBy(days.filter((d) => d.date >= from && DUTY.includes(d.bucket) && !ABSENT.includes(d.bucket)), (d) => d.assignmentId)) {
    const byDay = groupBy(list, (d) => dow(d.date));
    for (const [wd, onDay] of byDay) {
      const late = onDay.filter((d) => d.bucket === "late" || d.lateMinutes > 0);
      const others = list.filter((d) => dow(d.date) !== wd);
      const othersLate = others.filter((d) => d.bucket === "late" || d.lateMinutes > 0).length;
      const rateDay = late.length / onDay.length;
      const rateOther = others.length ? othersLate / others.length : 0;
      if (late.length >= 3 && rateDay >= 0.75 && rateOther <= 0.25) {
        const p = list[0]!;
        const avg = Math.round(mean(late.map((d) => d.lateMinutes)));
        out.push({
          type: "WEEKDAY_LATENESS", severity: "LOW", schoolId: p.schoolId, schoolName: p.schoolName, assignmentId: p.assignmentId, name: p.name,
          title: `تأخر متكرر يوم ${WEEKDAY[Number(wd)]}`,
          reason: `تأخر ${late.length} من ${onDay.length} أيام ${WEEKDAY[Number(wd)]} خلال آخر ${o.patternWeeks} أسابيع (متوسط ${avg} دقيقة)، مقابل ${Math.round(rateOther * 100)}% فقط في باقي الأيام. قد يدل على ظرف ثابت في هذا اليوم.`,
          evidence: { weekday: WEEKDAY[Number(wd)]!, lateDays: late.length, dayCount: onDay.length, avgLateMinutes: avg, otherDaysLatePct: Math.round(rateOther * 100) },
          dates: late.map((d) => d.date),
        });
      }
    }
  }
  return out;
}

/** Repeated incomplete registrations (IN without OUT) in the last N weeks. */
function repeatedIncomplete(days: AnomalyDay[], o: AnomalyOptions): AnomalyAlert[] {
  const from = shift(o.asOf, -7 * o.patternWeeks + 1);
  const out: AnomalyAlert[] = [];
  for (const [, list] of groupBy(days.filter((d) => d.date >= from && d.bucket === "incomplete"), (d) => d.assignmentId)) {
    if (list.length < 3) continue;
    const p = list[0]!;
    out.push({
      type: "REPEATED_INCOMPLETE", severity: "LOW", schoolId: p.schoolId, schoolName: p.schoolName, assignmentId: p.assignmentId, name: p.name,
      title: "تسجيل ناقص متكرر",
      reason: `${list.length} أيام بدخول دون خروج خلال آخر ${o.patternWeeks} أسابيع — قد يحتاج تذكيراً بتسجيل الخروج أو فحص جهاز الحضور.`,
      evidence: { incompleteDays: list.length, weeks: o.patternWeeks },
      dates: list.map((d) => d.date).sort(),
    });
  }
  return out;
}

const ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function detectAnomalies(days: AnomalyDay[], options: Partial<AnomalyOptions> & { asOf: string }): AnomalyAlert[] {
  const o: AnomalyOptions = { ...DEFAULT_ANOMALY_OPTIONS, ...options };
  const window = days.filter((d) => d.date <= o.asOf);
  return [...consecutiveAbsence(window, o), ...schoolSpike(window, o), ...weekdayLateness(window, o), ...repeatedIncomplete(window, o)]
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (b.dates.at(-1) ?? "").localeCompare(a.dates.at(-1) ?? ""));
}
