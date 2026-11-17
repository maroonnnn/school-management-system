import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDay, type ClassifierInput } from "./attendanceClassifier.js";

// Times on an arbitrary day, in minutes from midnight → epoch ms
const t = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(2026, 10, 10, h, m);
};
const day = (over: Partial<ClassifierInput> = {}): ClassifierInput => ({
  events: [],
  expected: { start: t("08:00"), end: t("13:00") },
  toleranceMinutes: 15,
  outages: [],
  onLeave: false,
  ...over,
});
const io = (inAt: string, outAt: string) => [{ type: "IN" as const, at: t(inAt) }, { type: "OUT" as const, at: t(outAt) }];

test("on time within tolerance → PRESENT", () => {
  const r = classifyDay(day({ events: io("08:10", "13:05") }));
  assert.equal(r.status, "PRESENT");
  assert.equal(r.lateMinutes, 0);
  assert.equal(r.presenceMinutes, 295);
});

test("exactly at tolerance edge is not late", () => {
  assert.equal(classifyDay(day({ events: io("08:15", "13:00") })).status, "PRESENT");
});

test("after tolerance → LATE with minutes from expected start", () => {
  const r = classifyDay(day({ events: io("08:40", "13:00") }));
  assert.equal(r.status, "LATE");
  assert.equal(r.lateMinutes, 40);
});

test("leaves before end − tolerance → EARLY_LEAVE", () => {
  const r = classifyDay(day({ events: io("07:55", "12:00") }));
  assert.equal(r.status, "EARLY_LEAVE");
  assert.equal(r.earlyMinutes, 60);
});

test("late and early → LATE_EARLY_LEAVE", () => {
  assert.equal(classifyDay(day({ events: io("09:00", "11:00") })).status, "LATE_EARLY_LEAVE");
});

test("no events → POSSIBLE_ABSENCE, never ABSENT (FR-ATT-10)", () => {
  const r = classifyDay(day());
  assert.equal(r.status, "POSSIBLE_ABSENCE");
  assert.equal(r.needsReview, true);
});

test("IN without OUT → INCOMPLETE and needs review (BR-05)", () => {
  const r = classifyDay(day({ events: [{ type: "IN", at: t("08:00") }] }));
  assert.equal(r.status, "INCOMPLETE");
  assert.equal(r.needsReview, true);
});

test("OUT without IN → INCOMPLETE", () => {
  assert.equal(classifyDay(day({ events: [{ type: "OUT", at: t("13:00") }] })).status, "INCOMPLETE");
});

test("events in any order are sorted before pairing", () => {
  const r = classifyDay(day({ events: [{ type: "OUT", at: t("13:00") }, { type: "IN", at: t("08:00") }] }));
  assert.equal(r.status, "PRESENT");
});

test("lateness during a recorded outage is not counted (FR-ATT-18)", () => {
  const r = classifyDay(day({ events: io("09:00", "13:00"), outages: [{ start: t("07:30"), end: t("08:50") }] }));
  assert.equal(r.status, "OUTAGE_EXEMPT");
  assert.equal(r.lateMinutes, 0);
});

test("no events but outage overlapping the day → OUTAGE_EXEMPT, still reviewed", () => {
  const r = classifyDay(day({ outages: [{ start: t("07:00"), end: t("10:00") }] }));
  assert.equal(r.status, "OUTAGE_EXEMPT");
  assert.equal(r.needsReview, true);
});

test("outage on another time does not hide lateness", () => {
  assert.equal(classifyDay(day({ events: io("09:00", "13:00"), outages: [{ start: t("11:00"), end: t("12:00") }] })).status, "LATE");
});

test("leave → EXCUSED even without events", () => {
  assert.equal(classifyDay(day({ onLeave: true })).status, "EXCUSED");
});

test("no scheduled duty → NO_DUTY", () => {
  assert.equal(classifyDay(day({ expected: null, events: io("08:00", "09:00") })).status, "NO_DUTY");
});

test("approved correction overrides everything", () => {
  const r = classifyDay(day({ correction: { status: "PRESENT" } }));
  assert.equal(r.status, "CORRECTED");
  assert.equal(r.correctedStatus, "PRESENT");
});

test("two sessions in one day: presence sums both, last OUT decides early leave", () => {
  const r = classifyDay(day({ events: [...io("08:00", "10:00"), ...io("10:30", "13:00")] }));
  assert.equal(r.status, "PRESENT");
  assert.equal(r.presenceMinutes, 270);
});

test("tolerance setting is respected", () => {
  assert.equal(classifyDay(day({ events: io("08:10", "13:00"), toleranceMinutes: 5 })).status, "LATE");
});

test("every result carries a reason (NFR-15)", () => {
  for (const input of [day(), day({ events: io("08:00", "13:00") }), day({ events: io("09:00", "13:00") })]) {
    assert.ok(classifyDay(input).reasons.length > 0);
  }
});
