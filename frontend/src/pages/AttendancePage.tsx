import { useState, type FormEvent } from "react";
import { useApi } from "../hooks/useApi";
import { ApiError, API_BASE, apiFetch, getToken } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, Field, Loading, PageHeader, SchoolPicker } from "../components/ui";
import { todayIso } from "../utils/schedule";
import { CORRECTED_STATUS, CORRECTION_STATE, DAY_STATUS, POSITION_LABELS } from "../config/labels";

export interface DayRow {
  employee_assignment_id: number;
  employee_number: string;
  full_name: string;
  position_type: string;
  date: string;
  status: string;
  correctedStatus?: string;
  firstIn: string | null;
  lastOut: string | null;
  expectedStart: string | null;
  expectedEnd: string | null;
  lateMinutes: number;
  earlyMinutes: number;
  presenceMinutes: number;
  needsReview: boolean;
  reasons: string[];
  eventsCount: number;
  pendingCorrection: boolean;
}
interface RawEvent {
  id: number; event_type: string; event_time: string; received_at: string; verification_method: string;
  verification_status: string; match_score: string | null; manual_reason: string | null; recorded_by_name: string | null;
}
interface Correction {
  id: number; work_date: string; corrected_status: string; reason: string; status: string; proposed_at: string;
  proposed_by: number | string; /* pg returns bigint as string */ proposed_by_name: string; decided_by_name: string | null; decision_note: string | null;
  full_name: string; employee_number: string;
}
interface Outage { id: number; outage_type: string; starts_at: string; ends_at: string; minutes: number; notes: string | null; recorded_by_name: string }
interface OutageSummary { id: number; name: string; outages: number; hours: number }

type Tab = "daily" | "corrections" | "outages" | "excel";
const METHOD: Record<string, string> = { FACE: "وجه", MANUAL: "يدوي", FINGERPRINT: "بصمة" };

export function StatusBadge({ row }: { row: Pick<DayRow, "status" | "correctedStatus" | "pendingCorrection"> }) {
  const st = DAY_STATUS[row.status];
  return (
    <>
      <span className={`badge ${st?.cls}`}>{st?.label ?? row.status}</span>
      {row.correctedStatus && <span className="small text-secondary ms-1">← {CORRECTED_STATUS[row.correctedStatus]}</span>}
      {row.pendingCorrection && <span className="badge text-bg-light border ms-1" title="يوجد تصحيح بانتظار الاعتماد"><i className="bi bi-hourglass-split"></i></span>}
    </>
  );
}

// FR-ATT-06..19, 25..27
function AttendancePage() {
  const { user } = useAuth();
  const isPrincipal = user?.role === "SCHOOL_PRINCIPAL";
  const isSchool = isPrincipal || user?.role === "SCHOOL_DEPUTY";
  const isDirectorate = user?.role === "DIRECTORATE_ADMIN";
  const [tab, setTab] = useState<Tab>("daily");
  const [schoolId, setSchoolId] = useState<number | null>(user?.schoolId ?? null);
  const [date, setDate] = useState(todayIso());
  const [filter, setFilter] = useState("ALL");
  const [openId, setOpenId] = useState<number | null>(null);
  const [msg, setMsg] = useState({ ok: "", err: "" });

  const daily = useApi<{ date: string; rows: DayRow[] }>(tab === "daily" && schoolId ? `/attendance/daily?schoolId=${schoolId}&date=${date}` : null);
  const events = useApi<RawEvent[]>(openId ? `/attendance/assignments/${openId}/events?date=${date}` : null);
  const corrections = useApi<Correction[]>(tab === "corrections" && schoolId ? `/attendance/corrections?schoolId=${schoolId}` : null);
  const outages = useApi<Outage[]>(tab === "outages" && schoolId ? `/attendance/outages?schoolId=${schoolId}` : null);
  const outageSummary = useApi<OutageSummary[]>(tab === "outages" && isDirectorate ? "/attendance/outages/summary" : null);

  const [manual, setManual] = useState({ eventType: "IN", time: "", reason: "" });
  const [corr, setCorr] = useState({ correctedStatus: "PRESENT", reason: "" });
  const [outageForm, setOutageForm] = useState({ date: todayIso(), from: "", to: "", outageType: "POWER", notes: "" });
  const [month, setMonth] = useState(todayIso().slice(0, 7));

  async function run(fn: () => Promise<{ message: string }>, after?: () => void) {
    setMsg({ ok: "", err: "" });
    try {
      const r = await fn();
      setMsg({ ok: r.message, err: "" });
      daily.reload(); events.reload(); corrections.reload(); outages.reload();
      after?.();
    } catch (err) {
      setMsg({ ok: "", err: (err as Error).message });
    }
  }
  const post = (path: string, body: object) => apiFetch<{ message: string }>(path, { method: "POST", body: JSON.stringify(body) });

  async function downloadExcel() {
    setMsg({ ok: "", err: "" });
    try {
      // Binary download: apiFetch parses JSON, so use fetch with the same token
      const r = await fetch(`${API_BASE}/attendance/export?month=${month}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => null))?.message ?? "تعذّر تنزيل الملف");
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `حضور-${month}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg({ ok: "تم تنزيل الملف", err: "" });
    } catch (err) {
      setMsg({ ok: "", err: (err as Error).message });
    }
  }

  const rows = daily.data?.rows ?? [];
  const counts = rows.reduce<Record<string, number>>((c, r) => ({ ...c, [r.status]: (c[r.status] ?? 0) + 1 }), {});
  const shown = rows.filter((r) => filter === "ALL" || (filter === "REVIEW" ? r.needsReview : r.status === filter));
  const opened = rows.find((r) => r.employee_assignment_id === openId);

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader title="الحضور والدوام" subtitle="تصنيف يومي للكادر مقارنة بجدول الحصص وساعات الدوام — النظام لا يحكم بالغياب آلياً" />
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <SchoolPicker value={schoolId} onChange={(id) => { setSchoolId(id); setOpenId(null); }} />
        <ul className="nav nav-pills">
          {([["daily", "اليومي"], ["corrections", "التصحيحات"], ["outages", "الانقطاعات"], ...(isPrincipal ? [["excel", "ملف Excel"]] : [])] as [Tab, string][]).map(([k, label]) => (
            <li className="nav-item" key={k}>
              <button className={`nav-link ${tab === k ? "active" : ""}`} onClick={() => { setTab(k); setOpenId(null); }}>{label}</button>
            </li>
          ))}
        </ul>
      </div>
      <Alert kind="success">{msg.ok}</Alert>
      <Alert kind="danger">{msg.err || daily.error || corrections.error || outages.error}</Alert>

      {/* ------------------------------------------------ daily */}
      {tab === "daily" && (
        <div className="row g-3">
          <div className={openId ? "col-xl-7" : "col-12"}>
            <div className="d-flex flex-wrap gap-2 mb-2 align-items-center">
              <input type="date" className="form-control" style={{ maxWidth: 170 }} value={date} max={todayIso()} onChange={(e) => { setDate(e.target.value); setOpenId(null); }} aria-label="التاريخ" />
              <button className={`btn btn-sm ${filter === "ALL" ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setFilter("ALL")}>الكل {rows.length}</button>
              <button className={`btn btn-sm ${filter === "REVIEW" ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setFilter("REVIEW")}>
                يحتاج مراجعة {rows.filter((r) => r.needsReview).length}
              </button>
              {Object.entries(counts).map(([k, n]) => (
                <button key={k} className={`btn btn-sm ${filter === k ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setFilter(k)}>
                  {DAY_STATUS[k]?.label ?? k} {n}
                </button>
              ))}
            </div>
            <div className="card border-0 shadow-sm rounded-4">
              {!schoolId ? <p className="text-secondary p-4 mb-0">اختر مدرسة.</p> : daily.loading && !daily.data ? <Loading /> : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle small mb-0">
                    <thead className="table-light">
                      <tr><th>الموظف</th><th>الصفة</th><th>الدوام المتوقع</th><th>دخول</th><th>خروج</th><th>الحالة</th><th>التفاصيل</th></tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.employee_assignment_id} role="button" className={r.employee_assignment_id === openId ? "table-primary" : ""}
                          onClick={() => { setOpenId(r.employee_assignment_id); setManual({ eventType: r.firstIn ? "OUT" : "IN", time: "", reason: "" }); }}>
                          <td className="fw-semibold">{r.full_name}<div className="text-secondary fw-normal">{r.employee_number}</div></td>
                          <td>{POSITION_LABELS[r.position_type]}</td>
                          <td className="text-secondary">{r.expectedStart ? `${r.expectedStart} – ${r.expectedEnd}` : "—"}</td>
                          <td>{r.firstIn ?? "—"}</td>
                          <td>{r.lastOut ?? "—"}</td>
                          <td><StatusBadge row={r} /></td>
                          <td className="text-secondary">{r.reasons[0]}</td>
                        </tr>
                      ))}
                      {shown.length === 0 && <tr><td colSpan={7} className="text-center text-secondary py-4">لا يوجد</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {openId && opened && (
            <div className="col-xl-5">
              <div className="card border-0 shadow-sm rounded-4 mb-3">
                <div className="card-body">
                  <div className="d-flex justify-content-between">
                    <h2 className="h6 fw-bold brand-title">{opened.full_name} — {date}</h2>
                    <button className="btn-close" aria-label="إغلاق" onClick={() => setOpenId(null)}></button>
                  </div>
                  <div className="mb-2"><StatusBadge row={opened} /></div>
                  <ul className="small mb-3">{opened.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  <h3 className="h6 fw-bold small">الأحداث الخام <span className="text-secondary fw-normal">(لا تُعدّل ولا تُحذف)</span></h3>
                  {events.loading && !events.data ? <Loading /> : (
                    <table className="table table-sm small mb-0">
                      <thead className="table-light"><tr><th>النوع</th><th>الوقت</th><th>وصل للخادم</th><th>المصدر</th><th>التطابق</th></tr></thead>
                      <tbody>
                        {events.data?.map((e) => (
                          <tr key={e.id}>
                            <td>{e.event_type === "IN" ? "دخول" : "خروج"}</td>
                            <td>{e.event_time}</td>
                            <td className="text-secondary">{e.received_at.slice(11)}</td>
                            <td>{METHOD[e.verification_method] ?? e.verification_method}{e.manual_reason && <div className="text-secondary" title={e.manual_reason}>{e.recorded_by_name}: {e.manual_reason}</div>}</td>
                            <td>{e.match_score ? `${Math.round(Number(e.match_score) * 100)}%` : "—"}</td>
                          </tr>
                        ))}
                        {events.data?.length === 0 && <tr><td colSpan={5} className="text-secondary">لا توجد أحداث</td></tr>}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {isPrincipal && (
                <form className="card border-0 shadow-sm rounded-4 mb-3" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => post("/attendance/events/manual", { employeeAssignmentId: openId, date, ...manual }), () => setManual({ ...manual, time: "", reason: "" })); }}>
                  <div className="card-body row g-2">
                    <h3 className="h6 fw-bold col-12 mb-0">إدخال يدوي بإشراف المدير <span className="text-secondary small fw-normal">(بديل غير حيوي)</span></h3>
                    <Field label="النوع" col="col-4">
                      <select className="form-select form-select-sm" value={manual.eventType} onChange={(e) => setManual({ ...manual, eventType: e.target.value })}>
                        <option value="IN">دخول</option><option value="OUT">خروج</option>
                      </select>
                    </Field>
                    <Field label="الوقت *" col="col-4"><input type="time" className="form-control form-control-sm" value={manual.time} onChange={(e) => setManual({ ...manual, time: e.target.value })} required /></Field>
                    <Field label="السبب *" col="col-12"><input className="form-control form-control-sm" value={manual.reason} onChange={(e) => setManual({ ...manual, reason: e.target.value })} required placeholder="مثال: عطل جهاز التعرّف" /></Field>
                    <div className="col-12"><button className="btn btn-sm btn-primary">تسجيل الحركة</button></div>
                  </div>
                </form>
              )}

              {isSchool && !opened.pendingCorrection && (
                <form className="card border-0 shadow-sm rounded-4" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => post("/attendance/corrections", { employeeAssignmentId: openId, workDate: date, ...corr }), () => setCorr({ ...corr, reason: "" })); }}>
                  <div className="card-body row g-2">
                    <h3 className="h6 fw-bold col-12 mb-0">اقتراح تصحيح <span className="text-secondary small fw-normal">(يحتاج اعتماد المدير، ولا يعتمده مقترحه)</span></h3>
                    <Field label="الحالة الصحيحة" col="col-5">
                      <select className="form-select form-select-sm" value={corr.correctedStatus} onChange={(e) => setCorr({ ...corr, correctedStatus: e.target.value })}>
                        {Object.entries(CORRECTED_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </Field>
                    <Field label="السبب *" col="col-7"><input className="form-control form-control-sm" value={corr.reason} onChange={(e) => setCorr({ ...corr, reason: e.target.value })} required /></Field>
                    <div className="col-12"><button className="btn btn-sm btn-outline-primary">إرسال التصحيح</button></div>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------ corrections */}
      {tab === "corrections" && (
        <div className="card border-0 shadow-sm rounded-4">
          {corrections.loading && !corrections.data ? <Loading /> : (
            <div className="table-responsive">
              <table className="table align-middle small mb-0">
                <thead className="table-light"><tr><th>الموظف</th><th>اليوم</th><th>التصحيح</th><th>السبب</th><th>اقترحه</th><th>الحالة</th>{(isPrincipal || isDirectorate) && <th></th>}</tr></thead>
                <tbody>
                  {corrections.data?.map((c) => (
                    <tr key={c.id}>
                      <td className="fw-semibold">{c.full_name}<div className="text-secondary fw-normal">{c.employee_number}</div></td>
                      <td>{c.work_date}</td>
                      <td>{CORRECTED_STATUS[c.corrected_status]}</td>
                      <td>{c.reason}</td>
                      <td>{c.proposed_by_name}<div className="text-secondary">{c.proposed_at}</div></td>
                      <td>
                        <span className={`badge ${CORRECTION_STATE[c.status].cls}`}>{CORRECTION_STATE[c.status].label}</span>
                        {c.decided_by_name && <div className="text-secondary">{c.decided_by_name}{c.decision_note && `: ${c.decision_note}`}</div>}
                      </td>
                      {(isPrincipal || isDirectorate) && (
                        <td className="text-nowrap">
                          {c.status === "PENDING" && (Number(c.proposed_by) === user?.id
                            ? <span className="text-secondary">اقتراحك — يعتمده غيرك</span>
                            : (
                              <>
                                <button className="btn btn-sm btn-success ms-1" onClick={() => run(() => post(`/attendance/corrections/${c.id}/approve`, {}))}>اعتماد</button>
                                <button className="btn btn-sm btn-outline-danger" onClick={() => {
                                  const note = window.prompt("سبب الرفض:");
                                  if (note) void run(() => post(`/attendance/corrections/${c.id}/reject`, { note }));
                                }}>رفض</button>
                              </>
                            ))}
                        </td>
                      )}
                    </tr>
                  ))}
                  {corrections.data?.length === 0 && <tr><td colSpan={7} className="text-center text-secondary py-4">لا توجد تصحيحات</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------ outages */}
      {tab === "outages" && (
        <div className="row g-3">
          {isDirectorate && (
            <div className="col-lg-4">
              <div className="card border-0 shadow-sm rounded-4">
                <div className="card-body">
                  <h2 className="h6 fw-bold brand-title">حوادث الانقطاع — آخر 30 يوماً</h2>
                  <table className="table table-sm small mb-0">
                    <tbody>
                      {outageSummary.data?.map((s) => (
                        <tr key={s.id} role="button" onClick={() => setSchoolId(Number(s.id))} className={Number(s.id) === schoolId ? "table-primary" : ""}>
                          <td>{s.name}</td><td className="fw-bold">{s.outages}</td><td className="text-secondary">{s.hours} ساعة</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          <div className={isDirectorate ? "col-lg-8" : "col-12"}>
            {isPrincipal && (
              <form className="card border-0 shadow-sm rounded-4 mb-3" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => post("/attendance/outages", outageForm), () => setOutageForm({ ...outageForm, from: "", to: "", notes: "" })); }}>
                <div className="card-body row g-2 align-items-end">
                  <h2 className="h6 fw-bold col-12 mb-0">تسجيل حادثة انقطاع <span className="text-secondary small fw-normal">— الحالات ضمن الفترة تُستثنى من التأخر والغياب</span></h2>
                  <Field label="اليوم *" col="col-md-3"><input type="date" className="form-control form-control-sm" max={todayIso()} value={outageForm.date} onChange={(e) => setOutageForm({ ...outageForm, date: e.target.value })} required /></Field>
                  <Field label="من *" col="col-md-2"><input type="time" className="form-control form-control-sm" value={outageForm.from} onChange={(e) => setOutageForm({ ...outageForm, from: e.target.value })} required /></Field>
                  <Field label="إلى *" col="col-md-2"><input type="time" className="form-control form-control-sm" value={outageForm.to} onChange={(e) => setOutageForm({ ...outageForm, to: e.target.value })} required /></Field>
                  <Field label="النوع" col="col-md-2">
                    <select className="form-select form-select-sm" value={outageForm.outageType} onChange={(e) => setOutageForm({ ...outageForm, outageType: e.target.value })}>
                      <option value="POWER">كهرباء</option><option value="INTERNET">إنترنت</option>
                    </select>
                  </Field>
                  <Field label="ملاحظات" col="col-md-3"><input className="form-control form-control-sm" value={outageForm.notes} onChange={(e) => setOutageForm({ ...outageForm, notes: e.target.value })} /></Field>
                  <div className="col-12"><button className="btn btn-sm btn-primary">تسجيل</button></div>
                </div>
              </form>
            )}
            <div className="card border-0 shadow-sm rounded-4">
              {!schoolId ? <p className="text-secondary p-4 mb-0">اختر مدرسة.</p> : (
                <table className="table align-middle small mb-0">
                  <thead className="table-light"><tr><th>النوع</th><th>من</th><th>إلى</th><th>المدة</th><th>ملاحظات</th><th>سجّلها</th></tr></thead>
                  <tbody>
                    {outages.data?.map((o) => (
                      <tr key={o.id}>
                        <td>{o.outage_type === "POWER" ? "كهرباء" : "إنترنت"}</td>
                        <td>{o.starts_at}</td><td>{o.ends_at.slice(11)}</td><td>{o.minutes} د</td><td>{o.notes}</td><td>{o.recorded_by_name}</td>
                      </tr>
                    ))}
                    {outages.data?.length === 0 && <tr><td colSpan={6} className="text-center text-secondary py-4">لا توجد حوادث مسجّلة</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ excel */}
      {tab === "excel" && isPrincipal && (
        <div className="card border-0 shadow-sm rounded-4" style={{ maxWidth: 640 }}>
          <div className="card-body">
            <h2 className="h6 fw-bold brand-title">ملف الحضور الشهري (Excel)</h2>
            <p className="small text-secondary">
              يتضمن لكل موظف ويوم: الاسم، الصفة، التاريخ، وقت الدخول، وقت الخروج — مع ورقة ثانية بكل الأحداث الخام.
              الملف يُولَّد من الأحداث المقبولة لحظة التنزيل، وهو نسخة مشتقة: تعديله بعد التنزيل لا يغيّر السجلات الأصلية. التنزيل متاح لمدير المدرسة فقط.
            </p>
            <div className="d-flex gap-2 align-items-end">
              <Field label="الشهر" col=""><input type="month" className="form-control" value={month} max={todayIso().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} /></Field>
              <button className="btn btn-primary" onClick={downloadExcel}><i className="bi bi-file-earmark-excel ms-1"></i>تنزيل</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AttendancePage;
