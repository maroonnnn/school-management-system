import type { ReactNode } from "react";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../context/AuthContext";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-4">
      <div>
        <h1 className="h4 page-title mb-1">{title}</h1>
        <span className="gold-rule mb-2"></span>
        {subtitle && <p className="text-secondary mb-0">{subtitle}</p>}
      </div>
      {actions && <div className="d-flex gap-2">{actions}</div>}
    </div>
  );
}

export function Alert({ kind, children }: { kind: "danger" | "success" | "warning" | "info"; children: ReactNode }) {
  if (!children) return null;
  return <div className={`alert alert-${kind} py-2`} role={kind === "danger" ? "alert" : "status"}>{children}</div>;
}

export function Loading() {
  return (
    <div className="text-center text-secondary py-4">
      <span className="spinner-border spinner-border-sm ms-2"></span>جارٍ التحميل...
    </div>
  );
}

export function Field({ label, children, col = "col-md-6" }: { label: string; children: ReactNode; col?: string }) {
  return (
    <div className={col}>
      <label className="form-label fw-semibold small mb-1">{label}</label>
      {children}
    </div>
  );
}

export interface SchoolOption {
  id: number;
  name: string;
}

/** For directorate/ministry users: choose a school. School users don't see it (their school is implied). */
export function SchoolPicker({ value, onChange }: { value: number | null; onChange: (id: number) => void }) {
  const { user } = useAuth();
  const needsPicker = user?.role === "DIRECTORATE_ADMIN" || user?.role === "MINISTRY_ADMIN";
  const { data } = useApi<SchoolOption[]>(needsPicker ? "/schools" : null);
  if (!needsPicker) return null;
  return (
    <select
      className="form-select"
      style={{ maxWidth: 320 }}
      value={value ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="المدرسة"
    >
      <option value="" disabled>اختر المدرسة...</option>
      {data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

/** Shows the duplicate-record warning (FR-DATA-06) and lets the user confirm. */
export function DuplicateWarning({
  duplicates, onConfirm, onCancel,
}: {
  duplicates: { id: number; full_name: string; employee_number?: string; student_number?: string }[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="alert alert-warning">
      <div className="fw-semibold mb-2"><i className="bi bi-exclamation-triangle ms-1"></i>يوجد سجل مشابه — قد يكون مكرراً:</div>
      <ul className="mb-2">
        {duplicates.map((d) => (
          <li key={d.id}>{d.full_name} ({d.employee_number ?? d.student_number})</li>
        ))}
      </ul>
      <button type="button" className="btn btn-sm btn-warning ms-2" onClick={onConfirm}>متابعة الحفظ رغم ذلك</button>
      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onCancel}>إلغاء</button>
    </div>
  );
}
