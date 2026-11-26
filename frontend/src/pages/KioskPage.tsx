import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch, getToken } from "../services/api";
import { useAuth } from "../context/AuthContext";
import FaceCapture, { type Capture } from "../components/FaceCapture";
import { POSITION_LABELS } from "../config/labels";
import {
  enqueueCapture, pendingCount, poolSize, popChallenge, refillPool, saveKioskSession, syncQueue,
  type ChallengeInfo, type SyncSummary,
} from "../services/offlineQueue";

interface CheckResult {
  fullName: string;
  employeeNumber: string;
  positionType: string;
  eventType: "IN" | "OUT";
  at: string | null;
  score: number;
  duplicate: boolean;
}
type Result = { kind: "ok"; data: CheckResult; message: string } | { kind: "fail"; message: string } | { kind: "queued" };

interface InstallEvent extends Event { prompt: () => Promise<void> }

// The school's attendance device. Online: recognised at once (staff of this school only; IN/OUT from the last event today).
// Offline (ATT-21): the capture is stored encrypted on the device and verified by the server after the sync.
function KioskPage() {
  const { user } = useAuth();
  const schoolId = Number(user?.schoolId);
  const [result, setResult] = useState<Result | null>(null);
  const [now, setNow] = useState(new Date());
  const [round, setRound] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [pool, setPool] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Clear the result after a few seconds so the next person can scan
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => { setResult(null); setRound((r) => r + 1); }, result.kind === "queued" ? 7000 : 6000);
    return () => clearTimeout(t);
  }, [result]);

  const refreshCounts = useCallback(async () => {
    if (!user) return;
    try {
      setPending(await pendingCount(schoolId));
      setPool(await poolSize(user));
    } catch { /* IndexedDB unavailable (private window): offline mode simply cannot be used */ }
  }, [user, schoolId]);

  const sync = useCallback(async () => {
    if (!user || !navigator.onLine) return;
    setSyncing(true);
    try {
      const s: SyncSummary = await syncQueue(user);
      if (s.sent > 0) {
        setSyncMsg(`تمت مزامنة ${s.sent} لقطة: ${s.accepted} سُجّلت حركتها${s.review ? ` · ${s.review} بانتظار مراجعة المدير` : ""}${s.rejected ? ` · ${s.rejected} مرفوضة` : ""}`);
      } else if (s.error && s.error !== "BUSY" && s.remaining > 0) {
        setSyncMsg(s.error === "401" ? "انتهت الجلسة — سجّل الدخول من جديد لإكمال المزامنة" : "تعذّرت المزامنة حالياً — ستُعاد المحاولة تلقائياً");
      }
    } finally {
      setSyncing(false);
      await refreshCounts();
    }
  }, [user, refreshCounts]);

  // Keep the offline pool full, remember the session (so a restart during an outage still works), and sync when possible
  const maintain = useCallback(async () => {
    if (!user || !navigator.onLine) return;
    try {
      const token = getToken();
      if (token) await saveKioskSession(token, user);
      await refillPool(user);
    } catch { /* offline right now */ }
    await sync();
  }, [user, sync]);

  useEffect(() => {
    void refreshCounts();
    void maintain();
    const goOnline = () => { setOnline(true); void maintain(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const t = setInterval(() => { if (navigator.onLine) void maintain(); }, 30_000);
    const onInstall = (e: Event) => { e.preventDefault(); setInstallEvent(e as InstallEvent); };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("beforeinstallprompt", onInstall);
      clearInterval(t);
    };
  }, [refreshCounts, maintain]);

  /** Online: a fresh server challenge. No connection: one of the pre-fetched signed challenges. */
  async function getChallenge(): Promise<ChallengeInfo> {
    if (navigator.onLine) {
      try {
        const { data } = await apiFetch<{ data: { challenge: ChallengeInfo["challenge"]; layout: number[]; token: string } }>("/face/challenge");
        return { ...data, source: "server" };
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 0) throw err;
      }
    }
    setOnline(false);
    const c = user ? await popChallenge(user) : null;
    if (!c) throw new Error("لا يوجد اتصال ولا تحديات مخزّنة على الجهاز — اتصل بالإنترنت مرة واحدة ثم أعد المحاولة");
    return c;
  }

  async function queue(c: Capture) {
    if (!user) return;
    await enqueueCapture(c.frames, c.challengeToken, user);
    setResult({ kind: "queued" });
    await refreshCounts();
  }

  async function check(c: Capture) {
    if (c.source === "pool") return queue(c);
    try {
      const r = await apiFetch<{ message: string; data: CheckResult }>("/face/check", { method: "POST", body: JSON.stringify(c) });
      setResult({ kind: "ok", data: r.data, message: r.message });
    } catch (err) {
      // the connection dropped between the challenge and the check → keep the capture for the sync
      if (err instanceof ApiError && err.status === 0) { setOnline(false); return queue(c); }
      setResult({ kind: "fail", message: err instanceof ApiError ? err.message : "حدث خطأ" });
    }
  }

  return (
    <div className="container py-3 py-md-4 kiosk-wrap">
      <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-2">
        <span className={`badge rounded-pill ${online ? "text-bg-success" : "text-bg-warning"}`}>
          <i className={`bi ${online ? "bi-wifi" : "bi-wifi-off"} ms-1`}></i>{online ? "متصل" : "دون اتصال — تُحفظ اللقطات على الجهاز"}
        </span>
        {installEvent && (
          <button className="btn btn-sm btn-outline-primary" onClick={() => { void installEvent.prompt(); setInstallEvent(null); }}>
            <i className="bi bi-download ms-1"></i>تثبيت كتطبيق
          </button>
        )}
      </div>

      <div className="text-center mb-3">
        <h1 className="h4 page-title mb-1">تسجيل الحضور بالوجه</h1>
        <div className="display-6 fw-bold brand-title">{now.toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
        <div className="text-secondary">{now.toLocaleDateString("ar-SY", { weekday: "long", day: "numeric", month: "long" })}</div>
      </div>

      {pending > 0 && (
        <div className="alert alert-warning d-flex flex-wrap gap-2 justify-content-between align-items-center py-2" role="status">
          <span><i className="bi bi-hourglass-split ms-1"></i>{pending} لقطة بانتظار المزامنة</span>
          <button className="btn btn-sm btn-warning" disabled={!online || syncing} onClick={() => void sync()}>
            {syncing ? "جارٍ المزامنة..." : "مزامنة الآن"}
          </button>
        </div>
      )}
      {syncMsg && <div className="alert alert-info py-2 small" role="status" onClick={() => setSyncMsg("")}>{syncMsg}</div>}

      {result ? (
        <div className={`kiosk-result ${result.kind === "fail" ? "fail" : "ok"}`} role="status">
          {result.kind === "ok" && (
            <>
              <i className={`bi ${result.data.eventType === "IN" ? "bi-box-arrow-in-left" : "bi-box-arrow-right"} display-4 text-success`}></i>
              <h2 className="h3 fw-bold mt-2 mb-1">{result.data.fullName}</h2>
              <div className="text-secondary mb-2">{POSITION_LABELS[result.data.positionType]} · {result.data.employeeNumber}</div>
              <div className="fs-4 fw-bold">{result.message}{result.data.at && ` — ${result.data.at}`}</div>
              <div className="small text-secondary mt-2">درجة التطابق {Math.round(result.data.score * 100)}%</div>
            </>
          )}
          {result.kind === "queued" && (
            <>
              <i className="bi bi-cloud-arrow-up display-4 text-warning"></i>
              <div className="fs-4 fw-bold mt-2">تم حفظ لقطتك على الجهاز</div>
              <div className="text-secondary mt-1">لا يوجد اتصال حالياً. ستُتحقَّق من هويتك وتُسجَّل حركتك بوقتها الحقيقي تلقائياً عند عودة الإنترنت.</div>
            </>
          )}
          {result.kind === "fail" && (
            <>
              <i className="bi bi-x-octagon display-4 text-danger"></i>
              <div className="fs-5 fw-bold mt-2">{result.message}</div>
            </>
          )}
          <button className="btn btn-outline-secondary mt-3" onClick={() => { setResult(null); setRound((r) => r + 1); }}>التالي</button>
        </div>
      ) : (
        <FaceCapture
          key={round}
          onCapture={check}
          getChallenge={getChallenge}
          actionLabel="تسجيل الحضور / الانصراف"
          note={online ? undefined : `دون اتصال: تُحفظ اللقطة مشفّرة على هذا الجهاز وتُحذف بعد المزامنة (${pool} تحدٍّ مخزّن)`}
        />
      )}
      <p className="small text-secondary text-center mt-3 mb-0">
        يُقارن الوجه بموظفي هذه المدرسة فقط. عند تعذّر التعرّف راجع الإدارة للإدخال اليدوي.
      </p>
    </div>
  );
}

export default KioskPage;
