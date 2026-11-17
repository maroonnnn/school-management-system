/**
 * FR-ALG-01 / FR-ATT-09 / FR-ATT-10 / FR-ATT-18 / BR-04 / BR-05
 * Classifies one employee's work day. Pure function: no DB, no clock — fully unit-testable (NFR-13).
 * New attendance sources (face, fingerprint, manual, offline) only produce events; this logic does not change (NFR-14).
 */

export type DayStatus =
  | "PRESENT"            // on time, stayed until the expected end
  | "LATE"               // first IN after expected start + tolerance
  | "EARLY_LEAVE"        // last OUT before expected end − tolerance
  | "LATE_EARLY_LEAVE"   // both
  | "INCOMPLETE"         // IN without OUT or OUT without IN → review, not absence (BR-05)
  | "POSSIBLE_ABSENCE"   // no events at all → review; the system never decides "absent" (FR-ATT-10)
  | "EXCUSED"            // on leave / official assignment
  | "OUTAGE_EXEMPT"      // missing/late events fall inside a recorded outage (FR-ATT-18)
  | "NO_DUTY"            // no scheduled work that day (e.g. a contract teacher's day off at this school)
  | "CORRECTED";         // an approved correction overrides the computed status (FR-ATT-12)

export interface ClassifierEvent { type: "IN" | "OUT"; at: number } // epoch ms
export interface Interval { start: number; end: number }             // epoch ms

export interface ClassifierInput {
  events: ClassifierEvent[];          // accepted raw events of that day (any order)
  expected: Interval | null;          // teacher: first lesson start → last lesson end; staff: work hours; null = no duty
  toleranceMinutes: number;           // BR-04, default 15
  outages: Interval[];                // FR-ATT-18
  onLeave: boolean;                   // FR-SCH-09
  correction?: { status: string } | null; // approved correction
}

export interface ClassifierResult {
  status: DayStatus;
  firstIn: number | null;
  lastOut: number | null;
  lateMinutes: number;
  earlyMinutes: number;
  presenceMinutes: number;
  needsReview: boolean;
  reasons: string[];                  // human-readable (Arabic) explanation (NFR-15)
  correctedStatus?: string;
}

const MIN = 60_000;
const covered = (t: number, outages: Interval[]) => outages.some((o) => t >= o.start && t <= o.end);
const overlaps = (a: Interval, outages: Interval[]) => outages.some((o) => o.start < a.end && o.end > a.start);

/** Pairs IN→OUT in time order; unmatched events make the day incomplete. */
function pairEvents(events: ClassifierEvent[]) {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const pairs: Interval[] = [];
  let open: number | null = null;
  let unmatched = 0;
  for (const e of sorted) {
    if (e.type === "IN") {
      if (open !== null) unmatched++; // IN, IN → first IN lost its OUT
      open = e.at;
    } else if (open !== null) {
      pairs.push({ start: open, end: e.at });
      open = null;
    } else {
      unmatched++; // OUT without IN
    }
  }
  if (open !== null) unmatched++;
  return { sorted, pairs, unmatched };
}

export function classifyDay(input: ClassifierInput): ClassifierResult {
  const { sorted, pairs, unmatched } = pairEvents(input.events);
  const ins = sorted.filter((e) => e.type === "IN");
  const outs = sorted.filter((e) => e.type === "OUT");
  const firstIn = ins[0]?.at ?? null;
  const lastOut = outs.at(-1)?.at ?? null;
  const presenceMinutes = Math.round(pairs.reduce((m, p) => m + (p.end - p.start), 0) / MIN);
  const base = { firstIn, lastOut, presenceMinutes, lateMinutes: 0, earlyMinutes: 0 };

  if (input.correction) {
    return { ...base, status: "CORRECTED", correctedStatus: input.correction.status, needsReview: false, reasons: ["تصحيح معتمد من مدير المدرسة"] };
  }
  if (input.onLeave) {
    return { ...base, status: "EXCUSED", needsReview: false, reasons: ["إجازة أو تكليف رسمي مسجّل"] };
  }
  if (!input.expected) {
    return { ...base, status: "NO_DUTY", needsReview: false, reasons: ["لا يوجد دوام مجدول بهذا اليوم"] };
  }

  const exp = input.expected;
  const tol = input.toleranceMinutes * MIN;

  if (sorted.length === 0) {
    if (overlaps(exp, input.outages)) {
      return { ...base, status: "OUTAGE_EXEMPT", needsReview: true, reasons: ["لا توجد أحداث، لكن وقت الدوام تقاطع مع انقطاع مسجّل"] };
    }
    return { ...base, status: "POSSIBLE_ABSENCE", needsReview: true, reasons: ["لا توجد أي حركة حضور — غياب محتمل يحتاج مراجعة"] };
  }

  if (unmatched > 0 || firstIn === null || lastOut === null) {
    const outageNote = overlaps(exp, input.outages) ? " (يوجد انقطاع مسجّل بنفس اليوم)" : "";
    return {
      ...base,
      status: "INCOMPLETE",
      needsReview: true,
      reasons: [(firstIn === null ? "خروج بدون دخول" : lastOut === null ? "دخول بدون خروج" : "تسلسل حركات غير مكتمل") + outageNote],
    };
  }

  const reasons: string[] = [];
  let late = Math.max(0, Math.round((firstIn - exp.start) / MIN));
  let early = Math.max(0, Math.round((exp.end - lastOut) / MIN));
  const isLate = firstIn > exp.start + tol;
  const isEarly = lastOut < exp.end - tol;
  let lateCounted = isLate;
  let earlyCounted = isEarly;

  // FR-ATT-18: lateness/early leave inside a recorded outage is not counted
  if (isLate && overlaps({ start: exp.start, end: firstIn }, input.outages)) {
    lateCounted = false;
    reasons.push(`تأخر ${late} دقيقة خلال انقطاع مسجّل — لا يُحتسب`);
  }
  if (isEarly && (covered(lastOut, input.outages) || overlaps({ start: lastOut, end: exp.end }, input.outages))) {
    earlyCounted = false;
    reasons.push(`خروج مبكر ${early} دقيقة خلال انقطاع مسجّل — لا يُحتسب`);
  }
  if (lateCounted) reasons.push(`تأخر ${late} دقيقة (السماحية ${input.toleranceMinutes} دقيقة)`);
  if (earlyCounted) reasons.push(`خروج قبل نهاية الدوام بـ ${early} دقيقة`);
  if (!lateCounted) late = isLate ? late : 0;
  if (!earlyCounted) early = isEarly ? early : 0;

  const status: DayStatus =
    lateCounted && earlyCounted ? "LATE_EARLY_LEAVE" : lateCounted ? "LATE" : earlyCounted ? "EARLY_LEAVE"
      : (isLate || isEarly) ? "OUTAGE_EXEMPT" : "PRESENT";
  if (status === "PRESENT") reasons.push("حضور ضمن الدوام");

  return { ...base, lateMinutes: lateCounted ? late : 0, earlyMinutes: earlyCounted ? early : 0, status, needsReview: false, reasons };
}
