import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAnomalies, weekStart, type AnomalyDay, type Bucket } from "./attendanceAnomalies.js";

/** Working days Sun–Thu between two dates. */
function workDays(from: string, to: string) {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() <= 4) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
const day = (date: string, bucket: Bucket, extra: Partial<AnomalyDay> = {}): AnomalyDay => ({
  assignmentId: 1, name: "معلم", position: "TEACHER", schoolId: 1, schoolName: "مدرسة", date, bucket, lateMinutes: 0, ...extra,
});
const types = (a: { type: string }[]) => a.map((x) => x.type);

test("weekStart is the Sunday of the week", () => {
  assert.equal(weekStart("2026-11-12"), "2026-11-08"); // Thursday → Sunday
  assert.equal(weekStart("2026-11-08"), "2026-11-08");
});

test("ALG-07: three consecutive absent duty days → alert with the dates", () => {
  const ds = workDays("2026-11-01", "2026-11-12");
  const days = ds.map((d) => day(d, ["2026-11-09", "2026-11-10", "2026-11-11"].includes(d) ? "possibleAbsence" : "present"));
  const a = detectAnomalies(days, { asOf: "2026-11-12" }).filter((x) => x.type === "CONSECUTIVE_ABSENCE");
  assert.equal(a.length, 1);
  assert.deepEqual(a[0]!.dates, ["2026-11-09", "2026-11-10", "2026-11-11"]);
  assert.equal(a[0]!.evidence.days, 3);
});

test("ALG-07: two absences are not enough", () => {
  const ds = workDays("2026-11-01", "2026-11-12");
  const days = ds.map((d) => day(d, ["2026-11-10", "2026-11-11"].includes(d) ? "absent" : "present"));
  assert.deepEqual(types(detectAnomalies(days, { asOf: "2026-11-12" })), []);
});

test("ALG-07: leave days are excluded — absence, leave, absence, absence still counts as 3", () => {
  const b: Record<string, Bucket> = { "2026-11-08": "absent", "2026-11-09": "excused", "2026-11-10": "absent", "2026-11-11": "possibleAbsence" };
  const days = workDays("2026-11-01", "2026-11-12").map((d) => day(d, b[d] ?? "present"));
  const a = detectAnomalies(days, { asOf: "2026-11-12" }).filter((x) => x.type === "CONSECUTIVE_ABSENCE");
  assert.equal(a.length, 1);
  assert.equal(a[0]!.evidence.days, 3);
});

test("ALG-07 applies to teachers only", () => {
  const days = workDays("2026-11-08", "2026-11-12").map((d) => day(d, "absent", { position: "ADMINISTRATIVE" }));
  assert.deepEqual(types(detectAnomalies(days, { asOf: "2026-11-12" })).filter((t) => t === "CONSECUTIVE_ABSENCE"), []);
});

/** School of 20 people; `absentPerDay(week)` people absent each day of that week. */
function school(weeks: string[], absentPerWeek: number[]) {
  const days: AnomalyDay[] = [];
  weeks.forEach((w, i) => {
    for (const d of workDays(w, weekStart(w) === w ? new Date(new Date(`${w}T12:00:00Z`).getTime() + 4 * 864e5).toISOString().slice(0, 10) : w)) {
      for (let p = 1; p <= 20; p++) days.push(day(d, p <= absentPerWeek[i]! ? "possibleAbsence" : "present", { assignmentId: p, position: "ADMINISTRATIVE" }));
    }
  });
  return days;
}
const SUNDAYS = ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25", "2026-11-01", "2026-11-08"];

test("ALG-11: weekly absence z-score above 2 for two consecutive weeks → school alert with the numbers", () => {
  const days = school(SUNDAYS, [1, 1, 2, 1, 6, 7]); // 5%,5%,10%,5% then 30%, 35%
  const a = detectAnomalies(days, { asOf: "2026-11-12" }).filter((x) => x.type === "SCHOOL_ABSENCE_SPIKE");
  assert.equal(a.length, 1);
  assert.equal(a[0]!.evidence.rate2, 35);
  assert.ok(Number(a[0]!.evidence.z1) > 2 && Number(a[0]!.evidence.z2) > 2);
  assert.match(a[0]!.reason, /Z =/);
});

test("ALG-11: a single bad week is not an alert", () => {
  const days = school(SUNDAYS, [1, 1, 2, 1, 1, 7]);
  assert.equal(detectAnomalies(days, { asOf: "2026-11-12" }).filter((x) => x.type === "SCHOOL_ABSENCE_SPIKE").length, 0);
});

test("ALG-11: needs a full baseline of 4 weeks", () => {
  const days = school(SUNDAYS.slice(2), [1, 1, 6, 7]);
  assert.equal(detectAnomalies(days, { asOf: "2026-11-12" }).filter((x) => x.type === "SCHOOL_ABSENCE_SPIKE").length, 0);
});

test("ALG-11: flat history uses the sd floor instead of dividing by zero", () => {
  const days = school(SUNDAYS, [1, 1, 1, 1, 1, 1]);
  assert.equal(detectAnomalies(days, { asOf: "2026-11-12" }).length, 0);
});

test("lateness concentrated on Tuesdays → pattern alert; spread-out lateness → none", () => {
  const ds = workDays("2026-10-18", "2026-11-12");
  const tuesdays = ds.map((d) => day(d, new Date(`${d}T12:00:00Z`).getUTCDay() === 2 ? "late" : "present", { lateMinutes: new Date(`${d}T12:00:00Z`).getUTCDay() === 2 ? 25 : 0 }));
  const a = detectAnomalies(tuesdays, { asOf: "2026-11-12" }).filter((x) => x.type === "WEEKDAY_LATENESS");
  assert.equal(a.length, 1);
  assert.equal(a[0]!.evidence.weekday, "الثلاثاء");
  const spread = ds.map((d, i) => day(d, i % 3 === 0 ? "late" : "present"));
  assert.equal(detectAnomalies(spread, { asOf: "2026-11-12" }).filter((x) => x.type === "WEEKDAY_LATENESS").length, 0);
});

test("three incomplete registrations in four weeks → alert", () => {
  const ds = workDays("2026-10-18", "2026-11-12");
  const days = ds.map((d, i) => day(d, i % 6 === 0 ? "incomplete" : "present"));
  const a = detectAnomalies(days, { asOf: "2026-11-12" }).filter((x) => x.type === "REPEATED_INCOMPLETE");
  assert.equal(a.length, 1);
  assert.ok(Number(a[0]!.evidence.incompleteDays) >= 3);
});

test("days after asOf are ignored", () => {
  const days = workDays("2026-11-15", "2026-11-19").map((d) => day(d, "absent"));
  assert.equal(detectAnomalies(days, { asOf: "2026-11-12" }).length, 0);
});
