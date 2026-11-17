import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "../services/api";
import FaceCapture, { type Capture } from "../components/FaceCapture";
import { POSITION_LABELS } from "../config/labels";

interface CheckResult {
  fullName: string;
  employeeNumber: string;
  positionType: string;
  eventType: "IN" | "OUT";
  at: string | null;
  score: number;
  duplicate: boolean;
}

// FR-ATT-03/04/05: the school's attendance device. Recognises only staff of this school;
// IN/OUT is decided automatically from the person's last event today.
function KioskPage() {
  const [result, setResult] = useState<{ ok: true; data: CheckResult; message: string } | { ok: false; message: string } | null>(null);
  const [now, setNow] = useState(new Date());
  const [round, setRound] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Clear the result after a few seconds so the next person can scan
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => { setResult(null); setRound((r) => r + 1); }, 6000);
    return () => clearTimeout(t);
  }, [result]);

  async function check(c: Capture) {
    try {
      const r = await apiFetch<{ message: string; data: CheckResult }>("/face/check", { method: "POST", body: JSON.stringify(c) });
      setResult({ ok: true, data: r.data, message: r.message });
    } catch (err) {
      setResult({ ok: false, message: err instanceof ApiError ? err.message : "حدث خطأ" });
    }
  }

  return (
    <div className="container py-4" style={{ maxWidth: 640 }}>
      <div className="text-center mb-3">
        <h1 className="h4 page-title mb-1">تسجيل الحضور بالوجه</h1>
        <div className="display-6 fw-bold brand-title">{now.toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
        <div className="text-secondary">{now.toLocaleDateString("ar-SY", { weekday: "long", day: "numeric", month: "long" })}</div>
      </div>

      {result ? (
        <div className={`kiosk-result ${result.ok ? "ok" : "fail"}`} role="status">
          {result.ok ? (
            <>
              <i className={`bi ${result.data.eventType === "IN" ? "bi-box-arrow-in-left" : "bi-box-arrow-right"} display-4 text-success`}></i>
              <h2 className="h3 fw-bold mt-2 mb-1">{result.data.fullName}</h2>
              <div className="text-secondary mb-2">{POSITION_LABELS[result.data.positionType]} · {result.data.employeeNumber}</div>
              <div className="fs-4 fw-bold">{result.message}{result.data.at && ` — ${result.data.at}`}</div>
              <div className="small text-secondary mt-2">درجة التطابق {Math.round(result.data.score * 100)}%</div>
            </>
          ) : (
            <>
              <i className="bi bi-x-octagon display-4 text-danger"></i>
              <div className="fs-5 fw-bold mt-2">{result.message}</div>
            </>
          )}
          <button className="btn btn-outline-secondary mt-3" onClick={() => { setResult(null); setRound((r) => r + 1); }}>التالي</button>
        </div>
      ) : (
        <FaceCapture key={round} onCapture={check} actionLabel="تسجيل الحضور / الانصراف" />
      )}
      <p className="small text-secondary text-center mt-3 mb-0">
        يُقارن الوجه بموظفي هذه المدرسة فقط. عند تعذّر التعرّف راجع الإدارة للإدخال اليدوي.
      </p>
    </div>
  );
}

export default KioskPage;
