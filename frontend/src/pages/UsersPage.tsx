import { useEffect, useState, type FormEvent } from "react";
import { useApi } from "../hooks/useApi";
import { apiFetch } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, Field, Loading, PageHeader } from "../components/ui";
import { roleLabels, type Role } from "../types/auth";

interface Account {
  id: number;
  full_name: string;
  username: string;
  email: string | null;
  is_active: boolean;
  last_login_at: string | null;
  role: Role;
  school_name: string | null;
  employee_number: string | null;
}
interface Linkable { id: number; employee_number: string; full_name: string; position_type: string }

const empty = { role: "", username: "", password: "", fullName: "", email: "", schoolId: "", directorateId: "", employeeId: "" };

// FR-AUTH-05: create/disable accounts and assign roles
function UsersPage() {
  const { user } = useAuth();
  const isPrincipal = user?.role === "SCHOOL_PRINCIPAL";
  const [reloadKey, setReloadKey] = useState(0);
  const list = useApi<Account[]>(`/users?v=${reloadKey}`);
  const [creatable, setCreatable] = useState<Role[]>([]);
  const schools = useApi<{ id: number; name: string }[]>(!isPrincipal ? "/schools" : null);
  const directorates = useApi<{ id: number; name: string }[]>(user?.role === "MINISTRY_ADMIN" ? "/schools/directorates" : null);
  const linkable = useApi<Linkable[]>(isPrincipal ? `/users/linkable-employees?v=${reloadKey}` : null);
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState({ ok: "", err: "" });
  const [search, setSearch] = useState("");

  // Roles this manager may create (returned alongside the list)
  useEffect(() => {
    apiFetch<{ creatableRoles: Role[] }>("/users").then((r) => setCreatable(r.creatableRoles)).catch(() => {});
  }, []);

  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => {
    const next = { ...form, [k]: e.target.value };
    if (k === "employeeId" && e.target.value && !form.fullName) {
      next.fullName = linkable.data?.find((l) => String(l.id) === e.target.value)?.full_name ?? "";
    }
    setForm(next);
  };

  async function create(e: FormEvent) {
    e.preventDefault();
    setMsg({ ok: "", err: "" });
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ""));
      const r = await apiFetch<{ message: string }>("/users", { method: "POST", body: JSON.stringify(body) });
      setMsg({ ok: r.message, err: "" });
      setForm(empty);
      setShowForm(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setMsg({ ok: "", err: (err as Error).message });
    }
  }

  async function toggle(a: Account) {
    setMsg({ ok: "", err: "" });
    try {
      const r = await apiFetch<{ message: string }>(`/users/${a.id}/active`, {
        method: "PATCH", body: JSON.stringify({ isActive: !a.is_active }),
      });
      setMsg({ ok: r.message, err: "" });
      setReloadKey((k) => k + 1);
    } catch (err) {
      setMsg({ ok: "", err: (err as Error).message });
    }
  }

  const needsSchool = !isPrincipal && ["SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "SCHOOL_STAFF", "TEACHER"].includes(form.role);
  const rows = (list.data ?? []).filter((a) => !search || a.full_name.includes(search) || a.username.includes(search));

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader
        title="حسابات المستخدمين"
        subtitle="إنشاء الحسابات وتعطيلها وتعيين الأدوار"
        actions={<button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}><i className="bi bi-person-plus ms-1"></i>حساب جديد</button>}
      />
      <Alert kind="success">{msg.ok}</Alert>
      <Alert kind="danger">{msg.err || list.error}</Alert>

      {showForm && (
        <form className="card border-0 shadow-sm rounded-4 mb-4" onSubmit={create}>
          <div className="card-body row g-3">
            <Field label="الدور *" col="col-md-3">
              <select className="form-select" value={form.role} onChange={set("role")} required>
                <option value="">اختر...</option>
                {creatable.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
              </select>
            </Field>
            {isPrincipal && (
              <Field label={form.role === "TEACHER" ? "ملف المعلم *" : "ربط بملف موظف"} col="col-md-5">
                <select className="form-select" value={form.employeeId} onChange={set("employeeId")} required={form.role === "TEACHER"}>
                  <option value="">—</option>
                  {linkable.data
                    ?.filter((l) => form.role !== "TEACHER" || l.position_type === "TEACHER")
                    .map((l) => <option key={l.id} value={l.id}>{l.full_name} ({l.employee_number})</option>)}
                </select>
              </Field>
            )}
            {needsSchool && (
              <Field label="المدرسة *" col="col-md-4">
                <select className="form-select" value={form.schoolId} onChange={set("schoolId")} required>
                  <option value="">اختر...</option>
                  {schools.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            )}
            {form.role === "DIRECTORATE_ADMIN" && (
              <Field label="المديرية *" col="col-md-4">
                <select className="form-select" value={form.directorateId} onChange={set("directorateId")} required>
                  <option value="">اختر...</option>
                  {directorates.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="الاسم الكامل *" col="col-md-4"><input className="form-control" value={form.fullName} onChange={set("fullName")} required /></Field>
            <Field label="اسم المستخدم *" col="col-md-3"><input className="form-control" dir="ltr" value={form.username} onChange={set("username")} required pattern="[a-zA-Z0-9._\-]{3,100}" /></Field>
            <Field label="كلمة المرور الأولية *" col="col-md-3"><input type="password" className="form-control" dir="ltr" value={form.password} onChange={set("password")} required minLength={8} autoComplete="new-password" /></Field>
            <Field label="البريد الإلكتروني" col="col-md-3"><input type="email" className="form-control" dir="ltr" value={form.email} onChange={set("email")} /></Field>
            <div className="col-12 d-flex gap-2">
              <button className="btn btn-primary">إنشاء الحساب</button>
              <button type="button" className="btn btn-outline-secondary" onClick={() => setShowForm(false)}>إلغاء</button>
            </div>
          </div>
        </form>
      )}

      <input className="form-control mb-3" style={{ maxWidth: 300 }} placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="card border-0 shadow-sm rounded-4">
        {list.loading && !list.data ? <Loading /> : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light"><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>المدرسة</th><th>آخر دخول</th><th>الحالة</th><th></th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className={a.is_active ? "" : "text-secondary"}>
                    <td className="fw-semibold">{a.full_name}{a.employee_number && <div className="small text-secondary">{a.employee_number}</div>}</td>
                    <td dir="ltr" className="text-end">{a.username}</td>
                    <td>{roleLabels[a.role] ?? a.role}</td>
                    <td>{a.school_name ?? "—"}</td>
                    <td className="small">{a.last_login_at ? new Date(a.last_login_at).toLocaleString("ar-SY") : "—"}</td>
                    <td>{a.is_active ? <span className="badge text-bg-success">فعّال</span> : <span className="badge text-bg-secondary">معطّل</span>}</td>
                    <td>
                      {a.id !== user?.id && creatable.includes(a.role) && (
                        <button className={`btn btn-sm ${a.is_active ? "btn-outline-danger" : "btn-outline-success"}`} onClick={() => toggle(a)}>
                          {a.is_active ? "تعطيل" : "تفعيل"}
                        </button>
                      )}
                    </td>
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

export default UsersPage;
