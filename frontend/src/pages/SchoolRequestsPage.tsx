import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { apiFetch } from "../services/api";
import { Alert, Field, Loading, PageHeader } from "../components/ui";
import RequestDetail from "../components/RequestDetail";
import { REQUEST_STATUS, REQUEST_TYPE } from "../config/labels";

export interface RequestRow {
  id: number; request_number: string; school_name: string; request_type: string; title: string; status: string;
  severity: number; affected_students: number; submitted_date: string | null; updated_at: string; waiting_days: number;
  priority: number | null; priority_reason: string | null; overdue: boolean; assigned_department: string | null;
}

const empty = { requestType: "MAINTENANCE", title: "", description: "", severity: "3", affectedStudents: "0", targetEmployeeId: "" };

// FR-REQ-01..03, 11, 13 — the school's own requests (principal / authorised deputy)
function SchoolRequestsPage() {
  const [params, setParams] = useSearchParams();
  const openId = params.get("open") ? Number(params.get("open")) : null;
  const [status, setStatus] = useState("");
  const list = useApi<RequestRow[]>(`/requests${status ? `?status=${status}` : ""}`);
  const teachers = useApi<{ id: number; full_name: string; employee_number: string }[]>("/requests/meta/teachers-without-account");
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState({ ok: "", err: "" });
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function create(e: FormEvent) {
    e.preventDefault();
    setMsg({ ok: "", err: "" });
    try {
      const r = await apiFetch<{ message: string; data: { id: number } }>("/requests", {
        method: "POST",
        body: JSON.stringify({ ...form, severity: Number(form.severity), affectedStudents: Number(form.affectedStudents), targetEmployeeId: form.targetEmployeeId || null }),
      });
      setMsg({ ok: `${r.message} — راجعها ثم اضغط «تقديم للمديرية»`, err: "" });
      setShowForm(false);
      setForm(empty);
      list.reload();
      teachers.reload();
      setParams({ open: String(r.data.id) });
    } catch (err) {
      setMsg({ ok: "", err: (err as Error).message });
    }
  }

  const isAccount = form.requestType === "TEACHER_ACCOUNT";

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader
        title="طلبات المدرسة"
        subtitle="تقديم الطلبات للمديرية ومتابعة حالتها برقمها المرجعي"
        actions={<button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}><i className="bi bi-plus-lg ms-1"></i>طلب جديد</button>}
      />
      <Alert kind="success">{msg.ok}</Alert>
      <Alert kind="danger">{msg.err || list.error}</Alert>

      {showForm && (
        <form className="card border-0 shadow-sm rounded-4 mb-3" onSubmit={create}>
          <div className="card-body row g-3">
            <Field label="نوع الطلب *" col="col-md-4">
              <select className="form-select" value={form.requestType} onChange={(e) => setForm({ ...form, requestType: e.target.value, title: e.target.value === "TEACHER_ACCOUNT" ? "إنشاء حساب معلم" : form.title })}>
                {Object.entries(REQUEST_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            {isAccount && (
              <Field label="المعلم *" col="col-md-8">
                <select className="form-select" value={form.targetEmployeeId} onChange={set("targetEmployeeId")} required>
                  <option value="">اختر معلماً بلا حساب...</option>
                  {teachers.data?.map((t) => <option key={t.id} value={t.id}>{t.full_name} ({t.employee_number})</option>)}
                </select>
                <div className="small text-secondary mt-1">المديرية تعطي الرقم الوظيفي وكلمة المرور عند التنفيذ.</div>
              </Field>
            )}
            <Field label="العنوان *" col={isAccount ? "col-12" : "col-md-8"}><input className="form-control" value={form.title} onChange={set("title")} required maxLength={200} /></Field>
            <Field label="الوصف *" col="col-12"><textarea className="form-control" rows={3} value={form.description} onChange={set("description")} required /></Field>
            {!isAccount && (
              <>
                <Field label="الخطورة (1 منخفضة – 5 حرجة)" col="col-md-4">
                  <select className="form-select" value={form.severity} onChange={set("severity")}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </Field>
                <Field label="عدد الطلاب المتأثرين" col="col-md-4"><input type="number" min={0} className="form-control" value={form.affectedStudents} onChange={set("affectedStudents")} /></Field>
              </>
            )}
            <div className="col-12 d-flex gap-2"><button className="btn btn-primary">حفظ كمسودة</button><button type="button" className="btn btn-outline-secondary" onClick={() => setShowForm(false)}>إلغاء</button></div>
          </div>
        </form>
      )}

      <div className="d-flex flex-wrap gap-2 mb-3">
        {["", "DRAFT", "SUBMITTED", "UNDER_REVIEW", "RETURNED", "APPROVED", "IN_PROGRESS", "COMPLETED", "CLOSED", "REJECTED"].map((s) => (
          <button key={s} className={`btn btn-sm ${status === s ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setStatus(s)}>
            {s ? REQUEST_STATUS[s].label : "الكل"}
          </button>
        ))}
      </div>

      <div className="row g-3">
        <div className={openId ? "col-xl-5" : "col-12"}>
          <div className="card border-0 shadow-sm rounded-4">
            {list.loading && !list.data ? <Loading /> : (
              <div className="list-group list-group-flush rounded-4">
                {list.data?.map((r) => (
                  <button key={r.id} type="button" onClick={() => setParams({ open: String(r.id) })}
                    className={`list-group-item list-group-item-action py-3 ${Number(r.id) === openId ? "active" : ""}`}>
                    <div className="d-flex justify-content-between gap-2">
                      <span className="fw-semibold">{r.title}</span>
                      <span className={`badge ${REQUEST_STATUS[r.status]?.cls}`}>{REQUEST_STATUS[r.status]?.label}</span>
                    </div>
                    <div className={`small ${Number(r.id) === openId ? "" : "text-secondary"}`}>
                      {r.request_number} · {REQUEST_TYPE[r.request_type]} · آخر تحديث {r.updated_at}
                      {r.status === "RETURNED" && <strong> — بانتظار ردّك</strong>}
                      {r.status === "COMPLETED" && <strong> — بانتظار تأكيد الاستلام</strong>}
                    </div>
                  </button>
                ))}
                {list.data?.length === 0 && <p className="text-secondary p-4 mb-0">لا توجد طلبات.</p>}
              </div>
            )}
          </div>
        </div>
        {openId && (
          <div className="col-xl-7">
            <RequestDetail key={openId} id={openId} onChanged={() => { list.reload(); teachers.reload(); }} onClose={() => setParams({})} />
          </div>
        )}
      </div>
    </div>
  );
}

export default SchoolRequestsPage;
