import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { apiFetch } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, Loading, PageHeader } from "../components/ui";

interface Setting { key: string; value: unknown; description: string; updated_at: string }
type Rule = { minYears: number; quota: number };

// FR-SCH-04 / 05: quota rules and lesson settings, editable by the directorate (and ministry)
function SettingsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "DIRECTORATE_ADMIN" || user?.role === "MINISTRY_ADMIN";
  const settings = useApi<Setting[]>("/schedule/settings");
  const [msg, setMsg] = useState({ ok: "", err: "" });
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});

  const valueOf = (key: string) => (key in drafts ? drafts[key] : settings.data?.find((s) => s.key === key)?.value);
  const setDraft = (key: string, value: unknown) => setDrafts({ ...drafts, [key]: value });

  async function save(key: string) {
    setMsg({ ok: "", err: "" });
    try {
      const r = await apiFetch<{ message: string }>(`/schedule/settings/${key}`, { method: "PUT", body: JSON.stringify({ value: valueOf(key) }) });
      setMsg({ ok: r.message, err: "" });
      const rest = { ...drafts };
      delete rest[key];
      setDrafts(rest);
      settings.reload();
    } catch (err) {
      setMsg({ ok: "", err: (err as Error).message });
    }
  }

  if (!settings.data) return <div className="container-fluid p-4">{settings.error ? <Alert kind="danger">{settings.error}</Alert> : <Loading />}</div>;

  const rules = ((valueOf("permanent_quota_rules") as Rule[]) ?? []).slice().sort((a, b) => a.minYears - b.minYears);
  const times = (valueOf("period_times") as Record<string, string>) ?? {};
  const saveBtn = (k: string) => canEdit ? <button className="btn btn-sm btn-primary" disabled={!(k in drafts)} onClick={() => save(k)}>حفظ</button> : null;

  return (
    <div className="container-fluid p-3 p-lg-4" style={{ maxWidth: 900 }}>
      <PageHeader title="إعدادات النصاب والحصص" subtitle={canEdit ? "تُطبّق على كل المدارس فوراً" : "عرض فقط — التعديل للمديرية"} />
      <Alert kind="success">{msg.ok}</Alert>
      <Alert kind="danger">{msg.err}</Alert>

      <div className="card border-0 shadow-sm rounded-4 mb-3">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h2 className="h6 fw-bold mb-0">نصاب المعلم المثبّت حسب سنين الخدمة</h2>
            {saveBtn("permanent_quota_rules")}
          </div>
          <table className="table table-sm align-middle mb-2" style={{ maxWidth: 480 }}>
            <thead><tr><th>من (سنة خدمة)</th><th>النصاب الأسبوعي</th>{canEdit && <th></th>}</tr></thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={i}>
                  <td><input type="number" min={0} className="form-control form-control-sm" disabled={!canEdit || r.minYears === 0} value={r.minYears}
                    onChange={(e) => setDraft("permanent_quota_rules", rules.map((x, j) => j === i ? { ...x, minYears: Number(e.target.value) } : x))} aria-label="من سنة" /></td>
                  <td><input type="number" min={1} max={40} className="form-control form-control-sm" disabled={!canEdit} value={r.quota}
                    onChange={(e) => setDraft("permanent_quota_rules", rules.map((x, j) => j === i ? { ...x, quota: Number(e.target.value) } : x))} aria-label="النصاب" /></td>
                  {canEdit && <td>{r.minYears !== 0 && <button className="btn btn-sm btn-link text-danger" onClick={() => setDraft("permanent_quota_rules", rules.filter((_, j) => j !== i))}>حذف</button>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && <button className="btn btn-sm btn-outline-secondary" onClick={() => setDraft("permanent_quota_rules", [...rules, { minYears: (rules.at(-1)?.minYears ?? 0) + 5, quota: 18 }])}>+ شريحة</button>}
          <p className="small text-secondary mt-2 mb-0">تنطبق أعلى شريحة لا تتجاوز سنين خدمة المعلم. المعلم الوكيل نصابه = ساعات تكليفه.</p>
        </div>
      </div>

      <div className="card border-0 shadow-sm rounded-4 mb-3">
        <div className="card-body row g-3 align-items-end">
          <div className="col-md-5">
            <label className="form-label small fw-semibold">أجر الحصة للوكيل (ل.س) — للعرض فقط</label>
            <input type="number" min={0} className="form-control" disabled={!canEdit} value={Number(valueOf("contract_lesson_rate"))} onChange={(e) => setDraft("contract_lesson_rate", Number(e.target.value))} />
          </div>
          <div className="col-md-2">{saveBtn("contract_lesson_rate")}</div>
          <div className="col-md-5">
            <label className="form-label small fw-semibold">سماحية التأخير (دقيقة)</label>
            <div className="d-flex gap-2">
              <input type="number" min={0} max={120} className="form-control" disabled={!canEdit} value={Number(valueOf("late_tolerance_minutes"))} onChange={(e) => setDraft("late_tolerance_minutes", Number(e.target.value))} />
              {saveBtn("late_tolerance_minutes")}
            </div>
          </div>
        </div>
      </div>

      <div className="card border-0 shadow-sm rounded-4">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h2 className="h6 fw-bold mb-0">أوقات الحصص — مدة الحصة {Number(valueOf("lesson_duration_minutes"))} دقيقة</h2>
            {saveBtn("period_times")}
          </div>
          <div className="row g-2">
            {Object.keys(times).sort((a, b) => Number(a) - Number(b)).map((p) => (
              <div className="col-4 col-md-2" key={p}>
                <label className="form-label small mb-0">الحصة {p}</label>
                <input type="time" className="form-control form-control-sm" disabled={!canEdit} value={times[p]} onChange={(e) => setDraft("period_times", { ...times, [p]: e.target.value })} />
              </div>
            ))}
          </div>
          <p className="small text-secondary mt-2 mb-0">تغيير الأوقات يطبّق على الحصص الجديدة فقط. تغيير مدة الحصة غير متاح من الواجهة لأنه يتطلب إعادة توليد البرامج.</p>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
