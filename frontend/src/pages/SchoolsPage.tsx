import { useState, type FormEvent } from "react";
import { useApi } from "../hooks/useApi";
import { apiFetch } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, Field, Loading, PageHeader } from "../components/ui";
import { STAGE_LABELS } from "../config/labels";

interface School {
  id: number;
  name: string;
  school_code: string | null;
  address: string | null;
  phone: string | null;
  stage: number;
  is_active: boolean;
  directorate_id: number;
  directorate_name: string;
  employees_count: number;
  students_count: number;
}

const empty = { name: "", schoolCode: "", address: "", phone: "", stage: "", directorateId: "", isActive: true };

// FR-DATA-01
function SchoolsPage() {
  const { user } = useAuth();
  const isMinistry = user?.role === "MINISTRY_ADMIN";
  const { data, loading, error, reload } = useApi<School[]>("/schools");
  const directorates = useApi<{ id: number; name: string }[]>(isMinistry ? "/schools/directorates" : null);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState({ ok: "", err: "" });
  const [saving, setSaving] = useState(false);

  function startEdit(s: School) {
    setForm({
      name: s.name, schoolCode: s.school_code ?? "", address: s.address ?? "", phone: s.phone ?? "",
      stage: String(s.stage), directorateId: String(s.directorate_id), isActive: s.is_active,
    });
    setEditingId(s.id);
    setShowForm(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg({ ok: "", err: "" });
    try {
      const body = JSON.stringify({ ...form, stage: Number(form.stage), directorateId: form.directorateId ? Number(form.directorateId) : undefined });
      const r = await apiFetch<{ message: string }>(editingId ? `/schools/${editingId}` : "/schools", {
        method: editingId ? "PUT" : "POST",
        body,
      });
      setMsg({ ok: r.message, err: "" });
      setForm(empty);
      setEditingId(null);
      setShowForm(false);
      reload();
    } catch (err) {
      setMsg({ ok: "", err: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader
        title="المدارس"
        subtitle={isMinistry ? "جميع مدارس الوزارة" : "مدارس مديريتك"}
        actions={
          <button className="btn btn-primary" onClick={() => { setForm(empty); setEditingId(null); setShowForm((s) => !s); }}>
            <i className="bi bi-plus-lg ms-1"></i>مدرسة جديدة
          </button>
        }
      />
      <Alert kind="success">{msg.ok}</Alert>
      <Alert kind="danger">{msg.err || error}</Alert>

      {showForm && (
        <form className="card border-0 shadow-sm rounded-4 mb-4" onSubmit={save}>
          <div className="card-body row g-3">
            <h2 className="h6 fw-bold col-12 mb-0">{editingId ? "تعديل المدرسة" : "إضافة مدرسة"}</h2>
            <Field label="اسم المدرسة *"><input className="form-control" value={form.name} onChange={set("name")} required /></Field>
            <Field label="رمز المدرسة" col="col-md-3"><input className="form-control" value={form.schoolCode} onChange={set("schoolCode")} /></Field>
            <Field label="الهاتف" col="col-md-3"><input className="form-control" value={form.phone} onChange={set("phone")} /></Field>
            <Field label="العنوان"><input className="form-control" value={form.address} onChange={set("address")} /></Field>
            <Field label="الحلقة *" col="col-md-3">
              <select className="form-select" value={form.stage} onChange={set("stage")} required>
                <option value="">اختر...</option>
                {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            {isMinistry && (
              <Field label="المديرية *" col="col-md-3">
                <select className="form-select" value={form.directorateId} onChange={set("directorateId")} required>
                  <option value="">اختر...</option>
                  {directorates.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
            )}
            {editingId && (
              <div className="col-12 form-check ms-2">
                <input id="active" type="checkbox" className="form-check-input" checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                <label htmlFor="active" className="form-check-label">مدرسة فعّالة</label>
              </div>
            )}
            <div className="col-12 d-flex gap-2">
              <button className="btn btn-primary" disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</button>
              <button type="button" className="btn btn-outline-secondary" onClick={() => setShowForm(false)}>إلغاء</button>
            </div>
          </div>
        </form>
      )}

      <div className="card border-0 shadow-sm rounded-4">
        {loading ? <Loading /> : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr><th>المدرسة</th><th>الرمز</th><th>الحلقة</th><th>المديرية</th><th>الموظفون</th><th>الطلاب</th><th>الحالة</th><th></th></tr>
              </thead>
              <tbody>
                {data?.map((s) => (
                  <tr key={s.id}>
                    <td className="fw-semibold">{s.name}<div className="small text-secondary">{s.address}</div></td>
                    <td>{s.school_code}</td>
                    <td>{STAGE_LABELS[s.stage]}</td>
                    <td>{s.directorate_name}</td>
                    <td>{s.employees_count}</td>
                    <td>{s.students_count}</td>
                    <td>{s.is_active ? <span className="badge text-bg-success">فعّالة</span> : <span className="badge text-bg-secondary">موقوفة</span>}</td>
                    <td><button className="btn btn-sm btn-outline-primary" onClick={() => startEdit(s)}>تعديل</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default SchoolsPage;
