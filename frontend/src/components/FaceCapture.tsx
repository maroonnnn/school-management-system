import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../services/api";
import type { ChallengeInfo } from "../services/offlineQueue";

/**
 * Camera capture with a server-issued liveness challenge (FR-ATT-03, FR-ATT-22).
 * The challenge is an ordered two-step head turn (e.g. right, then left): 3 frontal frames, then 4 frames per turn.
 * Frames exist only in memory until they are sent (or stored encrypted by the kiosk while offline); nothing else is kept (NFR-07).
 */
export interface Capture { frames: string[]; challengeToken: string; source: "server" | "pool" }

const FRONT_FRAMES = 3;
const TURN_FRAMES = 4;
const FRONT_GAP_MS = 220;
const TURN_GAP_MS = 350;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Default: ask the server (online). The kiosk passes its own provider that falls back to the offline pool. */
async function serverChallenge(): Promise<ChallengeInfo> {
  const { data } = await apiFetch<{ data: { challenge: ChallengeInfo["challenge"]; layout: number[]; token: string } }>("/face/challenge");
  return { ...data, source: "server" };
}

export default function FaceCapture({ onCapture, busy, actionLabel, getChallenge = serverChallenge, note }: {
  onCapture: (c: Capture) => Promise<void> | void;
  busy?: boolean;
  actionLabel: string;
  getChallenge?: () => Promise<ChallengeInfo>;
  note?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // No camera API at all (e.g. page opened over plain http on another host) — known at first render
  const [error, setError] = useState(() => navigator.mediaDevices ? "" : "المتصفح لا يدعم الكاميرا (يجب فتح النظام عبر localhost أو https)");
  const [ready, setReady] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
        setReady(true);
      })
      .catch((e: DOMException) => {
        const byName: Record<string, string> = {
          NotAllowedError: "تم رفض إذن الكاميرا — اسمح بها من رمز القفل/الكاميرا بجانب عنوان الصفحة، أو من إعدادات الخصوصية",
          NotFoundError: "لا توجد كاميرا متصلة بالجهاز",
          NotReadableError: "الكاميرا مستخدمة من برنامج آخر (Zoom، Teams، تطبيق الكاميرا...) — أغلقه وأعد المحاولة",
          OverconstrainedError: "الكاميرا لا تدعم الدقة المطلوبة",
          SecurityError: "المتصفح يمنع الكاميرا لهذه الصفحة — افتح النظام عبر https أو http://localhost",
        };
        setError(`تعذّر تشغيل الكاميرا: ${byName[e?.name] ?? e?.message ?? "خطأ غير معروف"} (${e?.name ?? "?"})`);
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function grab(): string {
    const v = videoRef.current!;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 480 / (v.videoWidth || 480)); // small frames: faster to send and light to keep offline
    canvas.width = Math.round((v.videoWidth || 480) * scale);
    canvas.height = Math.round((v.videoHeight || 360) * scale);
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height); // un-mirrored frame
    return canvas.toDataURL("image/jpeg", 0.72);
  }

  async function start() {
    setError("");
    setCapturing(true);
    try {
      const ch = await getChallenge();
      const frames: string[] = [];
      setPrompt("انظر مباشرة إلى الكاميرا...");
      await sleep(700);
      for (let i = 0; i < FRONT_FRAMES; i++) { frames.push(grab()); await sleep(FRONT_GAP_MS); }
      for (let step = 0; step < ch.challenge.length; step++) {
        const dir = ch.challenge[step];
        setPrompt(`${ch.challenge.length > 1 ? `(${step + 1} من ${ch.challenge.length}) ` : ""}${dir === "LEFT" ? "⬅ لُفّ رأسك ببطء إلى يسارك" : "لُفّ رأسك ببطء إلى يمينك ➡"}`);
        await sleep(500);
        for (let i = 0; i < TURN_FRAMES; i++) { frames.push(grab()); await sleep(TURN_GAP_MS); }
      }
      setPrompt("جارٍ المعالجة...");
      await onCapture({ frames, challengeToken: ch.token, source: ch.source });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPrompt("");
      setCapturing(false);
    }
  }

  return (
    <div>
      <div className="face-stage">
        <video ref={videoRef} muted playsInline className="face-video" />
        <div className="face-oval" aria-hidden="true"></div>
        {prompt && <div className="face-prompt">{prompt}</div>}
        {!ready && !error && <div className="face-prompt">جارٍ تشغيل الكاميرا...</div>}
      </div>
      {error && <div className="alert alert-danger py-2 mt-2">{error}</div>}
      <button className="btn btn-primary btn-lg w-100 mt-3 face-action" disabled={!ready || capturing || busy} onClick={start}>
        {capturing || busy ? <><span className="spinner-border spinner-border-sm ms-2"></span>انتظر...</> : actionLabel}
      </button>
      <p className="small text-secondary text-center mt-2 mb-0">
        <i className="bi bi-shield-lock ms-1"></i>{note ?? "لا تُحفظ أي صورة — يُحفظ رقم مشفّر فقط."}
      </p>
    </div>
  );
}
