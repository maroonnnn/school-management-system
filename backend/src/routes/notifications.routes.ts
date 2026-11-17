import { Router } from "express";
import pool from "../config/database.js";
import { AuthRequest, authenticateToken } from "../middleware/auth.middleware.js";
import { handle, requireId } from "../utils/http.js";

// FR-REQ-14: school / directorate inbox notifications (base for the MSG module).
// A school's notifications are shared by its principal and deputy; read state is per user.
const router = Router();
router.use(authenticateToken);

function target(u: AuthRequest["user"]): { sql: string; param: number } | null {
  if (!u) return null;
  if (u.role === "SCHOOL_PRINCIPAL" || u.role === "SCHOOL_DEPUTY") return { sql: "n.school_id = $1", param: u.schoolId! };
  if (u.role === "DIRECTORATE_ADMIN") return { sql: "n.directorate_id = $1", param: u.directorateId! };
  return null;
}

router.get(
  "/",
  handle<AuthRequest>(async (req, res) => {
    const t = target(req.user);
    if (!t) return res.json({ success: true, data: { items: [], unread: 0 } });
    const r = await pool.query(
      `SELECT n.id, n.title, n.body, n.link, to_char(n.created_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD HH24:MI') AS at,
              (nr.user_id IS NOT NULL) AS read
         FROM notifications n LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = $2
        WHERE ${t.sql} ORDER BY n.created_at DESC LIMIT 30`,
      [t.param, req.user!.id]
    );
    const unread = await pool.query(
      `SELECT COUNT(*)::int AS n FROM notifications n
        WHERE ${t.sql} AND NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = $2)`,
      [t.param, req.user!.id]
    );
    res.json({ success: true, data: { items: r.rows, unread: unread.rows[0].n } });
  })
);

router.post(
  "/:id/read",
  handle<AuthRequest>(async (req, res) => {
    await pool.query(
      "INSERT INTO notification_reads (notification_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [requireId(req.params.id), req.user!.id]
    );
    res.json({ success: true });
  })
);

router.post(
  "/read-all",
  handle<AuthRequest>(async (req, res) => {
    const t = target(req.user);
    if (t) {
      await pool.query(
        `INSERT INTO notification_reads (notification_id, user_id)
         SELECT n.id, $2 FROM notifications n WHERE ${t.sql} ON CONFLICT DO NOTHING`,
        [t.param, req.user!.id]
      );
    }
    res.json({ success: true });
  })
);

export default router;
