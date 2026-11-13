import { useState, type FormEvent } from "react";
import { useApi } from "../hooks/useApi";
import { ApiError, apiFetch } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, DuplicateWarning, Field, Loading, PageHeader, SchoolPicker } from "../components/ui";

interface Employee {
  id: number;
  employee_number: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  hire_date: string | null;
  position_type: "TEACHER" | "PRINCIPAL" | "DEPUTY" | "ADMINISTRATIVE" | "SUPERVISOR";
  weekly_quota_units: string | null;
  specialization: string | null;
  qualification: string | null;
  years_of_experience: number | null;
  username: string | null;
}

const POSITION_LABELS: Record<string, string> = {
  TEACHER: "معلم", PRINCIPAL: "مدير", DEPUTY: "نائب مدير", ADMINISTRATIVE: "إداري", SUPERVISOR: "موجّه",
};

const empty = {
  fullName: "", employeeNumber: "", phone: "", email: "", hireDate: "", position: "TEACHER",
  specialization: "", qualification: "", yearsOfExperience: "0",
};

// FR-DATA-02 (teachers), FR-DATA-03 (admin staff — principal only), FR-DATA-06, FR-DATA-11 (directorate read-only)
function StaffPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "SCHOOL_PRINCIPAL";
  const [schoolId, setSchoolId] = useState<number | null>(user?.schoolId ?? null);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const { data, loading, error, reload } = useApi<Employee[]>(schoolId ? `/employees?schoolId=${schoolId}` : null);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [duplicates, setDuplicates] = useState<Employee[] | null>(null);
  const [msg, setMsg] = useState({ ok: "", err: "" });

  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  function startEdit(emp: Employee) {
    setForm({
      fullName: emp.full_name, employeeNumber: emp.employee_number, phone: emp.phone ?? "", email: emp.email ?? "",
      hireDate: emp.hire_date?.slice(0, 10) ?? "", position: emp.position_type,
      specialization: emp.specialization ?? "", qualification: emp.qualification ?? "",
      yearsOfExperience: String(emp.years_of_experience ?? 0),
    });
    setEditingId(emp.id);
    setShowForm(true);
    setDuplicates(null);
  }

  async function save(confirmDuplicate = false) {
    setMsg({ ok: "", err: "" });
    try {
      const r = await apiFetch<{ message: string }>(editingId ? `/employees/${editingId}` : "/employees", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify({ ...form, yearsOfExperience: Number(form.yearsOfExperience), confirmDuplicate }),
      });
      setMsg({ ok: r.message, err: "" });
      setShowForm(false);
      setDuplicates(null);
      setForm(empty);
      setEditingId(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && Array.isArray(err.body?.duplicates)) {
        setDuplicates(err.body.duplicates as Employee[]);
      } else {
        setMsg({ ok: "", err: (err as Error).message });
      }
    }
  }

  const rows = (data ?? []).filter(
    (e) => (filter === "ALL" || e.position_type === filter) &&
      (!search || e.full_name.includes(search) || e.employee_number.includes(search)),
  );

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader
        title="الكادر التدريسي والإداري"
        subtitle={canEdit ? "إدارة ملفات معلمي وموظفي مدرستك" : "عرض فقط"}
        actions={canEdit && (
          <button className="btn btn-primary" onClick={() => { setForm(empty); setEditingId(null); setShowForm((s) => !s); setDuplicates(null); }}>
            <i className="bi bi-person-plus ms-1"></i>موظف جديد
          </button>
        )}
      />
      <Alert kind="success">{msg.ok}</Alert>
      <Alert kind="danger">{msg.err || error}</Alert>

      {showForm && canEdit && (
        <form className="card border-0 shadow-sm rounded-4 mb-4" onSubmit={(e: FormEvent) => { e.preventDefault(); save(); }}>
          <div className="card-body row g-3">
            <h2 className="h6 fw-bold col-12 mb-0">{editingId ? "تعديل الملف" : "إضافة موظف"}</h2>
            <Field label="الاسم الكامل *"><input className="form-control" value={form.fullName} onChange={set("fullName")} required /></Field>
            <Field label="نوع الوظيفة *" col="col-md-3">
              <select className="form-select" value={form.position} onChange={set("position")} disabled={!!editingId}>
                <option value="TEACHER">معلم</option>
                <option value="ADMINISTRATIVE">إداري</option>
                <option value="DEPUTY">نائب مدير</option>
                <option value="SUPERVISOR">موجّه</option>
              </select>
            </Field>
            <Field label="الرقم الوظيفي" col="col-md-3">
              <input className="form-control" value={form.employeeNumber} onChange={set("employeeNumber")} placeholder="يُولّد تلقائياً" />
            </Field>
            <Field label="الهاتف" col="col-md-3"><input className="form-control" value={form.phone} onChange={set("phone")} /></Field>
            <Field label="البريد الإلكتروني" col="col-md-3"><input type="email" className="form-control" value={form.email} onChange={set("email")} /></Field>
            <Field label="تاريخ التعيين" col="col-md-3"><input type="date" className="form-control" value={form.hireDate} onChange={set("hireDate")} /></Field>
            {form.position === "TEACHER" && (
              <>
                <Field label="التخصص" col="col-md-3"><input className="form-control" value={form.specialization} onChange={set("specialization")} /></Field>
                <Field label="المؤهل العلمي" col="col-md-4"><input className="form-control" value={form.qualification} onChange={set("qualification")} /></Field>
                <Field label="سنوات الخبرة" col="col-md-2"><input type="number" min={0} max={60} className="form-control" value={form.yearsOfExperience} onChange={set("yearsOfExperience")} /></Field>
              </>
            )}
            {duplicates && (
              <div className="col-12">
                <DuplicateWarning duplicates={duplicates} onConfirm={() => save(true)} onCancel={() => setDuplicates(null)} />
              </div>
            )}
            <div className="col-12 d-flex gap-2">
              <button className="btn btn-primary">حفظ</button>
              <button type="button" className="btn btn-outline-secondary" onClick={() => setShowForm(false)}>إلغاء</button>
            </div>
          </div>
        </form>
      )}

      <div className="d-flex flex-wrap gap-2 mb-3">
        <SchoolPicker value={schoolId} onChange={setSchoolId} />
        <select className="form-select" style={{ maxWidth: 180 }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="نوع الوظيفة">
          <option value="ALL">كل الوظائف</option>
          {Object.entries(POSITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="form-control" style={{ maxWidth: 260 }} placeholder="بحث بالاسم أو الرقم..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="card border-0 shadow-sm rounded-4">
        {!schoolId ? <p className="text-secondary p-4 mb-0">اختر مدرسة لعرض كادرها.</p> : loading ? <Loading /> : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr><th>الرقم</th><th>الاسم</th><th>الوظيفة</th><th>التخصص</th><th>النصاب</th><th>الهاتف</th><th>الحساب</th>{canEdit && <th></th>}</tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="text-secondary small">{e.employee_number}</td>
                    <td className="fw-semibold">{e.full_name}</td>
                    <td>{POSITION_LABELS[e.position_type]}</td>
                    <td>{e.specialization ?? "—"}</td>
                    <td>{e.weekly_quota_units ? Number(e.weekly_quota_units) : "—"}</td>
                    <td dir="ltr" className="text-end">{e.phone}</td>
                    <td>{e.username ? <span className="badge text-bg-light border">{e.username}</span> : <span className="text-secondary small">لا يوجد</span>}</td>
                    {canEdit && (
                      <td>{e.position_type !== "PRINCIPAL" && <button className="btn btn-sm btn-outline-primary" onClick={() => startEdit(e)}>تعديل</button>}</td>
                    )}
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="text-center text-secondary py-4">لا توجد نتائج</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default StaffPage;
