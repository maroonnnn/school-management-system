import { Fragment, useState } from "react";
import { useApi } from "../hooks/useApi";
import { apiFetch } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, Loading, PageHeader, SchoolPicker } from "../components/ui";

type Status = "DRAFT" | "SUBMITTED";
interface Section { id: number; name: string }
interface Structure { classes: { id: number; name: string; sections: Section[] }[] }
interface SheetRow {
  teaching_assignment_id: number;
  subject_name: string;
  class_name: string;
  section_name: string;
  school_name: string;
  teacher_name: string;
  status: Status;
  submitted_at: string | null;
  students: number;
  entered: number;
  average: string | null;
  corrections: number;
}
interface Student { enrollment_id: number; student_number: string; full_name: string; result_id: number | null; score: string | null; corrections: number }
interface Correction { id: number; student_name: string; old_score: string; new_score: string; reason: string; corrected_by_name: string; corrected_at: string }
interface Detail {
  sheet: { teaching_assignment_id: number; subject_name: string; class_name: string; section_name: string; teacher_name: string; status: Status; submitted_at: string | null };
  students: Student[];
  corrections: Correction[];
}

const STATUS: Record<Status, { label: string; cls: string }> = {
  DRAFT: { label: "لم تُرفع", cls: "text-bg-secondary" },
  SUBMITTED: { label: "مرفوعة", cls: "text-bg-success" },
};
const TERMS = { 1: "الفصل الأول", 2: "الفصل الثاني" } as const;
const defaultTerm = () => { const m = new Date().getMonth() + 1; return m >= 9 || m === 1 ? 1 : 2; };

// FR-DATA-07 (user change 2026-11-20): teacher enters term totals → submits → supervisor reviews/corrects (reason + teacher notified)
function GradesPage() {
  const { user } = useAuth();
  const isTeacher = user?.role === "TEACHER";
  const isSupervisor = user?.role === "SUPERVISOR";
  const [term, setTerm] = useState<number>(defaultTerm());
  const [schoolId, setSchoolId] = useState<number | null>(user?.schoolId ?? null);
  const [filter, setFilter] = useState<string>(isSupervisor ? "SUBMITTED" : "");
  const [openId, setOpenId] = useState<number | null>(null);
  const [msg, setMsg] = useState({ ok: "", err: "" });
  const [scores, setScores] = useState<Record<number, string>>({});
  const [fix, setFix] = useState<{ resultId: number; name: string; old: string; score: string; reason: string } | null>(null);

  const structure = useApi<Structure>(!isTeacher && schoolId ? `/academics/structure?schoolId=${schoolId}` : null);
  const qs = new URLSearchParams({ term: String(term) });
  if (!isTeacher && schoolId) qs.set("schoolId", String(schoolId));
  if (filter === "SUBMITTED" || filter === "PENDING") qs.set("status", filter);
  else if (filter) qs.set("sectionId", filter);
  const list = useApi<SheetRow[]>(isTeacher || schoolId ? `/grades/sheets?${qs}` : null);
  const detail = useApi<Detail>(openId ? `/grades/sheets/${openId}/${term}` : null);

  async function act(path: string, method: string, body?: object, after?: () => void) {
    setMsg({ ok: "", err: "" });
    try {
      const r = await apiFetch<{ message: string }>(path, { method, body: body ? JSON.stringify(body) : undefined });
      setMsg({ ok: r.message, err: "" });
      list.reload();
      detail.reload();
      after?.();
    } catch (err) {
      setMsg({ ok: "", err: (err as Error).message });
    }
  }

  function open(id: number) { setOpenId(id); setScores({}); setFix(null); }

  const s = detail.data?.sheet;
  const editable = isTeacher && s?.status === "DRAFT";
  const canCorrect = isSupervisor && s?.status === "SUBMITTED";
  const valueOf = (st: Student) => scores[st.enrollment_id] ?? (st.score != null ? String(Number(st.score)) : "");
  const dirty = Object.keys(scores).length > 0;
  const missing = detail.data?.students.filter((st) => valueOf(st) === "").length ?? 0;

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader title="المحصّلات"
        subtitle={isTeacher ? "أدخل محصّلة كل طالب (من 100) لكل مادة ثم ارفعها للموجّه" : isSupervisor ? "مراجعة المحصّلات المرفوعة وتصحيحها عند الخطأ" : "عرض محصّلات الطلاب"} />
      <Alert kind="success">{msg.ok}</Alert>
      <Alert kind="danger">{msg.err || structure.error || list.error || detail.error}</Alert>

      <div className="d-flex flex-wrap gap-2 mb-3">
        <div className="btn-group" role="group" aria-label="الفصل">
          {([1, 2] as const).map((t) => (
            <button key={t} type="button" className={`btn ${term === t ? "btn-primary" : "btn-outline-primary"}`} onClick={() => { setTerm(t); setOpenId(null); }}>{TERMS[t]}</button>
          ))}
        </div>
        {!isTeacher && (
          <>
            <SchoolPicker value={schoolId} onChange={(id) => { setSchoolId(id); setFilter(""); setOpenId(null); }} />
            <select className="form-select" style={{ maxWidth: 280 }} value={filter} onChange={(e) => { setFilter(e.target.value); setOpenId(null); }} aria-label="تصفية">
              <option value="">كل المواد</option>
              <option value="SUBMITTED">✓ المرفوعة فقط</option>
              <option value="PENDING">⏳ لم تُرفع بعد</option>
              {structure.data?.classes.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.sections.map((sec) => <option key={sec.id} value={sec.id}>{c.name} — شعبة {sec.name}</option>)}
                </optgroup>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="row g-3">
        <div className={openId ? "col-lg-5" : "col-12"}>
          <div className="card border-0 shadow-sm rounded-4">
            {list.loading && !list.data ? <Loading /> : (
              <div className="list-group list-group-flush rounded-4" style={{ maxHeight: 620, overflowY: "auto" }}>
                {list.data?.map((r) => (
                  <button key={r.teaching_assignment_id} type="button" onClick={() => open(r.teaching_assignment_id)}
                    className={`list-group-item list-group-item-action py-3 ${r.teaching_assignment_id === openId ? "active" : ""}`}>
                    <div className="d-flex justify-content-between gap-2">
                      <span className="fw-semibold">{r.subject_name} — {r.class_name} / {r.section_name}</span>
                      <span className={`badge ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                    </div>
                    <div className={`small ${r.teaching_assignment_id === openId ? "" : "text-secondary"}`}>
                      {isTeacher ? r.school_name : `المعلم: ${r.teacher_name}`}
                      {(isTeacher || r.status === "SUBMITTED") && ` · ${r.entered}/${r.students} طالب`}
                      {r.average && r.status === "SUBMITTED" && ` · المتوسط ${Number(r.average)}`}
                      {r.corrections > 0 && ` · ${r.corrections} تصحيح`}
                    </div>
                  </button>
                ))}
                {list.data?.length === 0 && <p className="text-secondary p-4 mb-0">لا توجد مواد.</p>}
              </div>
            )}
          </div>
        </div>

        {openId && (
          <div className="col-lg-7">
            <div className="card border-0 shadow-sm rounded-4">
              <div className="card-body">
                {!s ? <Loading /> : (
                  <>
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <div>
                        <h2 className="h6 fw-bold mb-1">{s.subject_name} — {TERMS[term as 1 | 2]}</h2>
                        <div className="small text-secondary">{s.class_name} / شعبة {s.section_name} · المعلم: {s.teacher_name}{s.submitted_at && ` · رُفعت ${s.submitted_at}`}</div>
                      </div>
                      <span className={`badge ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>
                    </div>
                    {!isTeacher && s.status === "DRAFT" && <Alert kind="info">لم يرفع المعلم محصّلات هذه المادة بعد.</Alert>}
                    {isTeacher && s.status === "SUBMITTED" && <div className="small text-secondary mb-2"><i className="bi bi-lock ms-1"></i>المحصّلة مرفوعة — أي تصحيح يتم عن طريق الموجّه فقط.</div>}

                    {(isTeacher || s.status === "SUBMITTED") && (
                      <div className="table-responsive" style={{ maxHeight: 440 }}>
                        <table className="table table-sm align-middle mb-2">
                          <thead className="table-light sticky-top"><tr><th>#</th><th>الطالب</th><th style={{ width: 120 }}>المحصّلة</th>{canCorrect && <th></th>}</tr></thead>
                          <tbody>
                            {detail.data?.students.map((st, i) => (
                              <Fragment key={st.enrollment_id}>
                              <tr>
                                <td className="text-secondary">{i + 1}</td>
                                <td>{st.full_name}</td>
                                <td>
                                  {editable ? (
                                    <input type="number" min={0} max={100} step="0.5" className="form-control form-control-sm"
                                      value={valueOf(st)} aria-label={`محصّلة ${st.full_name}`}
                                      onChange={(e) => setScores({ ...scores, [st.enrollment_id]: e.target.value })} />
                                  ) : st.score != null ? (
                                    <span>{Number(st.score)}{st.corrections > 0 && <i className="bi bi-pencil-fill text-warning me-1 small" title="صُحّحت من الموجّه"></i>}</span>
                                  ) : <span className="text-secondary">—</span>}
                                </td>
                                {canCorrect && (
                                  <td>{st.result_id && (
                                    <button className="btn btn-link btn-sm p-0" onClick={() => setFix({ resultId: st.result_id!, name: st.full_name, old: String(Number(st.score)), score: String(Number(st.score)), reason: "" })}>تصحيح</button>
                                  )}</td>
                                )}
                              </tr>
                              {fix?.resultId === st.result_id && (
                                <tr className="table-warning">
                                  <td colSpan={4}>
                                    <div className="d-flex flex-wrap gap-2 align-items-center py-1">
                                      <span className="small">المحصّلة الصحيحة (الحالية {fix.old}):</span>
                                      <input type="number" min={0} max={100} step="0.5" className="form-control form-control-sm" style={{ maxWidth: 100 }} aria-label="المحصّلة الصحيحة" autoFocus
                                        value={fix.score} onChange={(e) => setFix({ ...fix, score: e.target.value })} />
                                      <input className="form-control form-control-sm" style={{ maxWidth: 260 }} placeholder="سبب التصحيح (إلزامي)" value={fix.reason}
                                        onChange={(e) => setFix({ ...fix, reason: e.target.value })} />
                                      <button className="btn btn-warning btn-sm" disabled={!fix.reason.trim() || fix.score === "" || fix.score === fix.old}
                                        onClick={() => act(`/grades/results/${fix.resultId}/correct`, "POST", { score: Number(fix.score), reason: fix.reason }, () => setFix(null))}>
                                        حفظ التصحيح
                                      </button>
                                      <button className="btn btn-outline-secondary btn-sm" onClick={() => setFix(null)}>إلغاء</button>
                                    </div>
                                    <div className="small text-secondary">سيصل إشعار للمعلم بالتصحيح والسبب.</div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {editable && (
                      <div className="d-flex flex-wrap gap-2 align-items-center">
                        <button className="btn btn-primary" disabled={!dirty}
                          onClick={() => act(`/grades/sheets/${s.teaching_assignment_id}/${term}/scores`, "PUT",
                            { scores: Object.entries(scores).map(([enrollmentId, score]) => ({ enrollmentId: Number(enrollmentId), score: score === "" ? null : Number(score) })) },
                            () => setScores({}))}>
                          حفظ
                        </button>
                        <button className="btn btn-success" disabled={dirty || missing > 0}
                          onClick={() => { if (confirm("بعد الرفع لا يمكنك التعديل، والتصحيح يتم عن طريق الموجّه فقط. متابعة؟")) act(`/grades/sheets/${s.teaching_assignment_id}/${term}/submit`, "POST"); }}>
                          رفع للموجّه
                        </button>
                        {missing > 0 && <span className="small text-secondary">{missing} طالب بدون محصّلة</span>}
                        {dirty && <span className="small text-secondary">احفظ قبل الرفع</span>}
                      </div>
                    )}

                    {detail.data && detail.data.corrections.length > 0 && (
                      <div className="mt-3">
                        <h3 className="h6 fw-bold">سجل التصحيحات</h3>
                        <ul className="list-unstyled small mb-0">
                          {detail.data.corrections.map((c) => (
                            <li key={c.id} className="border-bottom py-1">
                              <span className="fw-semibold">{c.student_name}</span>: {Number(c.old_score)} ← {Number(c.new_score)} · {c.reason}
                              <span className="text-secondary"> — {c.corrected_by_name}، {c.corrected_at}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default GradesPage;
