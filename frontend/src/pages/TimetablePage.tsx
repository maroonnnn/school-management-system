import { useState, type FormEvent } from "react";
import { useApi } from "../hooks/useApi";
import { apiFetch } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, Field, Loading, PageHeader, SchoolPicker } from "../components/ui";
import { TimetableGrid } from "../components/schedule";
import { useScheduleConfig } from "../utils/schedule";
import { DAY_LABELS, TRACK_LABELS } from "../config/labels";

interface Structure { classes: { id: number; name: string; sections: { id: number; name: string; track: string | null }[] }[] }
interface Cell { id: number; day_of_week: number; period_number: number; teaching_assignment_id: number; subject_name: string; teacher_name: string }
interface Option { teaching_assignment_id: number; subject_name: string; teacher_name: string; planned_units: number; scheduled_units: number }
interface Timetable { periods: Cell[]; options: Option[] }
interface Teacher { assignment_id: number; full_name: string; position_type: string; specialization: string | null }

// FR-SCH-01: the school enters each section's weekly timetable (day, time, subject, teacher)
function TimetablePage() {
  const { user } = useAuth();
  const canEdit = user?.role === "SCHOOL_PRINCIPAL" || user?.role === "SCHOOL_DEPUTY";
  const [schoolId, setSchoolId] = useState<number | null>(user?.schoolId ?? null);
  const [sectionId, setSectionId] = useState("");
  const [editing, setEditing] = useState<{ day: number; period: number } | null>(null);
  const [msg, setMsg] = useState({ ok: "", err: "" });
  const [showAssign, setShowAssign] = useState(false);
  const [assign, setAssign] = useState({ subjectId: "", employeeAssignmentId: "", weeklyUnits: "2" });

  const config = useScheduleConfig();
  const structure = useApi<Structure>(schoolId ? `/academics/structure?schoolId=${schoolId}` : null);
  const tt = useApi<Timetable>(sectionId ? `/schedule/sections/${sectionId}/timetable` : null);
  const subjects = useApi<{ id: number; name: string }[]>(canEdit ? "/academics/subjects" : null);
  const teachers = useApi<Teacher[]>(canEdit && schoolId ? `/employees?schoolId=${schoolId}` : null);

  const cellAt = (d: number, p: number) => tt.data?.periods.find((c) => c.day_of_week === d && c.period_number === p);
  const section = structure.data?.classes.flatMap((c) => c.sections.map((s) => ({ ...s, className: c.name }))).find((s) => String(s.id) === sectionId);

  async function run(fn: () => Promise<{ message: string }>) {
    setMsg({ ok: "", err: "" });
    try {
      const r = await fn();
      setMsg({ ok: r.message, err: "" });
      tt.reload();
      return true;
    } catch (err) {
      setMsg({ ok: "", err: (err as Error).message });
      return false;
    }
  }

  async function place(taId: string) {
    if (!editing) return;
    const ok = await run(() => apiFetch(`/schedule/sections/${sectionId}/periods`, {
      method: "PUT",
      body: JSON.stringify({ dayOfWeek: editing.day, periodNumber: editing.period, teachingAssignmentId: Number(taId) }),
    }));
    if (ok) setEditing(null);
  }

  async function remove() {
    if (!editing) return;
    const ok = await run(() => apiFetch(`/schedule/sections/${sectionId}/periods?dayOfWeek=${editing.day}&periodNumber=${editing.period}`, { method: "DELETE" }));
    if (ok) setEditing(null);
  }

  async function createAssignment(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => apiFetch("/schedule/teaching-assignments", {
      method: "POST",
      body: JSON.stringify({ sectionId: Number(sectionId), subjectId: Number(assign.subjectId), employeeAssignmentId: Number(assign.employeeAssignmentId), weeklyUnits: Number(assign.weeklyUnits) }),
    }));
    if (ok) setShowAssign(false);
  }

  const current = editing ? cellAt(editing.day, editing.period) : undefined;

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader
        title="جدول الحصص"
        subtitle={canEdit ? "اضغط على أي خانة لإضافة حصة أو تغييرها" : "عرض فقط"}
        actions={canEdit && sectionId && <button className="btn btn-outline-primary" onClick={() => setShowAssign((s) => !s)}>إسناد مادة لمعلم</button>}
      />
      <div className="d-flex flex-wrap gap-2 mb-3">
        <SchoolPicker value={schoolId} onChange={(id) => { setSchoolId(id); setSectionId(""); setEditing(null); }} />
        <select className="form-select" style={{ maxWidth: 300 }} value={sectionId} onChange={(e) => { setSectionId(e.target.value); setEditing(null); }} aria-label="الشعبة">
          <option value="">اختر الشعبة...</option>
          {structure.data?.classes.map((c) => (
            <optgroup key={c.id} label={c.name}>
              {c.sections.map((s) => <option key={s.id} value={s.id}>{c.name} — شعبة {s.name}{s.track ? ` (${TRACK_LABELS[s.track]})` : ""}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <Alert kind="success">{msg.ok}</Alert>
      <Alert kind="danger">{msg.err || tt.error || structure.error}</Alert>

      {showAssign && (
        <form className="card border-0 shadow-sm rounded-4 mb-3" onSubmit={createAssignment}>
          <div className="card-body row g-3 align-items-end">
            <Field label="المادة *" col="col-md-4">
              <select className="form-select" value={assign.subjectId} onChange={(e) => setAssign({ ...assign, subjectId: e.target.value })} required>
                <option value="">اختر...</option>
                {subjects.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="المعلم *" col="col-md-4">
              <select className="form-select" value={assign.employeeAssignmentId} onChange={(e) => setAssign({ ...assign, employeeAssignmentId: e.target.value })} required>
                <option value="">اختر...</option>
                {teachers.data?.filter((t) => t.position_type === "TEACHER").map((t) => (
                  <option key={t.assignment_id} value={t.assignment_id}>{t.full_name}{t.specialization ? ` — ${t.specialization}` : ""}</option>
                ))}
              </select>
            </Field>
            <Field label="حصص أسبوعياً *" col="col-md-2">
              <input type="number" min={1} max={12} className="form-control" value={assign.weeklyUnits} onChange={(e) => setAssign({ ...assign, weeklyUnits: e.target.value })} required />
            </Field>
            <div className="col-md-2 d-flex gap-2"><button className="btn btn-primary">حفظ</button><button type="button" className="btn btn-outline-secondary" onClick={() => setShowAssign(false)}>إلغاء</button></div>
          </div>
        </form>
      )}

      {!sectionId ? (
        <p className="text-secondary">اختر شعبة لعرض جدولها.</p>
      ) : !config.data || (tt.loading && !tt.data) ? <Loading /> : (
        <div className="row g-3">
          <div className="col-xl-9">
            <div className="card border-0 shadow-sm rounded-4">
              <div className="card-body">
                <h2 className="h6 fw-bold mb-3">{section?.className} — شعبة {section?.name}</h2>
                <TimetableGrid
                  config={config.data}
                  cell={(d, p) => {
                    const c = cellAt(d, p);
                    const selected = editing?.day === d && editing?.period === p;
                    const cls = `timetable-cell ${c ? "bg-primary-subtle" : "empty"} ${canEdit ? "editable" : ""} ${selected ? "border border-2 border-primary" : ""}`;
                    return (
                      <div className={cls} role={canEdit ? "button" : undefined} tabIndex={canEdit ? 0 : undefined}
                        onClick={() => canEdit && setEditing({ day: d, period: p })}
                        onKeyDown={(e) => canEdit && e.key === "Enter" && setEditing({ day: d, period: p })}>
                        {c ? (<><div className="fw-semibold">{c.subject_name}</div><div className="small text-secondary">{c.teacher_name}</div></>) : (canEdit ? "+" : "—")}
                      </div>
                    );
                  }}
                />
              </div>
            </div>
          </div>

          <div className="col-xl-3">
            {editing && canEdit && (
              <div className="card border-0 shadow-sm rounded-4 mb-3">
                <div className="card-body">
                  <h3 className="h6 fw-bold">{DAY_LABELS[editing.day]} — الحصة {editing.period}</h3>
                  {current && <p className="small mb-2">الحالية: {current.subject_name} ({current.teacher_name})</p>}
                  <select className="form-select mb-2" defaultValue="" onChange={(e) => e.target.value && place(e.target.value)} aria-label="اختر المادة">
                    <option value="">اختر المادة والمعلم...</option>
                    {tt.data?.options.map((o) => (
                      <option key={o.teaching_assignment_id} value={o.teaching_assignment_id}>
                        {o.subject_name} — {o.teacher_name} ({o.scheduled_units}/{o.planned_units})
                      </option>
                    ))}
                  </select>
                  <div className="d-flex gap-2">
                    {current && <button className="btn btn-sm btn-outline-danger" onClick={remove}>حذف الحصة</button>}
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => setEditing(null)}>إغلاق</button>
                  </div>
                </div>
              </div>
            )}
            <div className="card border-0 shadow-sm rounded-4">
              <div className="card-body">
                <h3 className="h6 fw-bold">المواد المسندة</h3>
                <ul className="list-unstyled small mb-0">
                  {tt.data?.options.map((o) => (
                    <li key={o.teaching_assignment_id} className="d-flex justify-content-between border-bottom py-1">
                      <span>{o.subject_name}<span className="text-secondary"> — {o.teacher_name}</span></span>
                      <span className={o.scheduled_units === o.planned_units ? "text-success" : "text-warning fw-semibold"}>{o.scheduled_units}/{o.planned_units}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TimetablePage;
