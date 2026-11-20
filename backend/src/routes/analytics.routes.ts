import { Router } from "express";
import pool from "../config/database.js";
import { AuthRequest, authenticateToken, requireRole } from "../middleware/auth.middleware.js";
import { readableSchoolIds } from "../services/scope.service.js";
import { monthRange, parseMonth, todaySy } from "../services/reports.service.js";
import { attendanceAlerts, schoolScores } from "../services/analytics.service.js";
import { HttpError, handle } from "../utils/http.js";

// AI: school performance index & ranking (FR-DASH-07, FR-ALG-08) + attendance anomaly alerts (FR-ALG-07, 09, 11).
// Decision support only — nothing here changes any record (FR-ALG-10).
const router = Router();
router.use(authenticateToken);
const READERS = requireRole("MINISTRY_ADMIN", "DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY");

router.get(
  "/performance",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const u = req.user!;
    const range = monthRange(parseMonth(req.query.month));
    const isSchool = u.role === "SCHOOL_PRINCIPAL" || u.role === "SCHOOL_DEPUTY";
    // A school is ranked among the schools of its own directorate, but only sees its own breakdown.
    let ids = await readableSchoolIds(u);
    if (isSchool) {
      const r = await pool.query("SELECT id FROM schools WHERE directorate_id = (SELECT directorate_id FROM schools WHERE id = $1)", [u.schoolId]);
      ids = r.rows.map((x) => Number(x.id));
    }
    const data = await schoolScores(ids, range.from, range.to);
    const outOf = data.schools.length;
    if (isSchool) {
      const own = data.schools.find((s) => s.schoolId === u.schoolId);
      return res.json({ success: true, data: { ...data, schools: own ? [own] : [], outOf } });
    }
    res.json({ success: true, data: { ...data, outOf } });
  })
);

router.get(
  "/alerts",
  READERS,
  handle<AuthRequest>(async (req, res) => {
    const u = req.user!;
    const asOf = typeof req.query.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf) ? req.query.asOf : todaySy();
    if (asOf > todaySy()) throw new HttpError(400, "التاريخ في المستقبل");
    const ids = (await readableSchoolIds(u)) ?? (await pool.query("SELECT id FROM schools ORDER BY id")).rows.map((r) => Number(r.id));
    const result = await attendanceAlerts(ids, asOf);
    // Ministry: aggregates only (FR-AUTH-09) — school-level alerts in full, individual ones as counts per school.
    if (u.role === "MINISTRY_ADMIN") {
      const counts: Record<string, Record<string, number>> = {};
      for (const a of result.alerts.filter((x) => x.assignmentId != null)) {
        const c = (counts[a.schoolName] ??= {});
        c[a.type] = (c[a.type] ?? 0) + 1;
      }
      return res.json({ success: true, data: { asOf, alerts: result.alerts.filter((x) => x.assignmentId == null), individualCounts: counts } });
    }
    res.json({ success: true, data: result });
  })
);

export default router;
