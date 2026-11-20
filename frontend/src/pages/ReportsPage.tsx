import { useState, type ReactNode } from "react";
import { useApi } from "../hooks/useApi";
import { API_BASE, ApiError, apiFetch, getToken } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, Loading, PageHeader, SchoolPicker } from "../components/ui";
import { Stat } from "../components/schedule";
import { CORRECTED_STATUS, CORRECTION_STATE, DAY_STATUS, LEAVE_LABELS, LESSON_STATUS, POSITION_LABELS, REQUEST_STATUS, REQUEST_TYPE, STAGE_LABELS } from "../config/labels";
import type { Role } from "../types/auth";

// FR-RPT-01..09: teacher, school, requests and central reports. Excel from the server; PDF = browser print (Arabic RTL, Cairo font).

type Tab = "teacher" | "school" | "requests" | "central";
const TABS: { id: Tab; label: string; icon: string; roles: Role[] }[] = [
  { id: "teacher", label: "تقرير المعلم", icon: "bi-person-badge", roles: ["TEACHER", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "DIRECTORATE_ADMIN"] },
  { id: "school", label: "تقرير المدرسة", icon: "bi-building", roles: ["SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "DIRECTORATE_ADMIN"] },
  { id: "requests", label: "تقرير الطلبات", icon: "bi-inbox", roles: ["DIRECTORATE_ADMIN", "MINISTRY_ADMIN"] },
  { id: "central", label: "التقرير المركزي", icon: "bi-globe2", roles: ["DIRECTORATE_ADMIN", "MINISTRY_ADMIN"] },
];

const pct = (x: number | null | undefined) => (x == null ? "—" : `${x}%`);
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const monthStart = () => new Date().toISOString().slice(0, 8) + "01";
const today = () => new Date().toISOString().slice(0, 10);

async function downloadXlsx(path: string, fileName: string) {
  const r = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => null))?.message ?? "تعذّر تنزيل الملف");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await r.blob());
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ExportButtons({ path, fileName, onError }: { path: string; fileName: string; onError: (m: string) => void }) {
  return (
    <div className="d-flex gap-2 no-print">
      <button className="btn btn-outline-success" onClick={() => downloadXlsx(path, fileName).catch((e) => onError((e as Error).message))}>
        <i className="bi bi-file-earmark-excel ms-1"></i>Excel
      </button>
      <button className="btn btn-outline-secondary" onClick={() => window.print()}><i className="bi bi-printer ms-1"></i>طباعة / PDF</button>
    </div>
  );
}

/** Official header shown only on paper. */
function PrintHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="print-only print-header">
      <img src="/brand/emblem.webp" alt="" />
      <div>
        <div className="fw-bold">الجمهورية العربية السورية — وزارة التربية والتعليم</div>
        <div className="fs-5 fw-bold">{title}</div>
        <div className="small">{sub} · تاريخ الطباعة: {new Date().toLocaleString("ar-SY")}</div>
      </div>
    </div>
  );
}

function Signatures({ names }: { names: string[] }) {
  return (
    <div className="print-only print-signatures">
      {names.map((n) => <div key={n}><div>{n}</div><div className="sig-line"></div></div>)}
    </div>
  );
}

function Card({ title, children, extra }: { title?: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="card border-0 shadow-sm rounded-4 mb-3">
      <div className="card-body">
        {(title || extra) && <div className="d-flex justify-content-between align-items-center mb-2">{title && <h2 className="h6 fw-bold mb-0">{title}</h2>}{extra}</div>}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- teacher

interface TeacherOption { assignment_id: number; full_name: string; employee_number: string; school_name: string }
interface DayCounts { dutyDays: number; present: number; late: number; earlyLeave: number; incomplete: number; possibleAbsence: number; absent: number; excused: number; outage: number; corrected: number; lateMinutes: number; earlyMinutes: number; attendanceRate: number | null }
interface Quota { employmentType: string; requiredWeekly: number; required: number; scheduled: number; executed: number; compensated: number; notExecuted: number; excused: number; remaining: number; completion: number | null; teachingMinutes: number; presenceMinutes: number }
interface TeacherReport {
  teacher: { assignmentId: number; employeeNumber: string; name: string; schoolId: number; schoolName: string };
  period: { from: string; to: string; complete: boolean };
  workingDays: number;
  days: { date: string; status: string; correctedStatus: string | null; firstIn: string | null; lastOut: string | null; expectedStart: string | null; expectedEnd: string | null; reasons: string[]; pendingCorrection: boolean }[];
  dayCounts: DayCounts;
  lessons: { lesson_date: string; period_number: number; subject_name: string; class_name: string; section_name: string; status: string }[];
  quota: Quota | null;
  contractEstimate: { rate: number; amount: number } | null;
  leaves: { leave_type: string; start_date: string; end_date: string; notes: string | null }[];
  corrections: { work_date: string; corrected_status: string; reason: string; status: string; proposed_by_name: string; decided_by_name: string | null }[];
  pending: { pendingCorrections: number; incompleteDays: number; possibleAbsences: number };
  approval: { approved_by_name: string; approved_at: string; notes: string | null } | null;
}

function TeacherTab({ initial, onError }: { initial: number | null; onError: (m: string) => void }) {
  const { user } = useAuth();
  const isTeacher = user?.role === "TEACHER";
  const [schoolId, setSchoolId] = useState<number | null>(user?.schoolId ?? null);
  const [ea, setEa] = useState<number | null>(initial);
  const [month, setMonth] = useState(prevMonth());
  const [ack, setAck] = useState(false);
  const [notes, setNotes] = useState("");
  const [ok, setOk] = useState("");
  const teachers = useApi<TeacherOption[]>(isTeacher ? "/reports/teachers" : schoolId ? `/reports/teachers?schoolId=${schoolId}` : null);
  const selected = ea ?? (isTeacher ? teachers.data?.[0]?.assignment_id ?? null : null);
  const report = useApi<TeacherReport>(selected ? `/reports/teacher?assignmentId=${selected}&month=${month}` : null);
  const r = report.data;

  async function approve() {
    onError(""); setOk("");
    try {
      const res = await apiFetch<{ message: string }>("/reports/teacher/approve", { method: "POST", body: JSON.stringify({ assignmentId: selected, month, notes, acknowledgeAbsences: ack }) });
      setOk(res.message);
      report.reload();
    } catch (e) { onError((e as Error).message); }
  }

  const dc = r?.dayCounts;
  const q = r?.quota;
  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3 no-print">
        {!isTeacher && <SchoolPicker value={schoolId} onChange={(id) => { setSchoolId(id); setEa(null); }} />}
        {(!isTeacher || (teachers.data?.length ?? 0) > 1) && (
          <select className="form-select" style={{ maxWidth: 300 }} value={selected ?? ""} onChange={(e) => setEa(Number(e.target.value) || null)} aria-label="المعلم">
            <option value="">اختر المعلم...</option>
            {teachers.data?.map((t) => <option key={t.assignment_id} value={t.assignment_id}>{isTeacher ? t.school_name : `${t.full_name} (${t.employee_number})`}</option>)}
          </select>
        )}
        <input type="month" className="form-control" style={{ maxWidth: 170 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="الشهر" />
      </div>
      <Alert kind="success">{ok}</Alert>
      <Alert kind="danger">{report.error}</Alert>
      {!selected ? <p className="text-secondary">اختر معلماً لعرض تقريره.</p> : !r ? <Loading /> : (
        <div className="report-print-area">
          <PrintHeader title={`التقرير الشهري للمعلم — ${month}`} sub={`${r.teacher.name} · ${r.teacher.employeeNumber} · ${r.teacher.schoolName}`} />
          <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
            <div>
              <h2 className="h5 fw-bold mb-1">{r.teacher.name} <span className="text-secondary fs-6">({r.teacher.employeeNumber})</span></h2>
              <div className="small text-secondary">{r.teacher.schoolName} · الفترة {r.period.from} → {r.period.to}{!r.period.complete && " (الشهر لم ينتهِ — حتى اليوم)"} · {r.workingDays} يوم عمل</div>
              {r.approval
                ? <span className="badge text-bg-success mt-1">معتمد — {r.approval.approved_by_name} · {r.approval.approved_at}</span>
                : <span className="badge text-bg-secondary mt-1">غير معتمد</span>}
            </div>
            <ExportButtons path={`/reports/teacher?assignmentId=${selected}&month=${month}&format=xlsx`} fileName={`تقرير ${r.teacher.name} ${month}.xlsx`} onError={onError} />
          </div>

          <div className="row g-2 mb-3">
            <Stat label="نسبة الحضور" value={pct(dc!.attendanceRate)} hint={`${dc!.dutyDays} يوم دوام`} tone="success" />
            <Stat label="تأخر" value={dc!.late} hint={`${dc!.lateMinutes} دقيقة`} tone="warning" />
            <Stat label="خروج مبكر" value={dc!.earlyLeave} hint={`${dc!.earlyMinutes} دقيقة`} tone="warning" />
            <Stat label="تسجيل ناقص" value={dc!.incomplete} tone="danger" />
            <Stat label="غياب محتمل" value={dc!.possibleAbsence} tone="danger" />
            <Stat label="إجازة" value={dc!.excused} hint={dc!.corrected ? `${dc!.corrected} يوم مصحّح` : undefined} tone="secondary" />
          </div>
          {q && (
            <div className="row g-2 mb-3">
              <Stat label="النصاب المطلوب للفترة" value={q.required} hint={`${q.requiredWeekly} أسبوعياً`} />
              <Stat label="حصص منفّذة" value={q.executed} hint={q.compensated ? `منها ${q.compensated} معوّضة` : undefined} tone="success" />
              <Stat label="غير منفّذة" value={q.notExecuted} tone="danger" />
              <Stat label="حصص إجازة" value={q.excused} tone="secondary" />
              <Stat label="إنجاز النصاب" value={pct(q.completion)} hint={`المتبقي ${q.remaining}`} />
              {r.contractEstimate && <Stat label="تقدير أجر الوكيل" value={r.contractEstimate.amount.toLocaleString("ar-SY")} hint="ل.س — مؤشر وليس راتباً رسمياً" tone="secondary" />}
            </div>
          )}

          {user?.role === "SCHOOL_PRINCIPAL" && !r.approval && (
            <div className="card border-warning mb-3 no-print">
              <div className="card-body">
                <h3 className="h6 fw-bold">اعتماد التقرير</h3>
                {!r.period.complete ? <p className="small text-secondary mb-0">يمكن الاعتماد بعد انتهاء الشهر.</p> : (
                  <>
                    <ul className="small mb-2">
                      <li className={r.pending.pendingCorrections ? "text-danger" : "text-success"}>تصحيحات بانتظار القرار: {r.pending.pendingCorrections}</li>
                      <li className={r.pending.incompleteDays ? "text-danger" : "text-success"}>أيام بتسجيل ناقص: {r.pending.incompleteDays}</li>
                      <li className={r.pending.possibleAbsences ? "text-warning" : "text-success"}>أيام غياب محتمل: {r.pending.possibleAbsences}</li>
                    </ul>
                    {r.pending.possibleAbsences > 0 && (
                      <div className="form-check mb-2">
                        <input className="form-check-input" type="checkbox" id="ack" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                        <label className="form-check-label small" htmlFor="ack">راجعت أيام الغياب المحتمل وأوافق على اعتبارها كما هي</label>
                      </div>
                    )}
                    <div className="d-flex flex-wrap gap-2">
                      <input className="form-control" style={{ maxWidth: 360 }} placeholder="ملاحظات (اختياري)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                      <button className="btn btn-success" disabled={r.pending.pendingCorrections > 0 || r.pending.incompleteDays > 0 || (r.pending.possibleAbsences > 0 && !ack)} onClick={approve}>اعتماد التقرير</button>
                    </div>
                    {(r.pending.pendingCorrections > 0 || r.pending.incompleteDays > 0) && <div className="small text-danger mt-1">عالج الحالات المعلّقة من صفحة الحضور أولاً.</div>}
                  </>
                )}
              </div>
            </div>
          )}

          <Card title="الحضور اليومي">
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead className="table-light"><tr><th>التاريخ</th><th>الحالة</th><th>الدوام المتوقع</th><th>الدخول</th><th>الخروج</th><th>التعليل</th></tr></thead>
                <tbody>
                  {r.days.filter((d) => d.status !== "NO_DUTY").map((d) => {
                    const st = DAY_STATUS[d.status];
                    return (
                      <tr key={d.date}>
                        <td className="text-nowrap">{d.date}</td>
                        <td><span className={`badge ${st?.cls ?? "text-bg-light"}`}>{st?.label ?? d.status}{d.correctedStatus && ` ← ${CORRECTED_STATUS[d.correctedStatus] ?? d.correctedStatus}`}</span>{d.pendingCorrection && <span className="badge text-bg-warning me-1">تصحيح معلّق</span>}</td>
                        <td className="text-nowrap small">{d.expectedStart ? `${d.expectedStart}–${d.expectedEnd}` : "—"}</td>
                        <td>{d.firstIn ?? "—"}</td>
                        <td>{d.lastOut ?? "—"}</td>
                        <td className="small text-secondary">{d.reasons.join("، ")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="row g-3">
            <div className="col-lg-6">
              <Card title="الإجازات">
                {r.leaves.length === 0 ? <p className="small text-secondary mb-0">لا توجد إجازات.</p> : (
                  <ul className="small mb-0">{r.leaves.map((l, i) => <li key={i}>{LEAVE_LABELS[l.leave_type] ?? l.leave_type}: {l.start_date} → {l.end_date}{l.notes && ` · ${l.notes}`}</li>)}</ul>
                )}
              </Card>
            </div>
            <div className="col-lg-6">
              <Card title="تصحيحات الحضور">
                {r.corrections.length === 0 ? <p className="small text-secondary mb-0">لا توجد تصحيحات.</p> : (
                  <ul className="small mb-0">{r.corrections.map((c, i) => (
                    <li key={i}>{c.work_date}: {CORRECTED_STATUS[c.corrected_status] ?? c.corrected_status} · {c.reason} · <span className={`badge ${CORRECTION_STATE[c.status]?.cls ?? ""}`}>{CORRECTION_STATE[c.status]?.label ?? c.status}</span></li>
                  ))}</ul>
                )}
              </Card>
            </div>
          </div>

          <Card title={`سجل الحصص (${r.lessons.length})`}>
            <div className="table-responsive" style={{ maxHeight: 360 }}>
              <table className="table table-sm mb-0">
                <thead className="table-light sticky-top"><tr><th>التاريخ</th><th>الحصة</th><th>المادة</th><th>الشعبة</th><th>الحالة</th></tr></thead>
                <tbody>{r.lessons.map((l, i) => (
                  <tr key={i}><td>{l.lesson_date}</td><td>{l.period_number}</td><td>{l.subject_name}</td><td>{l.class_name} / {l.section_name}</td>
                    <td><span className={`badge ${LESSON_STATUS[l.status]?.cls ?? ""}`}>{LESSON_STATUS[l.status]?.label ?? l.status}</span></td></tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
          <Signatures names={["المعلم", "مدير المدرسة"]} />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- school

interface SchoolRow extends DayCounts { assignmentId: number; employeeNumber: string; name: string; position: string; quota: Quota | null; reportApproved: boolean | null }
interface SchoolReport {
  school: { id: number; name: string };
  period: { from: string; to: string; complete: boolean };
  workingDays: number;
  rows: SchoolRow[];
  totals: DayCounts & { people: number; teachers: number; lessonsDue: number; lessonsExecuted: number; quotaCompletion: number | null; reportsApproved: number };
}

function SchoolTab({ onOpenTeacher, onError }: { onOpenTeacher: (ea: number) => void; onError: (m: string) => void }) {
  const { user } = useAuth();
  const [schoolId, setSchoolId] = useState<number | null>(user?.schoolId ?? null);
  const [month, setMonth] = useState(prevMonth());
  const rep = useApi<SchoolReport>(schoolId ? `/reports/school?schoolId=${schoolId}&month=${month}` : null);
  const r = rep.data;
  const t = r?.totals;
  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3 no-print">
        <SchoolPicker value={schoolId} onChange={setSchoolId} />
        <input type="month" className="form-control" style={{ maxWidth: 170 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="الشهر" />
      </div>
      <Alert kind="danger">{rep.error}</Alert>
      {!schoolId ? <p className="text-secondary">اختر مدرسة.</p> : !r || !t ? <Loading /> : (
        <div className="report-print-area">
          <PrintHeader title={`التقرير الشهري المجمّع — ${r.school.name}`} sub={`${month} · ${r.period.from} → ${r.period.to}`} />
          <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
            <div>
              <h2 className="h5 fw-bold mb-1">{r.school.name}</h2>
              <div className="small text-secondary">الفترة {r.period.from} → {r.period.to}{!r.period.complete && " (حتى اليوم)"} · {r.workingDays} يوم عمل · {t.people} موظف</div>
            </div>
            <ExportButtons path={`/reports/school?schoolId=${schoolId}&month=${month}&format=xlsx`} fileName={`تقرير ${r.school.name} ${month}.xlsx`} onError={onError} />
          </div>
          <div className="row g-2 mb-3">
            <Stat label="نسبة الحضور" value={pct(t.attendanceRate)} hint={`${t.dutyDays} يوم-موظف`} tone="success" />
            <Stat label="تأخر" value={t.late} hint={`${t.lateMinutes} دقيقة`} tone="warning" />
            <Stat label="غياب محتمل" value={t.possibleAbsence} tone="danger" />
            <Stat label="تسجيل ناقص" value={t.incomplete} tone="danger" />
            <Stat label="إنجاز النصاب" value={pct(t.quotaCompletion)} hint={`${t.lessonsExecuted} من ${t.lessonsDue}`} />
            <Stat label="تقارير معتمدة" value={`${t.reportsApproved}/${t.teachers}`} tone="secondary" />
          </div>
          <Card>
            <div className="table-responsive">
              <table className="table table-sm table-hover align-middle mb-0">
                <thead className="table-light"><tr>
                  <th>الاسم</th><th>الصفة</th><th>دوام</th><th>حضور</th><th>تأخر</th><th>خروج مبكر</th><th>ناقص</th><th>غياب محتمل</th><th>إجازة</th><th>نسبة الحضور</th><th>إنجاز النصاب</th><th>التقرير</th>
                </tr></thead>
                <tbody>
                  {r.rows.map((x) => (
                    <tr key={x.assignmentId} style={{ cursor: x.quota ? "pointer" : undefined }} onClick={() => x.quota && onOpenTeacher(x.assignmentId)}>
                      <td>{x.name}</td><td className="small">{POSITION_LABELS[x.position] ?? x.position}</td><td>{x.dutyDays}</td><td>{x.present}</td>
                      <td className={x.late ? "text-warning fw-semibold" : ""}>{x.late}</td><td>{x.earlyLeave}</td>
                      <td className={x.incomplete ? "text-danger" : ""}>{x.incomplete}</td><td className={x.possibleAbsence ? "text-danger fw-semibold" : ""}>{x.possibleAbsence}</td>
                      <td>{x.excused}</td><td>{pct(x.attendanceRate)}</td>
                      <td>{x.quota ? `${pct(x.quota.completion)} (${x.quota.executed})` : "—"}</td>
                      <td>{x.reportApproved == null ? "" : x.reportApproved ? <span className="badge text-bg-success">معتمد</span> : <span className="badge text-bg-light">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="small text-secondary mt-2 no-print">اضغط على اسم معلم لفتح تقريره التفصيلي.</div>
          </Card>
          <Signatures names={["مدير المدرسة", "المديرية"]} />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- requests

interface ReqSummary { total: number; open: number; approved: number; rejected: number; completed: number; overdue: number; avgDaysToDecision: number | null; avgDaysToCompletion: number | null }
interface RequestsReport {
  period: { from: string; to: string };
  overdueDays: number;
  totals: ReqSummary;
  byType: Record<string, number>;
  schools: (ReqSummary & { schoolId: number; schoolName: string })[];
  overdue: { id: number; request_number: string; school_name: string; request_type: string; title: string; status: string; waiting_days: number }[];
}

function PeriodPicker({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <>
      <label className="d-flex align-items-center gap-1 small">من<input type="date" className="form-control" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="d-flex align-items-center gap-1 small">إلى<input type="date" className="form-control" value={to} onChange={(e) => setTo(e.target.value)} /></label>
    </>
  );
}

function RequestsTab({ onError }: { onError: (m: string) => void }) {
  const [from, setFrom] = useState("2026-09-01");
  const [to, setTo] = useState(today());
  const qs = `from=${from}&to=${to}`;
  const rep = useApi<RequestsReport>(from && to ? `/reports/requests?${qs}` : null);
  const r = rep.data;
  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3 no-print"><PeriodPicker {...{ from, to, setFrom, setTo }} /></div>
      <Alert kind="danger">{rep.error}</Alert>
      {!r ? <Loading /> : (
        <div className="report-print-area">
          <PrintHeader title="تقرير الطلبات" sub={`${r.period.from} → ${r.period.to}`} />
          <div className="d-flex justify-content-between align-items-start mb-3">
            <div className="small text-secondary">الفترة {r.period.from} → {r.period.to} · المتأخر = مفتوح منذ أكثر من {r.overdueDays} أيام</div>
            <ExportButtons path={`/reports/requests?${qs}&format=xlsx`} fileName={`تقرير الطلبات ${from} ${to}.xlsx`} onError={onError} />
          </div>
          <div className="row g-2 mb-3">
            <Stat label="إجمالي الطلبات" value={r.totals.total} />
            <Stat label="مفتوحة" value={r.totals.open} tone="warning" />
            <Stat label="متأخرة" value={r.totals.overdue} tone="danger" />
            <Stat label="منجزة" value={r.totals.completed} tone="success" />
            <Stat label="متوسط أيام القرار" value={r.totals.avgDaysToDecision ?? "—"} tone="secondary" />
            <Stat label="متوسط أيام الإنجاز" value={r.totals.avgDaysToCompletion ?? "—"} tone="secondary" />
          </div>
          <div className="row g-3">
            <div className="col-lg-8">
              <Card title="حسب المدرسة">
                <div className="table-responsive">
                  <table className="table table-sm mb-0">
                    <thead className="table-light"><tr><th>المدرسة</th><th>الإجمالي</th><th>مفتوحة</th><th>مقبولة</th><th>مرفوضة</th><th>منجزة</th><th>متأخرة</th><th>أيام القرار</th></tr></thead>
                    <tbody>{r.schools.map((s) => (
                      <tr key={s.schoolId}><td>{s.schoolName}</td><td>{s.total}</td><td>{s.open}</td><td>{s.approved}</td><td>{s.rejected}</td><td>{s.completed}</td>
                        <td className={s.overdue ? "text-danger fw-semibold" : ""}>{s.overdue}</td><td>{s.avgDaysToDecision ?? "—"}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </Card>
            </div>
            <div className="col-lg-4">
              <Card title="حسب النوع">
                <ul className="list-unstyled small mb-0">
                  {Object.entries(r.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                    <li key={k} className="d-flex justify-content-between border-bottom py-1"><span>{REQUEST_TYPE[k] ?? k}</span><span className="fw-semibold">{v}</span></li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
          <Card title={`الطلبات المتأخرة (${r.overdue.length})`}>
            {r.overdue.length === 0 ? <p className="small text-secondary mb-0">لا توجد طلبات متأخرة.</p> : (
              <div className="table-responsive">
                <table className="table table-sm mb-0">
                  <thead className="table-light"><tr><th>الرقم</th><th>المدرسة</th><th>النوع</th><th>العنوان</th><th>الحالة</th><th>أيام الانتظار</th></tr></thead>
                  <tbody>{r.overdue.map((x) => (
                    <tr key={x.id}><td className="small">{x.request_number}</td><td>{x.school_name}</td><td>{REQUEST_TYPE[x.request_type] ?? x.request_type}</td><td>{x.title}</td>
                      <td><span className={`badge ${REQUEST_STATUS[x.status]?.cls ?? ""}`}>{REQUEST_STATUS[x.status]?.label ?? x.status}</span></td><td className="text-danger fw-semibold">{x.waiting_days}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- central

interface Agg { schools: number; students: number; teachers: number; staff: number; attendanceRate: number | null; quotaCompletion: number | null; requestsOpen: number; requestsOverdue: number; outages: number }
interface CentralReport {
  period: { from: string; to: string };
  totals: Agg;
  directorates: (Agg & { directorateId: number; directorateName: string })[];
  schools: { schoolId: number; schoolName: string; stage: number; directorateName: string; students: number; teachers: number; staff: number; attendanceRate: number | null; quotaCompletion: number | null; requestsOpen: number; requestsOverdue: number; outages: number; resultsAverage: number | null }[];
}

function CentralTab({ onError }: { onError: (m: string) => void }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const qs = `from=${from}&to=${to}`;
  const rep = useApi<CentralReport>(from && to ? `/reports/central?${qs}` : null);
  const r = rep.data;
  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3 no-print"><PeriodPicker {...{ from, to, setFrom, setTo }} /></div>
      <Alert kind="danger">{rep.error}</Alert>
      {!r ? <Loading /> : (
        <div className="report-print-area">
          <PrintHeader title="التقرير المركزي المجمّع" sub={`${r.period.from} → ${r.period.to}`} />
          <div className="d-flex justify-content-between align-items-start mb-3">
            <div className="small text-secondary">أرقام مجمّعة فقط · الفترة {r.period.from} → {r.period.to}</div>
            <ExportButtons path={`/reports/central?${qs}&format=xlsx`} fileName={`التقرير المركزي ${from} ${to}.xlsx`} onError={onError} />
          </div>
          <div className="row g-2 mb-3">
            <Stat label="المدارس" value={r.totals.schools} hint={`${r.totals.students} طالب`} />
            <Stat label="المعلمون" value={r.totals.teachers} hint={`${r.totals.staff} إداري`} tone="secondary" />
            <Stat label="نسبة الحضور" value={pct(r.totals.attendanceRate)} tone="success" />
            <Stat label="إنجاز النصاب" value={pct(r.totals.quotaCompletion)} />
            <Stat label="طلبات مفتوحة" value={r.totals.requestsOpen} hint={`${r.totals.requestsOverdue} متأخرة`} tone="warning" />
            <Stat label="انقطاعات" value={r.totals.outages} tone="secondary" />
          </div>
          <Card title="حسب المديرية">
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead className="table-light"><tr><th>المديرية</th><th>مدارس</th><th>طلاب</th><th>معلمون</th><th>الحضور</th><th>النصاب</th><th>مفتوحة</th><th>متأخرة</th><th>انقطاعات</th></tr></thead>
                <tbody>{r.directorates.map((d) => (
                  <tr key={d.directorateId}><td>{d.directorateName}</td><td>{d.schools}</td><td>{d.students}</td><td>{d.teachers}</td><td>{pct(d.attendanceRate)}</td>
                    <td>{pct(d.quotaCompletion)}</td><td>{d.requestsOpen}</td><td>{d.requestsOverdue}</td><td>{d.outages}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
          <Card title="حسب المدرسة">
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead className="table-light"><tr><th>المدرسة</th><th>الحلقة</th><th>طلاب</th><th>معلمون</th><th>الحضور</th><th>النصاب</th><th>مفتوحة</th><th>متأخرة</th><th>انقطاعات</th><th>متوسط المحصّلات</th></tr></thead>
                <tbody>{r.schools.map((s) => (
                  <tr key={s.schoolId}><td>{s.schoolName}</td><td className="small">{STAGE_LABELS[s.stage] ?? s.stage}</td><td>{s.students}</td><td>{s.teachers}</td>
                    <td>{pct(s.attendanceRate)}</td><td>{pct(s.quotaCompletion)}</td><td>{s.requestsOpen}</td><td className={s.requestsOverdue ? "text-danger" : ""}>{s.requestsOverdue}</td>
                    <td>{s.outages}</td><td>{s.resultsAverage ?? "—"}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- page

function ReportsPage() {
  const { user } = useAuth();
  const tabs = TABS.filter((t) => user && t.roles.includes(user.role));
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "teacher");
  const [teacherEa, setTeacherEa] = useState<number | null>(null);
  const [err, setErr] = useState("");
  return (
    <div className="container-fluid p-3 p-lg-4">
      <div className="no-print"><PageHeader title="التقارير" subtitle="تقارير شهرية ومجمّعة، تصدير Excel وطباعة/حفظ PDF بالعربية" /></div>
      {tabs.length > 1 && (
        <ul className="nav nav-tabs mb-3 no-print">
          {tabs.map((t) => (
            <li key={t.id} className="nav-item">
              <button type="button" className={`nav-link ${tab === t.id ? "active" : ""}`} onClick={() => { setTab(t.id); setErr(""); }}>
                <i className={`bi ${t.icon} ms-1`}></i>{t.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Alert kind="danger">{err}</Alert>
      {tab === "teacher" && <TeacherTab key={teacherEa ?? 0} initial={teacherEa} onError={setErr} />}
      {tab === "school" && <SchoolTab onOpenTeacher={(ea) => { setTeacherEa(ea); setTab("teacher"); }} onError={setErr} />}
      {tab === "requests" && <RequestsTab onError={setErr} />}
      {tab === "central" && <CentralTab onError={setErr} />}
    </div>
  );
}

export default ReportsPage;
