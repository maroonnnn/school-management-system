import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useApi } from "../hooks/useApi";
import { NAV_ITEMS, canAccess } from "../config/navigation";
import { roleLabels } from "../types/auth";
import { Alert, Loading } from "../components/ui";
import { DAY_LABELS } from "../config/labels";
import type { QuotaRow } from "./QuotaPage";

interface ManagerSummary {
  kind: "manager";
  counts: { schools: number; teachers: number; staff: number; students: number; sections: number };
  attendance: { day: string; present: number; total: number }[];
  quota: { week: { from: string; to: string }; required: number; executed: number; notExecuted: number; excused: number; teachersBelow: number };
  attention: { key: string; count: number }[];
}
interface TeacherSummary {
  kind: "teacher";
  week: { from: string; to: string };
  quota: QuotaRow[];
}

const ATTENTION: Record<string, { label: string; icon: string; to: string }> = {
  requests_pending: { label: "طلبات مدارس بانتظار المراجعة", icon: "bi-inbox", to: "/requests/review" },
  grades_to_approve: { label: "نتائج بانتظار اعتمادك", icon: "bi-journal-check", to: "/grades" },
  my_requests_open: { label: "طلبات المدرسة المفتوحة", icon: "bi-send", to: "/requests" },
  grades_draft: { label: "نتائج مسودة لم تُرسل بعد", icon: "bi-pencil-square", to: "/grades" },
  on_leave_today: { label: "موظفون في إجازة اليوم", icon: "bi-calendar-x", to: "/quota" },
};

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const dayName = (iso: string) => DAY_LABELS[new Date(`${iso}T12:00:00`).getDay() + 1];

function Kpi({ icon, label, value, hint, gold }: { icon: string; label: string; value: string | number; hint?: string; gold?: boolean }) {
  return (
    <div className="col-6 col-lg-3">
      <div className="kpi-card p-3">
        <div className="d-flex align-items-center gap-3">
          <span className={`kpi-icon ${gold ? "gold" : ""}`}><i className={`bi ${icon}`}></i></span>
          <div>
            <div className="kpi-value">{value}</div>
            <div className="kpi-label">{label}</div>
          </div>
        </div>
        {hint && <div className="small text-secondary mt-2">{hint}</div>}
      </div>
    </div>
  );
}

function HomePage() {
  const { user } = useAuth();
  const summary = useApi<ManagerSummary | TeacherSummary>("/dashboard/summary");
  const services = NAV_ITEMS.filter((item) => item.path !== "/" && canAccess(item, user?.role));
  const today = new Intl.DateTimeFormat("ar-SY", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const s = summary.data;

  return (
    <div className="container-fluid p-3 p-lg-4">
      <section className="hero p-4 p-lg-5 mb-4 shadow-sm">
        <div className="position-relative" style={{ zIndex: 1 }}>
          <div className="hero-kicker mb-2">الجمهورية العربية السورية · وزارة التربية والتعليم · {today}</div>
          <h1 className="h2 mb-2">أهلاً، {user?.fullName || user?.username}</h1>
          <p className="mb-0 opacity-75">{user && roleLabels[user.role]} — هذه نظرة سريعة على ما يخصّك اليوم.</p>
        </div>
      </section>

      <Alert kind="danger">{summary.error}</Alert>
      {summary.loading && !s && <Loading />}

      {s?.kind === "manager" && (
        <>
          <div className="row g-3 mb-4">
            {user?.role !== "SCHOOL_PRINCIPAL" && user?.role !== "SCHOOL_DEPUTY" && user?.role !== "SUPERVISOR" && user?.role !== "SCHOOL_STAFF" && (
              <Kpi icon="bi-building" label="مدرسة" value={s.counts.schools} />
            )}
            <Kpi icon="bi-person-workspace" label="معلم" value={s.counts.teachers} hint={`+ ${s.counts.staff} من الكادر الإداري`} />
            <Kpi icon="bi-people" label="طالب" value={s.counts.students.toLocaleString("ar-SY")} hint={`في ${s.counts.sections} شعبة`} />
            <Kpi icon="bi-speedometer2" gold label="إنجاز النصاب — الأسبوع الماضي"
              value={`${pct(s.quota.executed, s.quota.required - s.quota.excused)}%`}
              hint={`${s.quota.executed} حصة منفّذة · ${s.quota.notExecuted} لم تُنفّذ`} />
          </div>

          <div className="row g-3 mb-4">
            <div className="col-lg-7">
              <div className="card border-0 shadow-sm rounded-4 h-100">
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-baseline mb-3">
                    <h2 className="h6 fw-bold brand-title mb-0">نسبة حضور الكادر — آخر أيام الدوام</h2>
                    {s.attendance.length > 0 && (
                      <span className="small text-secondary">
                        المتوسط {pct(s.attendance.reduce((a, d) => a + d.present, 0), s.attendance.reduce((a, d) => a + d.total, 0))}%
                      </span>
                    )}
                  </div>
                  {s.attendance.length === 0 ? <p className="text-secondary mb-0">لا توجد بيانات حضور بعد.</p> : (
                    <div className="bars" role="img" aria-label="مخطط نسبة الحضور اليومية">
                      {s.attendance.map((d) => {
                        const p = pct(d.present, d.total);
                        return (
                          <div className="bar" key={d.day} title={`${d.day}: ${d.present} من ${d.total}`}>
                            <small className="fw-semibold text-body">{p}%</small>
                            <span className={`fill ${p < 85 ? "low" : ""}`} style={{ height: `${Math.max(p, 4) * 0.8}px` }}></span>
                            <small>{dayName(d.day)}</small>
                            <small>{d.day.slice(5)}</small>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="small text-secondary mt-2"><span className="d-inline-block rounded-1 ms-1" style={{ width: 10, height: 10, background: "var(--brand-gold-500)" }}></span>أقل من 85%</div>
                </div>
              </div>
            </div>

            <div className="col-lg-5">
              <div className="card border-0 shadow-sm rounded-4 h-100">
                <div className="card-body">
                  <h2 className="h6 fw-bold brand-title mb-2">يحتاج انتباهك</h2>
                  {s.attention.length === 0 && <p className="text-secondary mb-0">لا شيء معلّق.</p>}
                  {s.attention.map((a) => {
                    const meta = ATTENTION[a.key];
                    return (
                      <Link key={a.key} to={meta.to} className="attention-item rounded-2">
                        <span className="kpi-icon" style={{ width: 36, height: 36, fontSize: "1rem" }}><i className={`bi ${meta.icon}`}></i></span>
                        <span className="flex-grow-1">{meta.label}</span>
                        <span className="attention-count">{a.count}</span>
                      </Link>
                    );
                  })}
                  <div className="mt-3 pt-2 border-top small">
                    <div className="d-flex justify-content-between mb-1">
                      <span>معلمون لم يكملوا نصاب الأسبوع الماضي</span>
                      <span className="fw-bold">{s.quota.teachersBelow} / {s.counts.teachers}</span>
                    </div>
                    <div className="progress-brand"><span style={{ width: `${pct(s.counts.teachers - s.quota.teachersBelow, s.counts.teachers)}%` }}></span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {s?.kind === "teacher" && s.quota.map((q) => (
        <div className="row g-3 mb-4" key={q.employee_assignment_id}>
          <Kpi icon="bi-bullseye" label="نصابك هذا الأسبوع" value={q.required} hint={q.employment_type === "PERMANENT" ? `مثبّت · ${q.years_of_service} سنة خدمة` : "وكيل"} />
          <Kpi icon="bi-check2-circle" label="حصص منفّذة" value={q.executed} />
          <Kpi icon="bi-hourglass-split" gold label="المتبقي" value={q.remaining} />
          <Kpi icon="bi-calendar-event" label="حصص قادمة هذا الأسبوع" value={q.upcoming} />
        </div>
      ))}

      <h2 className="h6 fw-bold brand-title mb-3">خدمات النظام</h2>
      <div className="row g-3">
        {services.map((item) => (
          <div className="col-md-6 col-xl-4" key={item.path}>
            <Link to={item.path} className="card h-100 shadow-sm rounded-4 text-decoration-none text-reset service-card">
              <div className="card-body p-3 d-flex gap-3">
                <span className="service-icon flex-shrink-0"><i className={`bi ${item.icon}`}></i></span>
                <div>
                  <h3 className="h6 fw-bold mb-1">{item.label}</h3>
                  <p className="text-secondary small mb-0">{item.description}</p>
                </div>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

export default HomePage;
