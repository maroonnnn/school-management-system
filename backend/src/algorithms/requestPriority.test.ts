import { test } from "node:test";
import assert from "node:assert/strict";
import { computePriority, normaliseFactors, DEFAULT_WEIGHTS, type PriorityInput } from "./requestPriority.js";

const base: PriorityInput = {
  severity: 1, affectedStudents: 0, schoolStudents: 150, waitingDays: 0, overdueDays: 7,
  schoolAbsenceRate: 0, schoolOpenRequests: 0, sameTypeRecent: 0,
};

test("minimum inputs → score 0 with a low-priority reason", () => {
  const r = computePriority(base);
  assert.equal(r.score, 0);
  assert.match(r.reason, /منخفضة/);
});

test("maximum inputs → score 100", () => {
  const r = computePriority({ ...base, severity: 5, affectedStudents: 150, waitingDays: 30, schoolAbsenceRate: 0.5, schoolOpenRequests: 9, sameTypeRecent: 5 });
  assert.equal(r.score, 100);
});

test("every factor is normalised into [0, 1] (FR-ALG-02)", () => {
  const f = normaliseFactors({ ...base, severity: 9, affectedStudents: 9999, waitingDays: -3, schoolAbsenceRate: 7, schoolOpenRequests: -1, sameTypeRecent: 100 });
  for (const v of Object.values(f)) assert.ok(v >= 0 && v <= 1, String(v));
});

test("severity alone contributes its weight (30)", () => {
  assert.equal(computePriority({ ...base, severity: 5 }).score, 30);
});

test("waiting time raises priority over time — so it must not be stored (FR-ALG-04)", () => {
  const day1 = computePriority({ ...base, severity: 3, waitingDays: 1 }).score;
  const day10 = computePriority({ ...base, severity: 3, waitingDays: 10 }).score;
  assert.ok(day10 > day1);
});

test("overdue flag after the threshold (FR-REQ-16)", () => {
  assert.equal(computePriority({ ...base, waitingDays: 7 }).overdue, false);
  assert.equal(computePriority({ ...base, waitingDays: 8 }).overdue, true);
  assert.equal(computePriority({ ...base, waitingDays: 8, overdueDays: 10 }).overdue, false);
});

test("custom weights are respected and renormalised (FR-REQ-16)", () => {
  const onlySeverity = { ...DEFAULT_WEIGHTS, affected: 0, waiting: 0, fragility: 0, repetition: 0 };
  assert.equal(computePriority({ ...base, severity: 5, waitingDays: 30 }, onlySeverity).score, 100);
  const doubled = { severity: 0.6, affected: 0.4, waiting: 0.4, fragility: 0.3, repetition: 0.3 };
  const input = { ...base, severity: 4, affectedStudents: 40, waitingDays: 5 };
  assert.equal(computePriority(input, doubled).score, computePriority(input).score);
});

test("reason names the factors that raised the score, largest first (FR-ALG-03)", () => {
  const r = computePriority({ ...base, severity: 5, waitingDays: 14, sameTypeRecent: 1 });
  assert.match(r.reason, /^رفع الأولوية: خطورة 5 من 5/);
  assert.match(r.reason, /ينتظر منذ 14 يوماً/);
  assert.match(r.reason, /متأخر/);
});

test("affected students are relative to school size", () => {
  const small = computePriority({ ...base, affectedStudents: 50, schoolStudents: 100 }).score;
  const big = computePriority({ ...base, affectedStudents: 50, schoolStudents: 1000 }).score;
  assert.ok(small > big);
});

test("factor contributions add up to the score", () => {
  const r = computePriority({ ...base, severity: 3, affectedStudents: 30, waitingDays: 4, schoolAbsenceRate: 0.03, schoolOpenRequests: 2, sameTypeRecent: 1 });
  assert.equal(Math.round(r.factors.reduce((s, f) => s + f.contribution, 0)), r.score);
});
