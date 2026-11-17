import pool from "../config/database.js";
import { classifyDay, type ClassifierEvent, type ClassifierResult, type Interval } from "../algorithms/attendanceClassifier.js";
import { getSetting } from "./schedule.service.js";

/** Syria uses UTC+3 all year (since 2022). Local "YYYY-MM-DD" + "HH:MM" → epoch ms. */
export const localMs = (date: string, hhmm: string) => new Date(`${date}T${hhmm.slice(0, 5)}:00+03:00`).getTime();
const fmtTime = (ms: number | null) =>
  ms === null ? null : new Date(ms + 3 * 3600_000).toISOString().slice(11, 16);

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
const dow = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() + 1; // 1 = Sunday

export interface DayRow extends Omit<ClassifierResult, "firstIn" | "lastOut"> {
  employee_assignment_id: number;
  employee_number: string;
  full_name: string;
  position_type: string;
  school_id: number;
  date: string;
  firstIn: string | null;
  lastOut: string | null;
  expectedStart: string | null;
  expectedEnd: string | null;
  eventsCount: number;
  pendingCorrection: boolean;
}

/**
 * Classifies every (active assignment × day) in [from, to] for a school or a single assignment.
 * Gathers: accepted raw events, expected hours (timetable or staff hours), outages, leaves, approved corrections.
 */
export async function classifyRange(from: string, to: string, opts: { schoolId?: number; assignmentId?: number }): Promise<DayRow[]> {
  const params = [opts.schoolId ?? null, opts.assignmentId ?? null];
  const people = await pool.query(
    `SELECT ea.id, ea.employee_id, ea.school_id, ea.position_type, e.employee_number, e.full_name
       FROM employee_assignments ea JOIN employees e ON e.id = ea.employee_id
      WHERE ea.is_active AND ea.school_id IS NOT NULL
        AND ($1::bigint IS NULL OR ea.school_id = $1) AND ($2::bigint IS NULL OR ea.id = $2)
      ORDER BY ea.position_type <> 'PRINCIPAL', ea.position_type, e.full_name`,
    params
  );
  if (!people.rowCount) return [];
  const eaIds = people.rows.map((p) => Number(p.id));
  const schoolIds = [...new Set(people.rows.map((p) => Number(p.school_id)))];
  const empIds = [...new Set(people.rows.map((p) => Number(p.employee_id)))];

  const [events, lessons, outages, leaves, corrections, pending] = await Promise.all([
    pool.query(
      `SELECT employee_assignment_id AS ea, event_type, event_time,
              to_char(event_time AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD') AS d
         FROM attendance_events
        WHERE employee_assignment_id = ANY($1) AND verification_status = 'ACCEPTED'
          AND event_time >= ($2::date)::timestamp AT TIME ZONE 'Asia/Damascus'
          AND event_time < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Damascus'`,
      [eaIds, from, to]
    ),
    pool.query(
      `SELECT ta.employee_assignment_id AS ea, tp.day_of_week,
              to_char(MIN(tp.start_time), 'HH24:MI') AS first_start, to_char(MAX(tp.end_time), 'HH24:MI') AS last_end
         FROM timetable_periods tp
         JOIN timetables t ON t.id = tp.timetable_id AND t.is_active AND t.is_approved
         JOIN teaching_assignments ta ON ta.id = tp.teaching_assignment_id AND ta.is_active
        WHERE ta.employee_assignment_id = ANY($1)
        GROUP BY 1, 2`,
      [eaIds]
    ),
    pool.query(
      `SELECT school_id, starts_at, ends_at FROM power_outages
        WHERE school_id = ANY($1) AND ends_at >= ($2::date)::timestamp AT TIME ZONE 'Asia/Damascus'
          AND starts_at < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Damascus'`,
      [schoolIds, from, to]
    ),
    pool.query(
      `SELECT employee_id, start_date, end_date FROM employee_leaves
        WHERE employee_id = ANY($1) AND end_date >= $2 AND start_date <= $3`,
      [empIds, from, to]
    ),
    pool.query(
      `SELECT employee_assignment_id AS ea, work_date::text AS d, corrected_status FROM attendance_corrections
        WHERE employee_assignment_id = ANY($1) AND status = 'APPROVED' AND work_date BETWEEN $2 AND $3`,
      [eaIds, from, to]
    ),
    pool.query(
      `SELECT employee_assignment_id AS ea, work_date::text AS d FROM attendance_corrections
        WHERE employee_assignment_id = ANY($1) AND status = 'PENDING' AND work_date BETWEEN $2 AND $3`,
      [eaIds, from, to]
    ),
  ]);

  const workDays = await getSetting<number[]>("work_days");
  const staffHours = await getSetting<{ start: string; end: string }>("staff_work_hours");
  const tolerance = Number(await getSetting<number>("late_tolerance_minutes"));

  const key = (ea: number | string, d: string) => `${ea}|${d}`;
  const eventsBy = new Map<string, ClassifierEvent[]>();
  for (const e of events.rows) {
    const k = key(e.ea, e.d);
    if (!eventsBy.has(k)) eventsBy.set(k, []);
    eventsBy.get(k)!.push({ type: e.event_type, at: new Date(e.event_time).getTime() });
  }
  const lessonsBy = new Map<string, { first_start: string; last_end: string }>();
  for (const l of lessons.rows) lessonsBy.set(`${l.ea}|${l.day_of_week}`, l);
  const correctionBy = new Map<string, string>();
  for (const c of corrections.rows) correctionBy.set(key(c.ea, c.d), c.corrected_status);
  const pendingSet = new Set(pending.rows.map((p) => key(p.ea, p.d)));

  const rows: DayRow[] = [];
  for (const date of eachDay(from, to)) {
    if (!workDays.includes(dow(date))) continue;
    for (const p of people.rows) {
      const ea = Number(p.id);
      let expected: Interval | null = null;
      if (p.position_type === "TEACHER") {
        const l = lessonsBy.get(`${ea}|${dow(date)}`);
        if (l) expected = { start: localMs(date, l.first_start), end: localMs(date, l.last_end) };
      } else {
        expected = { start: localMs(date, staffHours.start), end: localMs(date, staffHours.end) };
      }
      const dayEvents = eventsBy.get(key(ea, date)) ?? [];
      const r = classifyDay({
        events: dayEvents,
        expected,
        toleranceMinutes: tolerance,
        outages: outages.rows
          .filter((o) => Number(o.school_id) === Number(p.school_id))
          .map((o) => ({ start: new Date(o.starts_at).getTime(), end: new Date(o.ends_at).getTime() })),
        onLeave: leaves.rows.some((lv) => Number(lv.employee_id) === Number(p.employee_id) && lv.start_date <= date && lv.end_date >= date),
        correction: correctionBy.has(key(ea, date)) ? { status: correctionBy.get(key(ea, date))! } : null,
      });
      rows.push({
        ...r,
        employee_assignment_id: ea,
        employee_number: p.employee_number,
        full_name: p.full_name,
        position_type: p.position_type,
        school_id: Number(p.school_id),
        date,
        firstIn: fmtTime(r.firstIn),
        lastOut: fmtTime(r.lastOut),
        expectedStart: expected ? fmtTime(expected.start) : null,
        expectedEnd: expected ? fmtTime(expected.end) : null,
        eventsCount: dayEvents.length,
        pendingCorrection: pendingSet.has(key(ea, date)),
      });
    }
  }
  return rows;
}
