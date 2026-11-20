import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useApi } from "../hooks/useApi";
import { Alert, Loading, type SchoolOption } from "./ui";
import { REQUEST_TYPE, STAGE_LABELS } from "../config/labels";

// FR-DASH-01..06: role-scoped indicators with period + school filters.
// Same backend function as the exported central report → identical figures for the same period (FR-DASH-04).

interface Agg {
  schools: number; students: number; teachers: number; staff: number; attendanceRate: number | null; quotaCompletion: number | null;
  requestsOpen: number; requestsOverdue: number; outages: number; staffShortage: number; resultsSubmitted: number; resultsDue: number;
}
interface SchoolRow {
  schoolId: number; schoolName: string; stage: number; directorateName: string; students: number; teachers: number;
  attendanceRate: number | null; quotaCompletion: number | null; requestsOpen: number; requestsOverdue: number; outages: number;
  resultsAverage: number | null; resultsSubmitted: number; resultsDue: number; staffShortage: number;
}
interface Decision { id: number; kind: string; subject: string; requires_ack: boolean; sent_date: string; recipients: number; opened: number; acknowledged: number; late_unopened: number; late_unacknowledged: number }
interface Indicators {
  period: { from: string; to: string };
  term: number;
  totals: Agg;
  daily: { date: string; rate: number | null; duty: number }[];
  requestsByType: Record<string, number>;
  requestsAvgDaysToDecision: number | null;
  directorates: (Agg & { directorateId: number; directorateName: string })[];
  schools: SchoolRow[];
  decisions: { lateDays: number; messages: Decision[] } | null;
}

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function preset(p: string): { from: string; to: string } {
  const now = new Date();
  if (p === "last-month") return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (p === "7d") return { from: iso(new Date(now.getTime() - 6 * 864e5)), to: iso(now) };
  if (p === "term") return { from: `${now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1}-09-01`, to: iso(now) };
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
}
const PRESETS = [["month", "هذا الشهر"], ["last-month", "الشهر الماضي"], ["7d", "آخر 7 أيام"], ["term", "منذ بداية العام"], ["custom", "مخصّص"]] as const;
const pct = (x: number | null | undefined) => (x == null ? "—" : `${x}%`);
const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function Kpi({ icon, label, value, hint, gold, to }: { icon: string; label: string; value: string | number; hint?: string; gold?: boolean; to?: string }) {
  const body = (
    <div className="kpi-card p-3">
      <div className="d-flex align-items-center gap-3">
        <span className={`kpi-icon ${gold ? "gold" : ""}`}><i className={`bi ${icon}`}></i></span>
        <div><div className="kpi-value">{value}</div><div className="kpi-label">{label}</div></div>
      </div>
      {hint && <div className="small text-secondary mt-2">{hint}</div>}
    </div>
  );
  return <div className="col-6 col-lg-3">{to ? <Link to={to} className="text-reset text-decoration-none">{body}</Link> : body}</div>;
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="card border-0 shadow-sm rounded-4 h-100">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-baseline mb-3 gap-2">
          <h2 className="h6 fw-bold brand-title mb-0">{title}</h2>
          {note && <span className="small text-secondary">{note}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Single-series horizontal bars (magnitude by category) with the value as text, never color alone. */
function HBars({ items, max, unit = "" }: { items: { label: string; value: number; hint?: string }[]; max?: number; unit?: string }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="d-flex flex-column gap-2">
      {items.map((i) => (
        <div key={i.label} title={i.hint ?? `${i.label}: ${i.value}${unit}`}>
          <div className="d-flex justify-content-between small"><span>{i.label}</span><span className="fw-semibold">{i.value}{unit}</span></div>
          <div className="progress-brand"><span style={{ width: `${Math.max((i.value / m) * 100, i.value ? 2 : 0)}%` }}></span></div>
        </div>
      ))}
    </div>
  );
}

export default function Indicators() {
  const { user } = useAuth();
  const multi = user?.role === "DIRECTORATE_ADMIN" || user?.role === "MINISTRY_ADMIN";
  const [p, setP] = useState<string>("month");
  const [range, setRange] = useState(preset("month"));
  const [schoolId, setSchoolId] = useState<string>("");
  const schools = useApi<SchoolOption[]>(multi ? "/schools" : null);
  const qs = new URLSearchParams({ from: range.from, to: range.to });
  if (schoolId) qs.set("schoolId", schoolId);
  const ind = useApi<Indicators>(range.from && range.to ? `/dashboard/indicators?${qs}` : null);
  const d = ind.data;
  const t = d?.totals;
  const single = !multi || !!schoolId;
  const step = d ? Math.ceil(d.daily.length / 12) : 1;

  return (
    <>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <div className="btn-group btn-group-sm flex-wrap" role="group" aria-label="الفترة">
          {PRESETS.map(([k, label]) => (
            <button key={k} type="button" className={`btn ${p === k ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => { setP(k); if (k !== "custom") setRange(preset(k)); }}>{label}</button>
          ))}
        </div>
        {p === "custom" && (
          <>
            <input type="date" className="form-control form-control-sm" style={{ maxWidth: 150 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="من" />
            <input type="date" className="form-control form-control-sm" style={{ maxWidth: 150 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="إلى" />
          </>
        )}
        {multi && (
          <select className="form-select form-select-sm" style={{ maxWidth: 260 }} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} aria-label="المدرسة">
            <option value="">كل المدارس</option>
            {schools.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {d && <span className="small text-secondary">{d.period.from} → {d.period.to} · <Link to="/reports">التقرير المصدَّر بنفس الأرقام</Link></span>}
      </div>

      <Alert kind="danger">{ind.error}</Alert>
      {!d || !t ? <Loading /> : (
        <>
          <div className="row g-3 mb-3">
            {!single && <Kpi icon="bi-building" label="مدرسة" value={t.schools} hint={user?.role === "MINISTRY_ADMIN" ? `${d.directorates.length} مديرية` : undefined} />}
            <Kpi icon="bi-person-workspace" label="معلم" value={t.teachers} hint={`+ ${t.staff} من الكادر الإداري`} />
            <Kpi icon="bi-people" label="طالب" value={t.students} />
            <Kpi icon="bi-person-check" label="نسبة الحضور" value={pct(t.attendanceRate)} hint="أيام الحضور ÷ أيام الدوام المطلوبة" />
            <Kpi icon="bi-speedometer2" gold label="إنجاز النصاب" value={pct(t.quotaCompletion)} hint="الحصص المنفّذة ÷ المطلوبة للفترة" />
            <Kpi icon="bi-inbox" label="طلبات مفتوحة" value={t.requestsOpen} hint={`${t.requestsOverdue} متأخرة · متوسط القرار ${d.requestsAvgDaysToDecision ?? "—"} يوم`} to={multi ? "/requests/review" : "/requests"} />
            <Kpi icon="bi-person-dash" label="نقص الكادر" value={t.staffShortage} hint="طلبات نقص مدرّسين مفتوحة" />
            <Kpi icon="bi-journal-check" label={`المحصّلات المرفوعة (الفصل ${d.term === 1 ? "الأول" : "الثاني"})`} value={`${ratio(t.resultsSubmitted, t.resultsDue)}%`}
              hint={`${t.resultsSubmitted} من ${t.resultsDue} كشف`} to="/grades" />
          </div>

          <div className="row g-3 mb-3">
            <div className="col-lg-7">
              <Panel title="نسبة الحضور اليومية" note={`${d.daily.length} يوم عمل`}>
                {d.daily.length === 0 ? <p className="text-secondary mb-0">لا توجد أيام دوام في الفترة.</p> : (
                  <div className="bars" role="img" aria-label="مخطط نسبة الحضور اليومية">
                    {d.daily.map((x, i) => (
                      <div className="bar" key={x.date} title={`${x.date}: ${pct(x.rate)} من ${x.duty} يوم-موظف`}>
                        {d.daily.length <= 12 && <small className="fw-semibold text-body">{x.rate != null ? Math.round(x.rate) : "—"}</small>}
                        <span className={`fill ${(x.rate ?? 0) < 85 ? "low" : ""}`} style={{ height: `${Math.max(x.rate ?? 0, 3) * 0.8}px` }}></span>
                        <small>{i % step === 0 ? x.date.slice(5) : " "}</small>
                      </div>
                    ))}
                  </div>
                )}
                <div className="small text-secondary mt-2"><span className="d-inline-block rounded-1 ms-1" style={{ width: 10, height: 10, background: "var(--brand-gold-500)" }}></span>يوم بنسبة أقل من 85% · مرّر على العمود للتفاصيل</div>
              </Panel>
            </div>
            <div className="col-lg-5">
              <Panel title="أكثر الاحتياجات تكراراً" note="حسب نوع الطلب">
                {Object.keys(d.requestsByType).length === 0 ? <p className="text-secondary mb-0">لا طلبات في الفترة.</p> : (
                  <HBars items={Object.entries(d.requestsByType).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: REQUEST_TYPE[k] ?? k, value: v }))} />
                )}
              </Panel>
            </div>
          </div>

          {d.decisions && (
            <div className="mb-3">
              <Panel title="وصول القرارات والتعاميم" note={`متأخر = لم يُفتح/يُؤكَّد بعد ${d.decisions.lateDays} أيام`}>
                {d.decisions.messages.length === 0 ? <p className="text-secondary mb-0">لم تُرسل تعاميم في هذه الفترة.</p> : (
                  <div className="table-responsive">
                    <table className="table table-sm align-middle mb-0">
                      <thead className="table-light"><tr><th>الموضوع</th><th>الإرسال</th><th>المستلمون</th><th style={{ minWidth: 140 }}>فُتح</th><th style={{ minWidth: 140 }}>أُكّد</th><th>متأخرون</th></tr></thead>
                      <tbody>{d.decisions.messages.map((m) => (
                        <tr key={m.id}>
                          <td><Link to="/messages">{m.subject}</Link></td>
                          <td className="small text-nowrap">{m.sent_date}</td>
                          <td>{m.recipients}</td>
                          <td><div className="small">{m.opened}/{m.recipients}</div><div className="progress-brand"><span style={{ width: `${ratio(m.opened, m.recipients)}%` }}></span></div></td>
                          <td>{m.requires_ack ? <><div className="small">{m.acknowledged}/{m.recipients}</div><div className="progress-brand"><span style={{ width: `${ratio(m.acknowledged, m.recipients)}%` }}></span></div></> : <span className="small text-secondary">غير مطلوب</span>}</td>
                          <td className={m.late_unopened + m.late_unacknowledged ? "text-danger fw-semibold" : ""}>
                            {m.late_unopened + m.late_unacknowledged ? <><i className="bi bi-exclamation-triangle ms-1"></i>{m.late_unopened} لم يفتح{m.requires_ack ? ` · ${m.late_unacknowledged} لم يؤكّد` : ""}</> : "—"}
                          </td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          )}

          {!single && (
            <div className="mb-3">
              <Panel title="مقارنة المدارس" note="الانقطاعات = حوادث انقطاع الكهرباء في الفترة">
                <div className="table-responsive">
                  <table className="table table-sm table-hover align-middle mb-0">
                    <thead className="table-light"><tr>
                      <th>المدرسة</th><th>الحلقة</th><th>طلاب</th><th style={{ minWidth: 110 }}>الحضور</th><th style={{ minWidth: 110 }}>النصاب</th>
                      <th>طلبات مفتوحة</th><th>متأخرة</th><th>نقص كادر</th><th>انقطاعات</th><th>متوسط المحصّلات</th>
                    </tr></thead>
                    <tbody>{d.schools.map((s) => (
                      <tr key={s.schoolId} style={{ cursor: "pointer" }} onClick={() => setSchoolId(String(s.schoolId))} title="اعرض لوحة هذه المدرسة">
                        <td>{s.schoolName}{user?.role === "MINISTRY_ADMIN" && <div className="small text-secondary">{s.directorateName}</div>}</td>
                        <td className="small">{STAGE_LABELS[s.stage] ?? s.stage}</td>
                        <td>{s.students}</td>
                        <td><div className="small">{pct(s.attendanceRate)}</div><div className="progress-brand"><span style={{ width: `${s.attendanceRate ?? 0}%` }}></span></div></td>
                        <td><div className="small">{pct(s.quotaCompletion)}</div><div className="progress-brand"><span style={{ width: `${s.quotaCompletion ?? 0}%` }}></span></div></td>
                        <td>{s.requestsOpen}</td>
                        <td className={s.requestsOverdue ? "text-danger fw-semibold" : ""}>{s.requestsOverdue}</td>
                        <td>{s.staffShortage}</td>
                        <td>{s.outages}</td>
                        <td>{s.resultsAverage ?? "—"}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className="small text-secondary mt-2">اضغط على مدرسة لعرض لوحتها.</div>
              </Panel>
            </div>
          )}
        </>
      )}
    </>
  );
}
