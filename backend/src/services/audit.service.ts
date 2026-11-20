import type { Request } from "express";
import pool from "../config/database.js";

export type AuditAction =
  | "LOGIN"
  | "LOGIN_FAILED"
  | "ACCESS_DENIED"
  | "VIEW_TEACHER_REPORT"
  | "REPORT_APPROVE"
  | "REQUEST_STATUS_CHANGE"
  | "DATA_CREATE"
  | "DATA_UPDATE"
  | "USER_CREATE"
  | "USER_UPDATE";

interface AuditEntry {
  userId: number | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string | number;
  details?: Record<string, unknown>;
  req?: Request;
}

/** Writes one audit row. Never throws: an audit failure must not break the user's request. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.userId,
        entry.action,
        entry.entityType ?? null,
        entry.entityId != null ? String(entry.entityId) : null,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.req?.ip ?? null,
      ]
    );
  } catch (error) {
    console.error("Audit log write failed:", error);
  }
}
