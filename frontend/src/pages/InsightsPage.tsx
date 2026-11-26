import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../context/AuthContext";
import { Alert, Loading, PageHeader } from "../components/ui";
import { STAGE_LABELS } from "../config/labels";

// AI (local, no internet): school performance index & ranking (FR-DASH-07, FR-ALG-08) and attendance anomaly alerts
// (FR-ALG-07, 09, 11). Decision support only — the system takes no administrative action (FR-ALG-10).

interface Factor { key: string; label: string; value: number | null; weight: number; contribution: number; detail: string }
interface SchoolScore {
  schoolId: number; schoolName: string; directorateName: string; stage: number; performance: number; need: number; rank: number;
  performanceFactors: Factor[]; needFactors: Factor[]; strengths: string[]; weaknesses: string[]; reason: string;
}
interface Performance { period: { from: string; to: string }; average: { performance: number | null; need: number | null }; outOf: number; schools: SchoolScore[] }
interface AnomalyAlert {
  type: string; severity: "HIGH" | "MEDIUM" | "LOW"; schoolId: number; schoolName: string; assignmentId: number | null; name: string | null;
  title: string; reason: string; evidence: Record<string, number | string>; dates: string[];
}
interface Alerts { asOf: string; alerts: AnomalyAlert[]; individualCounts?: Record<string, Record<string, number>> }

const SEVERITY = { HIGH: { label: "مرتفع", cls: "text-bg-danger", icon: "bi-exclamation-octagon" }, MEDIUM: { label: "متوسط", cls: "text-bg-warning", icon: "bi-exclamation-triangle" }, LOW: { label: "منخفض", cls: "text-bg-secondary", icon: "bi-info-circle" } };
const TYPE_LABEL: Record<string, string> = {
  CONSECUTIVE_ABSENCE: "غياب متتالٍ", SCHOOL_ABSENCE_SPIKE: "ارتفاع غياب المدرسة", WEEKDAY_LATENESS: "تأخر في يوم محدد", REPEATED_INCOMPLETE: "تسجيل ناقص متكرر",
};
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const today = () => new Date().toISOString().slice(0, 10);

function Disclaimer() {
  return (
    <div className="small text-secondary border rounded-3 p-2 mb-3 bg-light">
      <i className="bi bi-shield-check ms-1"></i>
      تحليل إحصائي محلي (بدون إنترنت أو نماذج خارجية) لدعم القرار فقط — لا يتّخذ النظام أي إجراء إداري أو تأديبي أو مالي بناءً عليه. كل نتيجة معها الأرقام التي سببتها.
    </div>
  );
}

function FactorBars({ factors, need }: { factors: Factor[]; need?: boolean }) {
  return (
    <div className="d-flex flex-column gap-2">
      {factors.map((f) => (
        <div key={f.key} title={f.value == null ? "لا بيانات — وُزّع وزنه على باقي العوامل" : `القيمة ${Math.round(f.value * 100)}% × الوزن ${Math.round(f.weight * 100)}% = ${f.contribution} نقطة`}>
          <div className="d-flex justify-content-between small">
            <span>{f.label} <span className="text-secondary">({Math.round(f.weight * 100)}%)</span></span>
            <span className="fw-semibold">{f.value == null ? "—" : `${need ? "+" : ""}${f.contribution}`}</span>
          </div>
          <div className="progress-brand"><span style={{ width: `${(f.value ?? 0) * 100}%`, background: need ? "var(--brand-gold-500)" : undefined }}></span></div>
          <div className="small text-secondary">{f.detail}</div>
        </div>
      ))}
    </div>
  );
}

function PerformanceTab() {
  const { user } = useAuth();
  const [month, setMonth] = useState(prevMonth());
  const [open, setOpen] = useState<number | null>(null);
  const perf = useApi<Performance>(`/analytics/performance?month=${month}`);
  const d = perf.data;
  const isSchool = user?.role === "SCHOOL_PRINCIPAL" || user?.role === "SCHOOL_DEPUTY";
  const selected = d?.schools.find((s) => s.schoolId === open) ?? (isSchool ? d?.schools[0] : undefined);
  return (
    <>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <input type="month" className="form-control" style={{ maxWidth: 170 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="الشهر" />
        {d && <span className="small text-secondary">{d.period.from} → {d.period.to} · المتوسط: أداء {d.average.performance} / احتياج {d.average.need}</span>}
      </div>
      <Alert kind="danger">{perf.error}</Alert>
      {!d ? <Loading /> : (
        <div className="row g-3">
          {!isSchool && (
            <div className="col-lg-7">
              <div className="card border-0 shadow-sm rounded-4">
                <div className="card-body">
                  <h2 className="h6 fw-bold brand-title mb-3">ترتيب المدارس</h2>
                  <div className="table-responsive">
                    <table className="table table-sm table-hover align-middle mb-0">
                      <thead className="table-light"><tr><th>#</th><th>المدرسة</th><th style={{ minWidth: 130 }}>مؤشر الأداء</th><th style={{ minWidth: 130 }}>مؤشر الاحتياج</th></tr></thead>
                      <tbody>{d.schools.map((s) => (
                        <tr key={s.schoolId} style={{ cursor: "pointer" }} className={s.schoolId === selected?.schoolId ? "table-active" : ""} onClick={() => setOpen(s.schoolId)}>
                          <td className="fw-bold">{s.rank}</td>
                          <td>{s.schoolName}<div className="small text-secondary">{STAGE_LABELS[s.stage]}{user?.role === "MINISTRY_ADMIN" && ` · ${s.directorateName}`}</div></td>
                          <td><div className="small fw-semibold">{s.performance}</div><div className="progress-brand"><span style={{ width: `${s.performance}%` }}></span></div></td>
                          <td><div className="small fw-semibold">{s.need}</div><div className="progress-brand"><span style={{ width: `${s.need}%`, background: "var(--brand-gold-500)" }}></span></div></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <div className="small text-secondary mt-2">الأداء: أعلى = أفضل. الاحتياج: أعلى = تحتاج دعماً أكثر. اضغط مدرسة لرؤية التعليل.</div>
                </div>
              </div>
            </div>
          )}
          <div className={isSchool ? "col-12" : "col-lg-5"}>
            {!selected ? <p className="text-secondary">اختر مدرسة من الجدول لعرض تفاصيل مؤشرها.</p> : (
              <div className="card border-0 shadow-sm rounded-4">
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-start mb-2">
                    <h2 className="h6 fw-bold mb-0">{selected.schoolName}</h2>
                    <span className="badge text-bg-light border">الترتيب {selected.rank} من {d.outOf}</span>
                  </div>
                  <div className="row g-2 mb-3 text-center">
                    <div className="col-6"><div className="kpi-card p-2"><div className="kpi-value">{selected.performance}</div><div className="kpi-label">مؤشر الأداء</div></div></div>
                    <div className="col-6"><div className="kpi-card p-2"><div className="kpi-value">{selected.need}</div><div className="kpi-label">مؤشر الاحتياج</div></div></div>
                  </div>
                  <p className="small mb-3">{selected.reason}</p>
                  <div className="row g-3">
                    <div className={isSchool ? "col-md-6" : "col-12"}><h3 className="h6 fw-bold">عوامل الأداء</h3><FactorBars factors={selected.performanceFactors} /></div>
                    <div className={isSchool ? "col-md-6" : "col-12"}><h3 className="h6 fw-bold">عوامل الاحتياج</h3><FactorBars factors={selected.needFactors} need /></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function AlertsTab() {
  const [asOf, setAsOf] = useState(today());
  const [type, setType] = useState("");
  const res = useApi<Alerts>(`/analytics/alerts?asOf=${asOf}`);
  const d = res.data;
  const list = d?.alerts.filter((a) => !type || a.type === type) ?? [];
  return (
    <>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <label className="d-flex align-items-center gap-1 small">حتى تاريخ<input type="date" className="form-control" value={asOf} max={today()} onChange={(e) => setAsOf(e.target.value)} /></label>
        <select className="form-select" style={{ maxWidth: 220 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="نوع التنبيه">
          <option value="">كل الأنواع</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="small text-secondary">نافذة التحليل: آخر 7 أسابيع (خط أساس 4 أسابيع لكشف الارتفاع)</span>
      </div>
      <Alert kind="danger">{res.error}</Alert>
      {!d ? <Loading /> : (
        <>
          {list.length === 0 && <div className="alert alert-success">لا توجد أنماط غير طبيعية في هذه الفترة.</div>}
          <div className="d-flex flex-column gap-2">
            {list.map((a, i) => {
              const sv = SEVERITY[a.severity];
              return (
                <div key={i} className="card border-0 shadow-sm rounded-4">
                  <div className="card-body py-3">
                    <div className="d-flex flex-wrap justify-content-between gap-2">
                      <div className="fw-bold"><i className={`bi ${sv.icon} ms-1`}></i>{a.title}</div>
                      <div className="d-flex gap-1"><span className="badge text-bg-light border">{TYPE_LABEL[a.type] ?? a.type}</span><span className={`badge ${sv.cls}`}>{sv.label}</span></div>
                    </div>
                    <div className="small text-secondary mb-1">{a.schoolName}{a.name && ` · ${a.name}`}</div>
                    <div className="small">{a.reason}</div>
                    <details className="small mt-1">
                      <summary className="text-secondary">الأرقام التي سببت التنبيه</summary>
                      <ul className="mb-0">{Object.entries(a.evidence).map(([k, v]) => <li key={k}><code>{k}</code>: {String(v)}</li>)}</ul>
                      {a.dates.length > 0 && <div>التواريخ: {a.dates.join("، ")}</div>}
                    </details>
                  </div>
                </div>
              );
            })}
          </div>
          {d.individualCounts && Object.keys(d.individualCounts).length > 0 && (
            <div className="card border-0 shadow-sm rounded-4 mt-3">
              <div className="card-body">
                <h2 className="h6 fw-bold">تنبيهات فردية (أعداد فقط — التفاصيل لدى المدرسة والمديرية)</h2>
                <table className="table table-sm mb-0">
                  <thead className="table-light"><tr><th>المدرسة</th>{Object.keys(TYPE_LABEL).filter((k) => k !== "SCHOOL_ABSENCE_SPIKE").map((k) => <th key={k}>{TYPE_LABEL[k]}</th>)}</tr></thead>
                  <tbody>{Object.entries(d.individualCounts).map(([school, c]) => (
                    <tr key={school}><td>{school}</td>{Object.keys(TYPE_LABEL).filter((k) => k !== "SCHOOL_ABSENCE_SPIKE").map((k) => <td key={k}>{c[k] ?? 0}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

function InsightsPage() {
  const { user } = useAuth();
  const isSchoolRole = user?.role === "SCHOOL_PRINCIPAL" || user?.role === "SCHOOL_DEPUTY";
  const [tab, setTab] = useState<"perf" | "alerts">("alerts");
  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader title="التحليلات الذكية" subtitle={isSchoolRole ? "كشف الأنماط غير الطبيعية في الحضور" : "مؤشر أداء المدارس وترتيبها، وكشف الأنماط غير الطبيعية في الحضور"} />
      <Disclaimer />
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item"><button type="button" className={`nav-link ${tab === "alerts" ? "active" : ""}`} onClick={() => setTab("alerts")}><i className="bi bi-activity ms-1"></i>تنبيهات الحضور</button></li>
        {!isSchoolRole && <li className="nav-item"><button type="button" className={`nav-link ${tab === "perf" ? "active" : ""}`} onClick={() => setTab("perf")}><i className="bi bi-trophy ms-1"></i>مؤشر أداء المدارس</button></li>}
      </ul>
      {tab === "alerts" || isSchoolRole ? <AlertsTab /> : <PerformanceTab />}
    </div>
  );
}

export default InsightsPage;
