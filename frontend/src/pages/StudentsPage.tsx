import { useState, type FormEvent } from "react";
import { useApi } from "../hooks/useApi";
import { ApiError, apiFetch } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, DuplicateWarning, Field, Loading, PageHeader, SchoolPicker } from "../components/ui";

interface Section { id: number; name: string; capacity: number | null; studentsCount: number }
interface SchoolClass { id: number; name: string; gradeLevel: number; sections: Section[] }
interface Structure { academicYear: { id: number; name: string }; classes: SchoolClass[] }
interface Student {
  id: number;
  student_number: string;
  full_name: string;
  date_of_birth: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
}

const emptyStudent = { fullName: "", studentNumber: "", dateOfBirth: "", guardianName: "", guardianPhone: "" };

// FR-DATA-04 (student ↔ section), FR-DATA-05 (classes/sections + roster), FR-DATA-06, FR-DATA-08
function StudentsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "SCHOOL_PRINCIPAL" || user?.role === "SCHOOL_DEPUTY";
  const [schoolId, setSchoolId] = useState<number | null>(user?.schoolId ?? null);
  const structure = useApi<Structure>(schoolId ? `/academics/structure?schoolId=${schoolId}` : null);
  const [sectionId, setSectionId] = useState<number | null>(null);
  const roster = useApi<Student[]>(sectionId ? `/academics/sections/${sectionId}/students` : null);
  const [msg, setMsg] = useState({ ok: "", err: "" });
  const [panel, setPanel] = useState<"" | "student" | "class" | "section">("");
  const [student, setStudent] = useState(emptyStudent);
  const [editingStudentId, setEditingStudentId] = useState<number | null>(null);
  const [duplicates, setDuplicates] = useState<Student[] | null>(null);
  const [classForm, setClassForm] = useState({ name: "", gradeLevel: "7" });
  const [sectionForm, setSectionForm] = useState({ classId: "", name: "", capacity: "30" });

  const selectedSection = structure.data?.classes.flatMap((c) => c.sections.map((s) => ({ ...s, className: c.name })))
    .find((s) => s.id === sectionId);

  async function send(path: string, method: string, body: object) {
    setMsg({ ok: "", err: "" });
    const r = await apiFetch<{ message: string }>(path, { method, body: JSON.stringify(body) });
    setMsg({ ok: r.message, err: "" });
    setPanel("");
  }

  async function saveStudent(confirmDuplicate = false) {
    try {
      if (editingStudentId) await send(`/academics/students/${editingStudentId}`, "PUT", student);
      else await send("/academics/students", "POST", { ...student, sectionId, confirmDuplicate });
      setStudent(emptyStudent);
      setEditingStudentId(null);
      setDuplicates(null);
      roster.reload();
      structure.reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && Array.isArray(err.body?.duplicates)) {
        setDuplicates(err.body.duplicates as Student[]);
      } else setMsg({ ok: "", err: (err as Error).message });
    }
  }

  async function saveOther(e: FormEvent) {
    e.preventDefault();
    try {
      if (panel === "class") await send("/academics/classes", "POST", { ...classForm, gradeLevel: Number(classForm.gradeLevel) });
      else await send("/academics/sections", "POST", { ...sectionForm, classId: Number(sectionForm.classId), capacity: Number(sectionForm.capacity) || null });
      structure.reload();
    } catch (err) {
      setMsg({ ok: "", err: (err as Error).message });
    }
  }

  function editStudent(s: Student) {
    setStudent({
      fullName: s.full_name, studentNumber: s.student_number, dateOfBirth: s.date_of_birth?.slice(0, 10) ?? "",
      guardianName: s.guardian_name ?? "", guardianPhone: s.guardian_phone ?? "",
    });
    setEditingStudentId(s.id);
    setDuplicates(null);
    setPanel("student");
  }

  const setS = (k: keyof typeof emptyStudent) => (e: { target: { value: string } }) => setStudent({ ...student, [k]: e.target.value });

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader
        title="الصفوف والطلاب"
        subtitle={structure.data ? `السنة الدراسية ${structure.data.academicYear.name}` : undefined}
        actions={canEdit && (
          <>
            <button className="btn btn-outline-primary" onClick={() => setPanel(panel === "class" ? "" : "class")}>صف جديد</button>
            <button className="btn btn-outline-primary" onClick={() => setPanel(panel === "section" ? "" : "section")}>شعبة جديدة</button>
          </>
        )}
      />
      <div className="mb-3"><SchoolPicker value={schoolId} onChange={(id) => { setSchoolId(id); setSectionId(null); }} /></div>
      <Alert kind="success">{msg.ok}</Alert>
      <Alert kind="danger">{msg.err || structure.error || roster.error}</Alert>

      {(panel === "class" || panel === "section") && (
        <form className="card border-0 shadow-sm rounded-4 mb-3" onSubmit={saveOther}>
          <div className="card-body row g-3 align-items-end">
            {panel === "class" ? (
              <>
                <Field label="اسم الصف *" col="col-md-5"><input className="form-control" value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} required placeholder="مثال: الصف السابع" /></Field>
                <Field label="المرحلة (1-12) *" col="col-md-3"><input type="number" min={1} max={12} className="form-control" value={classForm.gradeLevel} onChange={(e) => setClassForm({ ...classForm, gradeLevel: e.target.value })} required /></Field>
              </>
            ) : (
              <>
                <Field label="الصف *" col="col-md-4">
                  <select className="form-select" value={sectionForm.classId} onChange={(e) => setSectionForm({ ...sectionForm, classId: e.target.value })} required>
                    <option value="">اختر...</option>
                    {structure.data?.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="اسم الشعبة *" col="col-md-3"><input className="form-control" value={sectionForm.name} onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })} required /></Field>
                <Field label="السعة" col="col-md-2"><input type="number" min={1} className="form-control" value={sectionForm.capacity} onChange={(e) => setSectionForm({ ...sectionForm, capacity: e.target.value })} /></Field>
              </>
            )}
            <div className="col-md-3 d-flex gap-2"><button className="btn btn-primary">حفظ</button><button type="button" className="btn btn-outline-secondary" onClick={() => setPanel("")}>إلغاء</button></div>
          </div>
        </form>
      )}

      <div className="row g-3">
        <div className="col-lg-3">
          <div className="card border-0 shadow-sm rounded-4">
            <div className="card-body p-2">
              {!schoolId && <p className="text-secondary p-2 mb-0">اختر مدرسة.</p>}
              {structure.loading && <Loading />}
              {structure.data?.classes.map((c) => (
                <div key={c.id} className="mb-2">
                  <div className="fw-bold small text-secondary px-2 pt-2">{c.name}</div>
                  {c.sections.map((s) => (
                    <button key={s.id} type="button"
                      className={`sidebar-link w-100 border-0 justify-content-between ${s.id === sectionId ? "active" : "bg-transparent"}`}
                      onClick={() => { setSectionId(s.id); setPanel(""); }}>
                      <span>شعبة {s.name}</span>
                      <span className={`badge ${s.id === sectionId ? "text-bg-light" : "text-bg-secondary"}`}>{s.studentsCount}</span>
                    </button>
                  ))}
                  {c.sections.length === 0 && <div className="small text-secondary px-3">لا توجد شعب</div>}
                </div>
              ))}
              {structure.data?.classes.length === 0 && <p className="text-secondary p-2 mb-0">لا توجد صفوف لهذه السنة.</p>}
            </div>
          </div>
        </div>

        <div className="col-lg-9">
          <div className="card border-0 shadow-sm rounded-4">
            <div className="card-body">
              {!selectedSection ? (
                <p className="text-secondary mb-0">اختر شعبة لعرض أسماء طلابها.</p>
              ) : (
                <>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h2 className="h6 fw-bold mb-0">{selectedSection.className} — شعبة {selectedSection.name}
                      <span className="text-secondary fw-normal"> ({selectedSection.studentsCount}{selectedSection.capacity ? ` / ${selectedSection.capacity}` : ""})</span>
                    </h2>
                    {canEdit && (
                      <button className="btn btn-sm btn-primary" onClick={() => { setStudent(emptyStudent); setEditingStudentId(null); setDuplicates(null); setPanel(panel === "student" ? "" : "student"); }}>
                        <i className="bi bi-person-plus ms-1"></i>طالب جديد
                      </button>
                    )}
                  </div>

                  {panel === "student" && (
                    <form className="row g-2 mb-3 p-3 bg-light rounded-3" onSubmit={(e) => { e.preventDefault(); saveStudent(); }}>
                      <Field label="اسم الطالب *" col="col-md-4"><input className="form-control" value={student.fullName} onChange={setS("fullName")} required /></Field>
                      <Field label="الرقم" col="col-md-2"><input className="form-control" value={student.studentNumber} onChange={setS("studentNumber")} placeholder="تلقائي" /></Field>
                      <Field label="تاريخ الميلاد" col="col-md-2"><input type="date" className="form-control" value={student.dateOfBirth} onChange={setS("dateOfBirth")} /></Field>
                      <Field label="ولي الأمر" col="col-md-2"><input className="form-control" value={student.guardianName} onChange={setS("guardianName")} /></Field>
                      <Field label="هاتف ولي الأمر" col="col-md-2"><input className="form-control" value={student.guardianPhone} onChange={setS("guardianPhone")} /></Field>
                      {duplicates && <div className="col-12"><DuplicateWarning duplicates={duplicates} onConfirm={() => saveStudent(true)} onCancel={() => setDuplicates(null)} /></div>}
                      <div className="col-12 d-flex gap-2"><button className="btn btn-primary btn-sm">{editingStudentId ? "حفظ التعديل" : "إضافة"}</button><button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setPanel("")}>إلغاء</button></div>
                    </form>
                  )}

                  {roster.loading ? <Loading /> : (
                    <div className="table-responsive">
                      <table className="table table-sm table-hover align-middle mb-0">
                        <thead className="table-light"><tr><th>#</th><th>الرقم</th><th>الاسم</th><th>تاريخ الميلاد</th><th>ولي الأمر</th><th>الهاتف</th>{canEdit && <th></th>}</tr></thead>
                        <tbody>
                          {roster.data?.map((s, i) => (
                            <tr key={s.id}>
                              <td className="text-secondary">{i + 1}</td>
                              <td className="small text-secondary">{s.student_number}</td>
                              <td className="fw-semibold">{s.full_name}</td>
                              <td>{s.date_of_birth?.slice(0, 10)}</td>
                              <td>{s.guardian_name}</td>
                              <td dir="ltr" className="text-end">{s.guardian_phone}</td>
                              {canEdit && <td><button className="btn btn-sm btn-link" onClick={() => editStudent(s)}>تعديل</button></td>}
                            </tr>
                          ))}
                          {roster.data?.length === 0 && <tr><td colSpan={7} className="text-center text-secondary py-3">لا يوجد طلاب</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StudentsPage;
