import { useState, type FormEvent } from "react";
import { useApi } from "../hooks/useApi";
import { apiFetch } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, Field, Loading, PageHeader, SchoolPicker } from "../components/ui";
import { WeekPicker } from "../components/schedule";
import { minutesLabel, todayIso } from "../utils/schedule";
import { DAY_LABELS, EMPLOYMENT_LABELS, LEAVE_LABELS, LESSON_STATUS } from "../config/labels";

export interface QuotaRow {
  employee_assignment_id: string;
  employee_number: string;
  full_name: string;
  employment_type: "PERMANENT" | "CONTRACT";
  years_of_service: number;
  required: number;
  scheduled: number;
  executed: number;
  compensated: number;
  not_executed: number;
  excused: number;
  upcoming: number;
  remaining: number;
  teaching_minutes: number;
  presence_minutes: number;
}
export interface Lesson {
  period_id: string;
  lesson_date: string;
  day_of_week: number;
  period_number: number;
  start_time: string;
  end_time: string;
  subject_name: string;
  class_name: string;
  section_name: string;
  status: string;
  manual_status: string | null;
  manual_notes: string | null;
  leave_type: string | null;
}
interface Leave { id: number; leave_type: string; start_date: string; end_date: string; notes: string | null; full_name: string; employee_number: string }
interface Employee { id: number; full_name: string; employee_number: string }

// FR-SCH-06 (required/executed/remaining), 07 (presence minutes), 08 (lesson log), 09 (leaves), 10 (quota vs teaching time)
function QuotaPage() {
  const { user } = useAuth();
  const isPrincipal = user?.role === "SCHOOL_PRINCIPAL";
  const [schoolId, setSchoolId] = useState<number | null>(user?.schoolId ?? null);
  const [date, setDate] = useState(todayIso());
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState({ ok: "", err: "" });

  const quota = useApi<{ week: { from: string; to: string }; teachers: QuotaRow[] }>(schoolId ? `/schedule/quota?schoolId=${schoolId}&date=${date}` : null);
  const detail = useApi<{ lessons: Lesson[] }>(openId ? `/schedule/assignments/${openId}/week?date=${date}` : null);
  const leaves = useApi<Leave[]>(schoolId ? `/schedule/leaves?schoolId=${schoolId}` : null);
  const employees = useApi<Employee[]>(isPrincipal ? `/employees?schoolId=${schoolId}` : null);
  const [leaveForm, setLeaveForm] = useState({ employeeId: "", leaveType: "SICK", startDate: "", endDate: "", notes: "" });
  const [showLeave, setShowLeave] = useState(false);

  async function run(fn: () => Promise<{ message: string }>) {
    setMsg({ ok: "", err: "" });
    try {
      const r = await fn();
      setMsg({ ok: r.message, err: "" });
      quota.reload();
      detail.reload();
      leaves.reload();
      return true;
    } catch (err) {
      setMsg({ ok: "", err: (err as Error).message });
      return false;
    }
  }

  function correct(l: Lesson, status: string) {
    let notes: string | null = null;
    if (status === "COMPENSATED" || status === "NOT_EXECUTED") {
      notes = window.prompt(status === "COMPENSATED" ? "متى وكيف عُوّضت الحصة؟" : "سبب اعتبار الحصة غير منفّذة:");
      if (!notes) return;
    }
    void run(() => apiFetch("/schedule/lessons", {
      method: "PUT",
      body: JSON.stringify({ periodId: Number(l.period_id), lessonDate: l.lesson_date, status, notes }),
    }));
  }

  async function addLeave(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => apiFetch("/schedule/leaves", {
      method: "POST",
      body: JSON.stringify({ ...leaveForm, employeeId: Number(leaveForm.employeeId), endDate: leaveForm.endDate || leaveForm.startDate }),
    }));
    if (ok) {
      setShowLeave(false);
      setLeaveForm({ employeeId: "", leaveType: "SICK", startDate: "", endDate: "", notes: "" });
    }
  }

  const rows = quota.data?.teachers ?? [];
  const totals = rows.reduce((t, r) => ({ required: t.required + r.required, executed: t.executed + r.executed, notExec: t.notExec + r.not_executed, excused: t.excused + r.excused }),
    { required: 0, executed: 0, notExec: 0, excused: 0 });
  const opened = rows.find((r) => r.employee_assignment_id === openId);

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader title="النصاب والحصص المنفّذة" subtitle="النصاب المطلوب والمنفّذ والمتبقي لكل معلم خلال الأسبوع" />
      <div className="d-flex flex-wrap gap-3 mb-3 align-items-center">
        <SchoolPicker value={schoolId} onChange={(id) => { setSchoolId(id); setOpenId(null); }} />
        <WeekPicker date={date} onChange={(d) => setDate(d)} range={quota.data?.week} />
      </div>
      <Alert kind="success">{msg.ok}</Alert>
      <Alert kind="danger">{msg.err || quota.error}</Alert>

      {rows.length > 0 && (
        <div className="d-flex flex-wrap gap-3 mb-3 small">
          <span className="badge text-bg-light border p-2">مجموع النصاب المطلوب: {totals.required}</span>
          <span className="badge text-bg-success p-2">منفّذ: {totals.executed}</span>
          <span className="badge text-bg-danger p-2">لم يُنفّذ: {totals.notExec}</span>
          <span className="badge text-bg-warning p-2">إجازات/تكليف: {totals.excused}</span>
        </div>
      )}

      <div className="row g-3">
        <div className={openId ? "col-xl-7" : "col-12"}>
          <div className="card border-0 shadow-sm rounded-4">
            {!schoolId ? <p className="text-secondary p-4 mb-0">اختر مدرسة.</p> : quota.loading && !quota.data ? <Loading /> : (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0 small">
                  <thead className="table-light">
                    <tr>
                      <th>المعلم</th><th>التعيين</th><th title="النصاب الإداري الأسبوعي">المطلوب</th><th title="حصص الجدول هذا الأسبوع">المجدول</th>
                      <th>المنفّذ</th><th>لم يُنفّذ</th><th>إجازة</th><th>المتبقي</th>
                      <th title="FR-SCH-10: المنفّذ × مدة الحصة">وقت التدريس</th><th title="FR-SCH-07: من أحداث الحضور">مدة الوجود</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.employee_assignment_id} role="button" onClick={() => setOpenId(r.employee_assignment_id)}
                        className={r.employee_assignment_id === openId ? "table-primary" : ""}>
                        <td className="fw-semibold">{r.full_name}<div className="text-secondary fw-normal">{r.employee_number}</div></td>
                        <td>
                          <span className={`badge ${r.employment_type === "CONTRACT" ? "text-bg-info" : "text-bg-light border"}`}>{EMPLOYMENT_LABELS[r.employment_type]}</span>
                          {r.employment_type === "PERMANENT" && <div className="text-secondary">{r.years_of_service} سنة</div>}
                        </td>
                        <td className="fw-bold">{r.required}</td>
                        <td>{r.scheduled}</td>
                        <td className="text-success fw-semibold">{r.executed}{r.compensated > 0 && <span className="text-info"> (+{r.compensated} تعويض)</span>}</td>
                        <td className={r.not_executed ? "text-danger fw-semibold" : ""}>{r.not_executed}</td>
                        <td>{r.excused || ""}</td>
                        <td className={r.remaining > 0 ? "text-warning fw-bold" : "text-success"}>{r.remaining}</td>
                        <td>{minutesLabel(r.teaching_minutes)}</td>
                        <td>{minutesLabel(r.presence_minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="small text-secondary mt-2 mb-0">
            المتبقي = المطلوب − المنفّذ − حصص الإجازات/التكليف. كل حصة منفّذة أو معوّضة = وحدة إدارية واحدة. الحصة تُعتبر منفّذة تلقائياً إذا غطّاها حضور المعلم، ويمكن للمدير تصحيحها.
          </p>
        </div>

        {openId && (
          <div className="col-xl-5">
            <div className="card border-0 shadow-sm rounded-4">
              <div className="card-body">
                <div className="d-flex justify-content-between mb-2">
                  <h2 className="h6 fw-bold mb-0">سجل حصص {opened?.full_name}</h2>
                  <button className="btn-close" aria-label="إغلاق" onClick={() => setOpenId(null)}></button>
                </div>
                {detail.loading && !detail.data ? <Loading /> : (
                  <div className="table-responsive" style={{ maxHeight: 520 }}>
                    <table className="table table-sm align-middle small mb-0">
                      <thead className="table-light sticky-top"><tr><th>اليوم</th><th>الحصة</th><th>المادة</th><th>الحالة</th>{isPrincipal && <th></th>}</tr></thead>
                      <tbody>
                        {detail.data?.lessons.map((l) => (
                          <tr key={`${l.period_id}-${l.lesson_date}`}>
                            <td>{DAY_LABELS[l.day_of_week]}<div className="text-secondary">{l.lesson_date}</div></td>
                            <td>{l.period_number}<div className="text-secondary">{l.start_time}</div></td>
                            <td>{l.subject_name}<div className="text-secondary">{l.class_name} / {l.section_name}</div></td>
                            <td>
                              <span className={`badge ${LESSON_STATUS[l.status]?.cls}`}>{LESSON_STATUS[l.status]?.label}</span>
                              {l.manual_status && <div className="text-secondary" title={l.manual_notes ?? ""}><i className="bi bi-pencil-square"></i> يدوي</div>}
                              {l.leave_type && <div className="text-secondary">{LEAVE_LABELS[l.leave_type]}</div>}
                            </td>
                            {isPrincipal && (
                              <td>
                                {l.status !== "UPCOMING" && l.status !== "EXCUSED" && (
                                  <div className="dropdown">
                                    <select className="form-select form-select-sm" value="" onChange={(e) => e.target.value && correct(l, e.target.value)} aria-label="تصحيح الحالة">
                                      <option value="">تصحيح...</option>
                                      <option value="EXECUTED">نُفّذت</option>
                                      <option value="COMPENSATED">عُوّضت</option>
                                      <option value="NOT_EXECUTED">لم تُنفّذ</option>
                                      {l.manual_status && <option value="AUTO">إلغاء التصحيح (تلقائي)</option>}
                                    </select>
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                        {detail.data?.lessons.length === 0 && <tr><td colSpan={5} className="text-center text-secondary py-3">لا توجد حصص هذا الأسبوع</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FR-SCH-09 */}
      <div className="card border-0 shadow-sm rounded-4 mt-4">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h2 className="h6 fw-bold mb-0">الإجازات والتكليفات الرسمية</h2>
            {isPrincipal && <button className="btn btn-sm btn-primary" onClick={() => setShowLeave((s) => !s)}><i className="bi bi-plus-lg ms-1"></i>تسجيل إجازة</button>}
          </div>
          {showLeave && (
            <form className="row g-2 mb-3 p-3 bg-light rounded-3" onSubmit={addLeave}>
              <Field label="الموظف *" col="col-md-3">
                <select className="form-select" value={leaveForm.employeeId} onChange={(e) => setLeaveForm({ ...leaveForm, employeeId: e.target.value })} required>
                  <option value="">اختر...</option>
                  {employees.data?.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </Field>
              <Field label="النوع *" col="col-md-2">
                <select className="form-select" value={leaveForm.leaveType} onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}>
                  {Object.entries(LEAVE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="من *" col="col-md-2"><input type="date" className="form-control" value={leaveForm.startDate} onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })} required /></Field>
              <Field label="إلى" col="col-md-2"><input type="date" className="form-control" value={leaveForm.endDate} min={leaveForm.startDate} onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })} /></Field>
              <Field label="ملاحظات" col="col-md-3"><input className="form-control" value={leaveForm.notes} onChange={(e) => setLeaveForm({ ...leaveForm, notes: e.target.value })} /></Field>
              <div className="col-12 d-flex gap-2"><button className="btn btn-primary btn-sm">حفظ</button><button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShowLeave(false)}>إلغاء</button></div>
            </form>
          )}
          <div className="table-responsive">
            <table className="table table-sm align-middle small mb-0">
              <thead className="table-light"><tr><th>الموظف</th><th>النوع</th><th>من</th><th>إلى</th><th>ملاحظات</th>{isPrincipal && <th></th>}</tr></thead>
              <tbody>
                {leaves.data?.map((l) => (
                  <tr key={l.id}>
                    <td>{l.full_name}</td>
                    <td>{LEAVE_LABELS[l.leave_type]}</td>
                    <td>{l.start_date}</td>
                    <td>{l.end_date}</td>
                    <td>{l.notes}</td>
                    {isPrincipal && (
                      <td><button className="btn btn-sm btn-link text-danger" onClick={() => window.confirm("حذف هذه الإجازة؟") && run(() => apiFetch(`/schedule/leaves/${l.id}`, { method: "DELETE" }))}>حذف</button></td>
                    )}
                  </tr>
                ))}
                {leaves.data?.length === 0 && <tr><td colSpan={6} className="text-center text-secondary py-3">لا توجد إجازات مسجّلة</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default QuotaPage;
