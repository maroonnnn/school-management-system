import { useState, type FormEvent } from "react";
import { useApi } from "../hooks/useApi";
import { apiFetch } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, Field, Loading, PageHeader, SchoolPicker } from "../components/ui";

type Status = "DRAFT" | "SUBMITTED" | "APPROVED";
interface Section { id: number; name: string }
interface Structure { classes: { id: number; name: string; sections: Section[] }[] }
interface AssessmentRow {
  id: number;
  title: string;
  assessment_type: string;
  assessment_date: string;
  max_score: string;
  status: Status;
  return_note: string | null;
  subject_name: string;
  class_name: string;
  section_name: string;
  graded_count: number;
  average: string | null;
}
interface Detail {
  assessment: AssessmentRow & { teacher_name: string; created_by_name: string | null; approved_by_name: string | null; approved_at: string | null };
  students: { enrollment_id: number; student_number: string; full_name: string; score: string | null }[];
}
interface SubjectOption { teaching_assignment_id: number; subject_name: string; teacher_name: string }

const STATUS: Record<Status, { label: string; cls: string }> = {
  DRAFT: { label: "مسودة", cls: "text-bg-secondary" },
  SUBMITTED: { label: "بانتظار الاعتماد", cls: "text-bg-warning" },
  APPROVED: { label: "معتمدة", cls: "text-bg-success" },
};
const TYPES: Record<string, string> = { QUIZ: "مذاكرة", MIDTERM: "فصلي", FINAL: "نهائي", HOMEWORK: "وظيفة", ORAL: "شفهي" };

// FR-DATA-07 / FR-AUTH-13: supervisor enters results → principal approves
function GradesPage() {
  const { user } = useAuth();
  const isSupervisor = user?.role === "SUPERVISOR";
  const isPrincipal = user?.role === "SCHOOL_PRINCIPAL";
  const [schoolId, setSchoolId] = useState<number | null>(user?.schoolId ?? null);
  const [sectionId, setSectionId] = useState<string>(isPrincipal ? "PENDING" : "");
  const [openId, setOpenId] = useState<number | null>(null);
  const [msg, setMsg] = useState({ ok: "", err: "" });

  const structure = useApi<Structure>(schoolId ? `/academics/structure?schoolId=${schoolId}` : null);
  const listPath = !schoolId || !sectionId ? null
    : sectionId === "PENDING" ? `/grades/assessments?schoolId=${schoolId}&status=SUBMITTED`
    : `/grades/assessments?schoolId=${schoolId}&sectionId=${sectionId}`;
  const list = useApi<AssessmentRow[]>(listPath);
  const subjects = useApi<SubjectOption[]>(isSupervisor && sectionId && sectionId !== "PENDING" ? `/grades/sections/${sectionId}/subjects` : null);
  const detail = useApi<Detail>(openId ? `/grades/assessments/${openId}` : null);

  const [newForm, setNewForm] = useState({ teachingAssignmentId: "", title: "", assessmentType: "QUIZ", assessmentDate: "", maxScore: "20" });
  const [showNew, setShowNew] = useState(false);
  const [scores, setScores] = useState<Record<number, string>>({});
  const [returnNote, setReturnNote] = useState("");

  async function act(path: string, method: string, body?: object, after?: () => void) {
    setMsg({ ok: "", err: "" });
    try {
      const r = await apiFetch<{ message: string; data?: { id: number } }>(path, { method, body: body ? JSON.stringify(body) : undefined });
      setMsg({ ok: r.message, err: "" });
      list.reload();
      detail.reload();
      after?.();
      return r;
    } catch (err) {
      setMsg({ ok: "", err: (err as Error).message });
    }
  }

  async function createAssessment(e: FormEvent) {
    e.preventDefault();
    const r = await act("/grades/assessments", "POST", { ...newForm, teachingAssignmentId: Number(newForm.teachingAssignmentId), maxScore: Number(newForm.maxScore) });
    if (r?.data) {
      setShowNew(false);
      openAssessment(r.data.id);
    }
  }

  function openAssessment(id: number) {
    setOpenId(id);
    setScores({});
    setReturnNote("");
  }

  const a = detail.data?.assessment;
  const editable = isSupervisor && a?.status === "DRAFT";
  const valueOf = (s: Detail["students"][number]) => scores[s.enrollment_id] ?? (s.score != null ? String(Number(s.score)) : "");
  const dirty = Object.keys(scores).length > 0;

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader title="النتائج" subtitle={isSupervisor ? "إدخال العلامات وإرسالها لمدير المدرسة" : isPrincipal ? "اعتماد النتائج المرسلة من الموجّه" : "عرض النتائج"} />
      <Alert kind="success">{msg.ok}</Alert>
      <Alert kind="danger">{msg.err || structure.error || list.error || detail.error}</Alert>

      <div className="d-flex flex-wrap gap-2 mb-3">
        <SchoolPicker value={schoolId} onChange={(id) => { setSchoolId(id); setSectionId(""); setOpenId(null); }} />
        <select className="form-select" style={{ maxWidth: 280 }} value={sectionId} onChange={(e) => { setSectionId(e.target.value); setOpenId(null); setShowNew(false); }} aria-label="الشعبة">
          <option value="">اختر الشعبة...</option>
          {isPrincipal && <option value="PENDING">⏳ بانتظار اعتمادي</option>}
          {structure.data?.classes.map((c) => (
            <optgroup key={c.id} label={c.name}>
              {c.sections.map((s) => <option key={s.id} value={s.id}>{c.name} — شعبة {s.name}</option>)}
            </optgroup>
          ))}
        </select>
        {isSupervisor && sectionId && <button className="btn btn-primary" onClick={() => setShowNew((v) => !v)}><i className="bi bi-plus-lg ms-1"></i>اختبار جديد</button>}
      </div>

      {showNew && (
        <form className="card border-0 shadow-sm rounded-4 mb-3" onSubmit={createAssessment}>
          <div className="card-body row g-3">
            <Field label="المادة *" col="col-md-4">
              <select className="form-select" value={newForm.teachingAssignmentId} onChange={(e) => setNewForm({ ...newForm, teachingAssignmentId: e.target.value })} required>
                <option value="">اختر...</option>
                {subjects.data?.map((s) => <option key={s.teaching_assignment_id} value={s.teaching_assignment_id}>{s.subject_name} — {s.teacher_name}</option>)}
              </select>
            </Field>
            <Field label="العنوان *" col="col-md-4"><input className="form-control" value={newForm.title} onChange={(e) => setNewForm({ ...newForm, title: e.target.value })} required /></Field>
            <Field label="النوع" col="col-md-2">
              <select className="form-select" value={newForm.assessmentType} onChange={(e) => setNewForm({ ...newForm, assessmentType: e.target.value })}>
                {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="العلامة العظمى" col="col-md-2"><input type="number" min={1} className="form-control" value={newForm.maxScore} onChange={(e) => setNewForm({ ...newForm, maxScore: e.target.value })} required /></Field>
            <Field label="التاريخ" col="col-md-3"><input type="date" className="form-control" value={newForm.assessmentDate} onChange={(e) => setNewForm({ ...newForm, assessmentDate: e.target.value })} /></Field>
            <div className="col-12 d-flex gap-2"><button className="btn btn-primary">إنشاء</button><button type="button" className="btn btn-outline-secondary" onClick={() => setShowNew(false)}>إلغاء</button></div>
          </div>
        </form>
      )}

      <div className="row g-3">
        <div className={openId ? "col-lg-5" : "col-12"}>
          <div className="card border-0 shadow-sm rounded-4">
            {!listPath ? <p className="text-secondary p-4 mb-0">اختر شعبة لعرض اختباراتها.</p> : list.loading && !list.data ? <Loading /> : (
              <div className="list-group list-group-flush rounded-4">
                {list.data?.map((r) => (
                  <button key={r.id} type="button" onClick={() => openAssessment(r.id)}
                    className={`list-group-item list-group-item-action py-3 ${r.id === openId ? "active" : ""}`}>
                    <div className="d-flex justify-content-between">
                      <span className="fw-semibold">{r.subject_name} — {r.title}</span>
                      <span className={`badge ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                    </div>
                    <div className={`small ${r.id === openId ? "" : "text-secondary"}`}>
                      {r.class_name} / {r.section_name} · {TYPES[r.assessment_type] ?? r.assessment_type} · {r.assessment_date.slice(0, 10)} · {r.graded_count} علامة{r.average && ` · المتوسط ${Number(r.average)} / ${Number(r.max_score)}`}
                    </div>
                  </button>
                ))}
                {list.data?.length === 0 && <p className="text-secondary p-4 mb-0">لا توجد نتائج.</p>}
              </div>
            )}
          </div>
        </div>

        {openId && (
          <div className="col-lg-7">
            <div className="card border-0 shadow-sm rounded-4">
              <div className="card-body">
                {!a ? <Loading /> : (
                  <>
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <div>
                        <h2 className="h6 fw-bold mb-1">{a.subject_name} — {a.title}</h2>
                        <div className="small text-secondary">{a.class_name} / شعبة {a.section_name} · المعلم: {a.teacher_name} · العظمى {Number(a.max_score)}</div>
                        {a.approved_by_name && <div className="small text-success">اعتمدها {a.approved_by_name} في {a.approved_at?.slice(0, 10)}</div>}
                      </div>
                      <span className={`badge ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span>
                    </div>
                    {a.return_note && a.status === "DRAFT" && <Alert kind="warning">أعادها المدير: {a.return_note}</Alert>}

                    <div className="table-responsive" style={{ maxHeight: 460 }}>
                      <table className="table table-sm align-middle mb-2">
                        <thead className="table-light sticky-top"><tr><th>#</th><th>الطالب</th><th style={{ width: 120 }}>العلامة</th></tr></thead>
                        <tbody>
                          {detail.data?.students.map((s, i) => (
                            <tr key={s.enrollment_id}>
                              <td className="text-secondary">{i + 1}</td>
                              <td>{s.full_name}</td>
                              <td>
                                {editable ? (
                                  <input type="number" min={0} max={Number(a.max_score)} step="0.25" className="form-control form-control-sm"
                                    value={valueOf(s)} aria-label={`علامة ${s.full_name}`}
                                    onChange={(e) => setScores({ ...scores, [s.enrollment_id]: e.target.value })} />
                                ) : (s.score != null ? Number(s.score) : <span className="text-secondary">—</span>)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {editable && (
                      <div className="d-flex gap-2">
                        <button className="btn btn-primary" disabled={!dirty}
                          onClick={() => act(`/grades/assessments/${a.id}/scores`, "PUT",
                            { scores: Object.entries(scores).map(([enrollmentId, score]) => ({ enrollmentId: Number(enrollmentId), score: score === "" ? null : Number(score) })) },
                            () => setScores({}))}>
                          حفظ العلامات
                        </button>
                        <button className="btn btn-success" disabled={dirty}
                          onClick={() => act(`/grades/assessments/${a.id}/submit`, "POST")}>
                          إرسال للاعتماد
                        </button>
                      </div>
                    )}
                    {isPrincipal && a.status === "SUBMITTED" && (
                      <div className="d-flex flex-wrap gap-2 align-items-center">
                        <button className="btn btn-success" onClick={() => act(`/grades/assessments/${a.id}/approve`, "POST")}>اعتماد النتيجة</button>
                        <input className="form-control" style={{ maxWidth: 260 }} placeholder="سبب الإعادة..." value={returnNote} onChange={(e) => setReturnNote(e.target.value)} />
                        <button className="btn btn-outline-danger" disabled={!returnNote.trim()}
                          onClick={() => act(`/grades/assessments/${a.id}/return`, "POST", { note: returnNote })}>إعادة للموجّه</button>
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
