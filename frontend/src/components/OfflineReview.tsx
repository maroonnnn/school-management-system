import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { apiFetch } from "../services/api";
import { Alert, Loading } from "./ui";

// Captures made while the kiosk had no internet that the server could not accept by itself (ATT-21).
// The principal looks at the frontal frame, then attaches the capture to an employee or rejects it.
// Frames are encrypted at rest and deleted as soon as the decision is taken (or after 7 days).

interface Item {
  id: number; reason: string; best_score: number | null; clock_skew_seconds: number; captured_at: string; received_at: string;
  matched_assignment_id: number | null; suggested_name: string | null; suggested_number: string | null;
}
interface Staff { assignment_id: number; full_name: string; employee_number: string }

const REASON: Record<string, string> = {
  NO_FACE: "لم يُكتشف وجه واضح", NO_MATCH: "الوجه غير معروف في هذه المدرسة", MULTIPLE_FACES: "أكثر من وجه في الصورة",
  WRONG_DIRECTION: "اتجاه لف الرأس غير صحيح", LIVENESS_FAILED: "فشل تحدي الحيوية", NO_FRONTAL: "لم تُلتقط نظرة أمامية",
  INCONSISTENT: "تغيّر الوجه أثناء الالتقاط", CLOCK_DRIFT: "ساعة الجهاز غير مضبوطة", CHALLENGE_WINDOW: "وقت اللقطة خارج مدة التحدي",
  TOO_OLD: "لقطة قديمة (أكثر من أسبوع)", FUTURE_TIME: "وقت اللقطة في المستقبل",
};

export default function OfflineReview() {
  const list = useApi<Item[]>("/face/offline/review");
  const staff = useApi<Staff[]>("/face/enrollments");
  const [openId, setOpenId] = useState<number | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [assignment, setAssignment] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState({ ok: "", err: "" });

  async function open(it: Item) {
    setOpenId(it.id); setImage(null); setReason("");
    setAssignment(it.matched_assignment_id ? String(it.matched_assignment_id) : "");
    try {
      setImage((await apiFetch<{ data: { image: string } }>(`/face/offline/${it.id}/preview`)).data.image);
    } catch (e) { setMsg({ ok: "", err: (e as Error).message }); }
  }
  async function decide(action: "ACCEPT" | "REJECT") {
    setMsg({ ok: "", err: "" });
    try {
      const r = await apiFetch<{ message: string }>(`/face/offline/${openId}/resolve`, {
        method: "POST", body: JSON.stringify({ action, employeeAssignmentId: Number(assignment) || undefined, reason }),
      });
      setMsg({ ok: r.message, err: "" });
      setOpenId(null); setImage(null);
      list.reload();
    } catch (e) { setMsg({ ok: "", err: (e as Error).message }); }
  }

  const open_ = list.data?.find((i) => i.id === openId);
  return (
    <div className="row g-3">
      <div className="col-12">
        <p className="small text-secondary mb-0">
          لقطات سُجّلت على جهاز الحضور أثناء انقطاع الإنترنت وتعذّر قبولها آلياً. الصورة تُحذف نهائياً بعد قرارك (أو بعد 7 أيام).
        </p>
      </div>
      <div className="col-12"><Alert kind="success">{msg.ok}</Alert><Alert kind="danger">{msg.err || list.error}</Alert></div>
      <div className={openId ? "col-lg-7" : "col-12"}>
        <div className="card border-0 shadow-sm rounded-4">
          {list.loading && !list.data ? <Loading /> : (
            <div className="table-responsive">
              <table className="table table-hover align-middle small mb-0">
                <thead className="table-light"><tr><th>وقت اللقطة</th><th>السبب</th><th>اقتراح النظام</th><th>التطابق</th></tr></thead>
                <tbody>
                  {list.data?.map((i) => (
                    <tr key={i.id} role="button" className={i.id === openId ? "table-primary" : ""} onClick={() => void open(i)}>
                      <td className="text-nowrap">{i.captured_at}</td>
                      <td>{REASON[i.reason] ?? i.reason}{i.reason === "CLOCK_DRIFT" && <div className="text-secondary">فرق الساعة {Math.round(i.clock_skew_seconds / 60)} دقيقة</div>}</td>
                      <td>{i.suggested_name ? `${i.suggested_name} (${i.suggested_number})` : <span className="text-secondary">—</span>}</td>
                      <td>{i.best_score != null ? `${Math.round(i.best_score * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                  {list.data?.length === 0 && <tr><td colSpan={4} className="text-center text-secondary py-4">لا توجد لقطات بانتظار المراجعة</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {openId && open_ && (
        <div className="col-lg-5">
          <div className="card border-0 shadow-sm rounded-4">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-start mb-2">
                <h2 className="h6 fw-bold mb-0">لقطة {open_.captured_at}</h2>
                <button className="btn-close" aria-label="إغلاق" onClick={() => { setOpenId(null); setImage(null); }}></button>
              </div>
              {image ? <img src={image} alt="لقطة الوجه" className="img-fluid rounded-3 mb-2" /> : <Loading />}
              <div className="small text-secondary mb-2">سبب المراجعة: {REASON[open_.reason] ?? open_.reason}</div>
              <label className="form-label small fw-semibold mb-1" htmlFor="oc-emp">الموظف</label>
              <select id="oc-emp" className="form-select form-select-sm mb-2" value={assignment} onChange={(e) => setAssignment(e.target.value)}>
                <option value="">اختر الموظف...</option>
                {staff.data?.map((s) => <option key={s.assignment_id} value={s.assignment_id}>{s.full_name} ({s.employee_number})</option>)}
              </select>
              <input className="form-control form-control-sm mb-2" placeholder="سبب القرار (إلزامي)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="d-flex gap-2">
                <button className="btn btn-success btn-sm" disabled={!assignment || !reason.trim()} onClick={() => void decide("ACCEPT")}>اعتماد وتسجيل الحركة</button>
                <button className="btn btn-outline-danger btn-sm" disabled={!reason.trim()} onClick={() => void decide("REJECT")}>رفض وحذف</button>
              </div>
              <div className="small text-secondary mt-2">يُسجَّل الاعتماد كإدخال يدوي بإشرافك وبوقت اللقطة الأصلي.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
