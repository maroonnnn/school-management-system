import { useState, type ChangeEvent, type FormEvent } from "react";
import { useApi } from "../hooks/useApi";
import { API_BASE, apiFetch, getToken } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, Field, Loading } from "./ui";
import { REQUEST_STATUS, REQUEST_TYPE } from "../config/labels";
import { roleLabels, type Role } from "../types/auth";

interface Detail {
  id: number; request_number: string; school_name: string; request_type: string; title: string; description: string;
  status: string; severity: number; affected_students: number; created_by_name: string; assigned_department: string | null;
  assigned_to_name: string | null; target_employee_name: string | null; target_employee_number: string | null;
  priority: number | null; priority_reason: string | null; overdue: boolean;
  history: { old_status: string | null; new_status: string; notes: string | null; by_name: string; by_role: Role; at: string }[];
  comments: { id: number; body: string; by_name: string; by_role: Role; at: string }[];
  attachments: { id: number; file_name: string; file_type: string; file_size: number; by_name: string; at: string }[];
}

/** Which action buttons each side sees, per status (mirrors backend TRANSITIONS). */
const ACTIONS: { action: string; label: string; from: string[]; side: "SCHOOL" | "DIRECTORATE"; note?: string; cls: string }[] = [
  { action: "submit", label: "تقديم للمديرية", from: ["DRAFT"], side: "SCHOOL", cls: "btn-primary" },
  { action: "reply", label: "إرسال التوضيح", from: ["RETURNED"], side: "SCHOOL", note: "ردّ المدرسة على طلب التوضيح:", cls: "btn-primary" },
  { action: "confirm", label: "تأكيد استلام التنفيذ وإغلاق الطلب", from: ["COMPLETED"], side: "SCHOOL", cls: "btn-success" },
  { action: "review", label: "بدء المراجعة", from: ["SUBMITTED"], side: "DIRECTORATE", cls: "btn-outline-primary" },
  { action: "approve", label: "قبول", from: ["SUBMITTED", "UNDER_REVIEW"], side: "DIRECTORATE", cls: "btn-success" },
  { action: "return", label: "إعادة للتوضيح", from: ["SUBMITTED", "UNDER_REVIEW"], side: "DIRECTORATE", note: "ما المطلوب توضيحه من المدرسة؟", cls: "btn-outline-warning" },
  { action: "reject", label: "رفض", from: ["SUBMITTED", "UNDER_REVIEW"], side: "DIRECTORATE", note: "سبب الرفض (إلزامي):", cls: "btn-outline-danger" },
  { action: "start", label: "بدء التنفيذ", from: ["APPROVED"], side: "DIRECTORATE", cls: "btn-outline-primary" },
  { action: "complete", label: "تم التنفيذ", from: ["APPROVED", "IN_PROGRESS"], side: "DIRECTORATE", cls: "btn-success" },
];
const MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

export default function RequestDetail({ id, onChanged, onClose }: { id: number; onChanged: () => void; onClose: () => void }) {
  const { user } = useAuth();
  const side = user?.role === "DIRECTORATE_ADMIN" ? "DIRECTORATE" : "SCHOOL";
  const d = useApi<Detail>(`/requests/${id}`);
  const staff = useApi<{ id: number; full_name: string }[]>(side === "DIRECTORATE" ? "/requests/meta/directorate-staff" : null);
  const [msg, setMsg] = useState({ ok: "", err: "" });
  const [comment, setComment] = useState("");
  const [assign, setAssign] = useState({ department: "", assignedTo: "" });
  const [account, setAccount] = useState({ employeeNumber: "", password: "" });

  async function run(fn: () => Promise<{ message: string }>) {
    setMsg({ ok: "", err: "" });
    try {
      const r = await fn();
      setMsg({ ok: r.message, err: "" });
      d.reload();
      onChanged();
      return true;
    } catch (e) {
      setMsg({ ok: "", err: (e as Error).message });
      return false;
    }
  }
  const post = (path: string, body: object = {}, method = "POST") => apiFetch<{ message: string }>(path, { method, body: JSON.stringify(body) });

  function act(a: (typeof ACTIONS)[number]) {
    let note: string | null = null;
    if (a.note) {
      note = window.prompt(a.note);
      if (!note?.trim()) return;
    }
    void run(() => post(`/requests/${id}/actions/${a.action}`, { note }));
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (file.size > 4 * 1024 * 1024) return setMsg({ ok: "", err: "حجم الملف أكبر من 4 ميغابايت" });
    const dataBase64 = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });
    void run(() => post(`/requests/${id}/attachments`, { fileName: file.name, mimeType: file.type || MIME[ext] || "", dataBase64 }));
  }

  async function download(fileId: number, name: string) {
    const r = await fetch(`${API_BASE}/requests/${id}/attachments/${fileId}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!r.ok) return setMsg({ ok: "", err: "تعذّر تنزيل المرفق" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob());
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const r = d.data;
  if (!r) return <div className="card border-0 shadow-sm rounded-4"><div className="card-body">{d.error ? <Alert kind="danger">{d.error}</Alert> : <Loading />}</div></div>;

  // One timeline: status changes + comments, in time order (FR-REQ-13, FR-MSG-11)
  const timeline = [
    ...r.history.map((h) => ({ at: h.at, kind: "status" as const, by: h.by_name, role: h.by_role, status: h.new_status, text: h.notes })),
    ...r.comments.map((c) => ({ at: c.at, kind: "comment" as const, by: c.by_name, role: c.by_role, status: null, text: c.body })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const actions = ACTIONS.filter((a) => a.side === side && a.from.includes(r.status))
    .filter((a) => !(a.action === "complete" && r.request_type === "TEACHER_ACCOUNT"));
  const closed = ["CLOSED", "REJECTED"].includes(r.status);

  return (
    <div className="card border-0 shadow-sm rounded-4">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-start mb-2">
          <div>
            <div className="small text-secondary">{r.request_number} · {r.school_name}</div>
            <h2 className="h5 fw-bold brand-title mb-1">{r.title}</h2>
            <span className={`badge ${REQUEST_STATUS[r.status]?.cls} ms-1`}>{REQUEST_STATUS[r.status]?.label}</span>
            <span className="badge text-bg-light border ms-1">{REQUEST_TYPE[r.request_type]}</span>
            {r.overdue && <span className="badge text-bg-danger">متأخر</span>}
          </div>
          <button className="btn-close" aria-label="إغلاق" onClick={onClose}></button>
        </div>
        <Alert kind="success">{msg.ok}</Alert>
        <Alert kind="danger">{msg.err}</Alert>

        {r.priority !== null && side === "DIRECTORATE" && (
          <div className="p-2 rounded-3 mb-3" style={{ background: "var(--brand-gold-50)" }}>
            <div className="d-flex align-items-center gap-2 mb-1">
              <span className="fw-bold">الأولوية {r.priority}/100</span>
              <div className="progress-brand flex-grow-1"><span style={{ width: `${r.priority}%` }}></span></div>
            </div>
            <div className="small">{r.priority_reason}</div>
            <div className="small text-secondary">أداة مساعدة للترتيب فقط — القرار للمديرية.</div>
          </div>
        )}

        <p className="mb-2" style={{ whiteSpace: "pre-wrap" }}>{r.description}</p>
        <div className="small text-secondary mb-3 d-flex flex-wrap gap-3">
          <span>الخطورة: {r.severity}/5</span>
          <span>طلاب متأثرون: {r.affected_students}</span>
          <span>مقدّم الطلب: {r.created_by_name}</span>
          {r.target_employee_name && <span>الحساب لـ: {r.target_employee_name}</span>}
          {(r.assigned_department || r.assigned_to_name) && <span>مُحوّل إلى: {[r.assigned_department, r.assigned_to_name].filter(Boolean).join(" — ")}</span>}
        </div>

        {actions.length > 0 && (
          <div className="d-flex flex-wrap gap-2 mb-3">
            {actions.map((a) => <button key={a.action} className={`btn btn-sm ${a.cls}`} onClick={() => act(a)}>{a.label}</button>)}
          </div>
        )}

        {side === "DIRECTORATE" && r.request_type === "TEACHER_ACCOUNT" && ["APPROVED", "IN_PROGRESS"].includes(r.status) && (
          <form className="row g-2 p-3 mb-3 rounded-3 bg-light" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => post(`/requests/${id}/create-account`, account)); }}>
            <h3 className="h6 fw-bold col-12 mb-0">إنشاء حساب المعلم: {r.target_employee_name}</h3>
            <Field label="الرقم الوظيفي (التسلسلي) *" col="col-md-5"><input className="form-control form-control-sm" dir="ltr" value={account.employeeNumber} onChange={(e) => setAccount({ ...account, employeeNumber: e.target.value })} required placeholder="EMP-5001" /></Field>
            <Field label="كلمة المرور الأولية *" col="col-md-5"><input type="text" className="form-control form-control-sm" dir="ltr" minLength={8} value={account.password} onChange={(e) => setAccount({ ...account, password: e.target.value })} required autoComplete="off" /></Field>
            <div className="col-md-2 d-flex align-items-end"><button className="btn btn-sm btn-success w-100">إنشاء</button></div>
            <div className="col-12 small text-secondary">اسم المستخدم سيكون t + أرقام الرقم الوظيفي. كلمة المرور لا تُحفظ ولا تُعرض مرة أخرى — سلّمها للمعلم بشكل آمن.</div>
          </form>
        )}

        {side === "DIRECTORATE" && !closed && (
          <form className="row g-2 mb-3" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => post(`/requests/${id}/assign`, { department: assign.department || null, assignedTo: assign.assignedTo || null }, "PUT")); }}>
            <Field label="تحويل إلى قسم" col="col-md-5"><input className="form-control form-control-sm" value={assign.department} onChange={(e) => setAssign({ ...assign, department: e.target.value })} placeholder="مثال: قسم الأبنية المدرسية" /></Field>
            <Field label="أو موظف" col="col-md-5">
              <select className="form-select form-select-sm" value={assign.assignedTo} onChange={(e) => setAssign({ ...assign, assignedTo: e.target.value })}>
                <option value="">—</option>
                {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </Field>
            <div className="col-md-2 d-flex align-items-end"><button className="btn btn-sm btn-outline-primary w-100">تحويل</button></div>
          </form>
        )}

        <h3 className="h6 fw-bold mt-2">سجل الطلب</h3>
        <ul className="list-unstyled small border-start ps-3 mb-3" style={{ borderColor: "var(--brand-gold-500) !important" }}>
          {timeline.map((t, i) => (
            <li key={i} className="mb-2">
              <span className="text-secondary">{t.at}</span> · <span className="fw-semibold">{t.by}</span> <span className="text-secondary">({roleLabels[t.role] ?? t.role})</span>
              {t.kind === "status"
                ? <> — <span className={`badge ${REQUEST_STATUS[t.status!]?.cls}`}>{REQUEST_STATUS[t.status!]?.label}</span>{t.text && <div className="mt-1">«{t.text}»</div>}</>
                : <div className="mt-1 p-2 rounded-2 bg-light"><i className="bi bi-chat-left-text ms-1"></i>{t.text}</div>}
            </li>
          ))}
        </ul>

        <h3 className="h6 fw-bold">المرفقات</h3>
        <ul className="list-unstyled small mb-2">
          {r.attachments.map((a) => (
            <li key={a.id}>
              <button className="btn btn-link btn-sm p-0" onClick={() => download(a.id, a.file_name)}><i className="bi bi-paperclip"></i> {a.file_name}</button>
              <span className="text-secondary"> · {Math.ceil(a.file_size / 1024)} KB · {a.by_name}</span>
            </li>
          ))}
          {r.attachments.length === 0 && <li className="text-secondary">لا توجد مرفقات</li>}
        </ul>
        {!closed && (
          <label className="btn btn-sm btn-outline-secondary mb-3">
            <i className="bi bi-upload ms-1"></i>إرفاق ملف (PDF، صورة، Word ≤ 4MB)
            <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.docx" onChange={upload} />
          </label>
        )}

        {!closed && r.status !== "DRAFT" && (
          <form className="d-flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => post(`/requests/${id}/comments`, { body: comment })).then((ok) => ok && setComment("")); }}>
            <input className="form-control form-control-sm" placeholder="أضف تعليقاً..." value={comment} onChange={(e) => setComment(e.target.value)} required />
            <button className="btn btn-sm btn-primary text-nowrap">إرسال</button>
          </form>
        )}
      </div>
    </div>
  );
}
