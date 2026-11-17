import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { apiFetch } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, Loading, PageHeader, SchoolPicker } from "../components/ui";
import FaceCapture, { type Capture } from "../components/FaceCapture";
import { POSITION_LABELS } from "../config/labels";

interface Enrollment {
  assignment_id: number;
  employee_id: number;
  full_name: string;
  employee_number: string;
  position_type: string;
  enrolled_at: string | null;
  enrolled_by_name: string | null;
}

// FR-ATT-01 (principal enrolls), FR-ATT-24 (teachers and administrative staff)
function FaceEnrollPage() {
  const { user } = useAuth();
  const isPrincipal = user?.role === "SCHOOL_PRINCIPAL";
  const [schoolId, setSchoolId] = useState<number | null>(user?.schoolId ?? null);
  const list = useApi<Enrollment[]>(schoolId ? `/face/enrollments?schoolId=${schoolId}` : null);
  const [selected, setSelected] = useState<Enrollment | null>(null);
  const [msg, setMsg] = useState({ ok: "", err: "" });
  const [search, setSearch] = useState("");

  async function enroll(c: Capture) {
    if (!selected) return;
    setMsg({ ok: "", err: "" });
    try {
      const r = await apiFetch<{ message: string }>("/face/enroll", {
        method: "POST",
        body: JSON.stringify({ employeeAssignmentId: selected.assignment_id, ...c }),
      });
      setMsg({ ok: `${selected.full_name}: ${r.message}`, err: "" });
      setSelected(null);
      list.reload();
    } catch (err) {
      setMsg({ ok: "", err: (err as Error).message });
    }
  }

  async function remove(e: Enrollment) {
    if (!window.confirm(`حذف تسجيل وجه ${e.full_name}؟ سيحتاج لإعادة التسجيل.`)) return;
    try {
      const r = await apiFetch<{ message: string }>(`/face/enrollments/${e.employee_id}`, { method: "DELETE" });
      setMsg({ ok: r.message, err: "" });
      list.reload();
    } catch (err) {
      setMsg({ ok: "", err: (err as Error).message });
    }
  }

  const rows = (list.data ?? []).filter((e) => !search || e.full_name.includes(search) || e.employee_number.includes(search));
  const enrolled = (list.data ?? []).filter((e) => e.enrolled_at).length;

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader title="تسجيل الوجوه" subtitle="تسجيل وجه المعلمين والكادر الإداري لاستخدامه في الحضور — يُحفظ متجه رقمي مشفّر فقط، بدون صور" />
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <SchoolPicker value={schoolId} onChange={(id) => { setSchoolId(id); setSelected(null); }} />
        <input className="form-control" style={{ maxWidth: 260 }} placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)} />
        {list.data && <span className="badge text-bg-light border p-2">مسجّل {enrolled} من {list.data.length}</span>}
      </div>
      <Alert kind="success">{msg.ok}</Alert>
      <Alert kind="danger">{msg.err || list.error}</Alert>

      <div className="row g-3">
        <div className={selected ? "col-xl-6" : "col-12"}>
          <div className="card border-0 shadow-sm rounded-4">
            {list.loading && !list.data ? <Loading /> : (
              <div className="table-responsive" style={{ maxHeight: 620 }}>
                <table className="table table-hover align-middle small mb-0">
                  <thead className="table-light sticky-top"><tr><th>الموظف</th><th>الصفة</th><th>الحالة</th>{isPrincipal && <th></th>}</tr></thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e.assignment_id} className={selected?.assignment_id === e.assignment_id ? "table-primary" : ""}>
                        <td className="fw-semibold">{e.full_name}<div className="text-secondary fw-normal">{e.employee_number}</div></td>
                        <td>{POSITION_LABELS[e.position_type]}</td>
                        <td>
                          {e.enrolled_at
                            ? <><span className="badge text-bg-success">مسجّل</span><div className="text-secondary">{e.enrolled_at}</div></>
                            : <span className="badge text-bg-light border">غير مسجّل</span>}
                        </td>
                        {isPrincipal && (
                          <td className="text-nowrap">
                            <button className="btn btn-sm btn-outline-primary ms-1" onClick={() => { setSelected(e); setMsg({ ok: "", err: "" }); }}>
                              {e.enrolled_at ? "إعادة تسجيل" : "تسجيل"}
                            </button>
                            {e.enrolled_at && <button className="btn btn-sm btn-link text-danger" onClick={() => remove(e)}>حذف</button>}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        {selected && isPrincipal && (
          <div className="col-xl-6">
            <div className="card border-0 shadow-sm rounded-4">
              <div className="card-body">
                <div className="d-flex justify-content-between mb-2">
                  <h2 className="h6 fw-bold brand-title mb-0">تسجيل وجه: {selected.full_name}</h2>
                  <button className="btn-close" aria-label="إغلاق" onClick={() => setSelected(null)}></button>
                </div>
                <p className="small text-secondary">اطلب من الموظف الوقوف أمام الكاميرا بإضاءة جيدة، ثم اتباع التعليمات على الشاشة.</p>
                <FaceCapture key={selected.assignment_id} onCapture={enroll} actionLabel="بدء التسجيل" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default FaceEnrollPage;
