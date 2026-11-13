import type { NextFunction, Request, Response, RequestHandler } from "express";

/** Throw inside a handler to send `{ success:false, message }` with this status. */
export class HttpError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Wraps async handlers: HttpError → its status, pg unique violation → 409, anything else → 500. */
export function handle<R extends Request>(
  fn: (req: R, res: Response) => Promise<unknown>
): RequestHandler {
  return (req: Request, res: Response, _next: NextFunction) => {
    fn(req as R, res).catch((error: unknown) => {
      // HttpError, ScopeError, or any Error carrying a numeric status
      if (error instanceof Error && typeof (error as { status?: unknown }).status === "number") {
        const e = error as HttpError;
        return res.status(e.status).json({ success: false, message: e.message, ...e.extra });
      }
      const pgCode = (error as { code?: string })?.code;
      if (pgCode === "23505") {
        return res.status(409).json({ success: false, message: "القيمة مستخدمة مسبقاً (رقم أو اسم مكرر)" });
      }
      if (pgCode === "23503" || pgCode === "23514") {
        return res.status(400).json({ success: false, message: "البيانات المدخلة غير صالحة أو مرتبطة بسجلات أخرى" });
      }
      console.error(error);
      return res.status(500).json({ success: false, message: "حدث خطأ غير متوقع في الخادم" });
    });
  };
}

export function requireString(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${label} مطلوب`);
  if (value.trim().length > max) throw new HttpError(400, `${label} طويل جداً`);
  return value.trim();
}

export function optionalString(value: unknown, max = 255): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "قيمة نصية غير صالحة");
  return value.trim().slice(0, max) || null;
}

export function requireId(value: unknown, label = "المعرّف"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${label} غير صالح`);
  return n;
}

export function optionalDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "صيغة التاريخ غير صحيحة (YYYY-MM-DD)");
  }
  return value;
}
