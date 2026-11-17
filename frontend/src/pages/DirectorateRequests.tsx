import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { Alert, Loading, PageHeader } from "../components/ui";
import RequestDetail from "../components/RequestDetail";
import { REQUEST_STATUS, REQUEST_TYPE } from "../config/labels";
import type { RequestRow } from "./SchoolRequestsPage";

type Sort = "priority" | "waiting" | "updated";

// FR-REQ-05..10, 15..18 — the directorate reviews its schools' requests
function DirectorateRequests() {
  const [params, setParams] = useSearchParams();
  const openId = params.get("open") ? Number(params.get("open")) : null;
  const [filters, setFilters] = useState({ status: "", type: "", schoolId: "", overdue: false, q: "" });
  const [sort, setSort] = useState<Sort>("priority");
  const qs = new URLSearchParams(Object.entries({ ...filters, overdue: filters.overdue ? "1" : "" }).filter(([, v]) => v) as [string, string][]).toString();
  const list = useApi<RequestRow[]>(`/requests${qs ? `?${qs}` : ""}`);
  const schools = useApi<{ id: number; name: string }[]>("/schools");

  const rows = [...(list.data ?? [])].sort((a, b) =>
    sort === "priority" ? (b.priority ?? -1) - (a.priority ?? -1)
      : sort === "waiting" ? b.waiting_days - a.waiting_days
        : b.updated_at.localeCompare(a.updated_at));
  const open = (list.data ?? []).filter((r) => r.priority !== null);
  const set = (k: keyof typeof filters) => (v: string | boolean) => setFilters({ ...filters, [k]: v });

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader title="طلبات المدارس" subtitle="مراجعة طلبات مدارس المديرية — الأولوية أداة مساعدة للترتيب ولا تتخذ قراراً" />
      {list.data && (
        <div className="d-flex flex-wrap gap-2 mb-3 small">
          <span className="badge text-bg-light border p-2">مفتوحة: {open.length}</span>
          <span className="badge text-bg-danger p-2">متأخرة: {open.filter((r) => r.overdue).length}</span>
          <span className="badge text-bg-warning p-2">بانتظار المدرسة: {(list.data ?? []).filter((r) => r.status === "RETURNED").length}</span>
        </div>
      )}
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <select className="form-select form-select-sm" style={{ maxWidth: 160 }} value={filters.status} onChange={(e) => set("status")(e.target.value)} aria-label="الحالة">
          <option value="">كل الحالات</option>
          {Object.entries(REQUEST_STATUS).filter(([k]) => k !== "DRAFT").map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="form-select form-select-sm" style={{ maxWidth: 160 }} value={filters.type} onChange={(e) => set("type")(e.target.value)} aria-label="النوع">
          <option value="">كل الأنواع</option>
          {Object.entries(REQUEST_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="form-select form-select-sm" style={{ maxWidth: 200 }} value={filters.schoolId} onChange={(e) => set("schoolId")(e.target.value)} aria-label="المدرسة">
          <option value="">كل المدارس</option>
          {schools.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="form-check">
          <input id="overdue" type="checkbox" className="form-check-input" checked={filters.overdue} onChange={(e) => set("overdue")(e.target.checked)} />
          <label htmlFor="overdue" className="form-check-label small">المتأخرة فقط</label>
        </div>
        <input className="form-control form-control-sm" style={{ maxWidth: 200 }} placeholder="رقم أو عنوان..." value={filters.q} onChange={(e) => set("q")(e.target.value)} />
        <select className="form-select form-select-sm" style={{ maxWidth: 170 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="الترتيب">
          <option value="priority">ترتيب: الأولوية</option>
          <option value="waiting">ترتيب: مدة الانتظار</option>
          <option value="updated">ترتيب: آخر تحديث</option>
        </select>
      </div>
      <Alert kind="danger">{list.error}</Alert>

      <div className="row g-3">
        <div className={openId ? "col-xl-6" : "col-12"}>
          <div className="card border-0 shadow-sm rounded-4">
            {list.loading && !list.data ? <Loading /> : (
              <div className="table-responsive">
                <table className="table table-hover align-middle small mb-0">
                  <thead className="table-light"><tr><th>الأولوية</th><th>الطلب</th><th>المدرسة</th><th>الحالة</th><th>ينتظر</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} role="button" onClick={() => setParams({ open: String(r.id) })} className={Number(r.id) === openId ? "table-primary" : ""}>
                        <td style={{ width: 110 }} title={r.priority_reason ?? ""}>
                          {r.priority !== null ? (
                            <>
                              <span className="fw-bold">{r.priority}</span>
                              <div className="progress-brand mt-1"><span style={{ width: `${r.priority}%` }}></span></div>
                            </>
                          ) : <span className="text-secondary">—</span>}
                        </td>
                        <td>
                          <div className="fw-semibold">{r.title}</div>
                          <div className="text-secondary">{r.request_number} · {REQUEST_TYPE[r.request_type]}{r.assigned_department && ` · ${r.assigned_department}`}</div>
                        </td>
                        <td>{r.school_name}</td>
                        <td>
                          <span className={`badge ${REQUEST_STATUS[r.status]?.cls}`}>{REQUEST_STATUS[r.status]?.label}</span>
                          {r.overdue && <span className="badge text-bg-danger ms-1">متأخر</span>}
                        </td>
                        <td>{r.priority !== null ? `${r.waiting_days} يوم` : "—"}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={5} className="text-center text-secondary py-4">لا توجد طلبات</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        {openId && (
          <div className="col-xl-6">
            <RequestDetail key={openId} id={openId} onChanged={list.reload} onClose={() => setParams({})} />
          </div>
        )}
      </div>
    </div>
  );
}

export default DirectorateRequests;
