import { test } from "node:test";
import assert from "node:assert/strict";
import { needFactors, performanceFactors, rankSchools, type SchoolInput } from "./schoolPerformance.js";

const good: SchoolInput = {
  schoolId: 1, schoolName: "أ", attendanceRate: 100, possibleAbsenceRate: 0, quotaCompletion: 100, avgDaysToDecision: 0,
  overdueDays: 7, requestsOverdue: 0, staffShortage: 0, resultsAverage: 100, previousResultsAverage: 100,
};

test("perfect school → performance 100, need 0", () => {
  const [s] = rankSchools([good]);
  assert.equal(s!.performance, 100);
  assert.equal(s!.need, 0);
  assert.match(s!.reason, /لا نقاط ضعف/);
});

test("attendance at or below 80% contributes nothing; 90% is half", () => {
  assert.equal(performanceFactors({ ...good, attendanceRate: 75 }).factors[0]!.value, 0);
  assert.equal(performanceFactors({ ...good, attendanceRate: 90 }).factors[0]!.value, 0.5);
});

test("every factor stays in [0, 1] for extreme inputs", () => {
  const bad = { ...good, attendanceRate: 150, quotaCompletion: -20, avgDaysToDecision: 999, resultsAverage: 300, staffShortage: 99, possibleAbsenceRate: 500, requestsOverdue: -1, previousResultsAverage: -50 };
  for (const f of [...performanceFactors(bad).factors, ...needFactors(bad).factors]) {
    assert.ok(f.value == null || (f.value >= 0 && f.value <= 1), `${f.key}=${f.value}`);
  }
});

test("missing data is excluded and the remaining weights re-normalised", () => {
  const p = performanceFactors({ ...good, resultsAverage: null, avgDaysToDecision: null });
  assert.equal(p.score, 100);
  const used = p.factors.filter((f) => f.value != null).reduce((s, f) => s + f.weight, 0);
  assert.ok(Math.abs(used - 1) < 0.02);
  const [s] = rankSchools([{ ...good, resultsAverage: null }]);
  assert.match(s!.reason, /بدون بيانات: مستوى المحصّلات/);
});

test("results decline raises need only when a previous term exists (FR-ALG-08)", () => {
  assert.equal(needFactors({ ...good, resultsAverage: 70, previousResultsAverage: 80 }).factors[3]!.value, 1);
  assert.equal(needFactors({ ...good, resultsAverage: 85, previousResultsAverage: 80 }).factors[3]!.value, 0);
  assert.equal(needFactors({ ...good, previousResultsAverage: null }).factors[3]!.value, null);
});

test("ranking: higher performance first, ties broken by lower need, equal scores share a rank", () => {
  const weak = { ...good, schoolId: 2, schoolName: "ب", attendanceRate: 85, quotaCompletion: 60 };
  const needy = { ...good, schoolId: 3, schoolName: "ج", staffShortage: 2 };
  const twin = { ...good, schoolId: 4, schoolName: "د" };
  const r = rankSchools([weak, needy, good, twin]);
  assert.deepEqual(r.map((s) => s.schoolId), [1, 4, 3, 2]);
  assert.deepEqual(r.map((s) => s.rank), [1, 1, 3, 4]);
  assert.match(r[3]!.reason, /خفّض الأداء: الحضور/);
  assert.match(r[2]!.reason, /رفع الاحتياج: 2 طلب نقص/);
});

test("custom weights change the score (weights come from settings)", () => {
  const i = { ...good, attendanceRate: 80, quotaCompletion: 100, avgDaysToDecision: null, resultsAverage: null };
  assert.equal(performanceFactors(i, { attendance: 1, quota: 0, requests: 0, results: 0 }).score, 0);
  assert.equal(performanceFactors(i, { attendance: 0, quota: 1, requests: 0, results: 0 }).score, 100);
});
