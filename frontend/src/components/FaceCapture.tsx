import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../services/api";

/**
 * Camera capture with a server-issued head-turn challenge (FR-ATT-03, FR-ATT-22).
 * Frames exist only in memory and are sent once; nothing is stored in the browser (NFR-07).
 * Sequence: look at the camera (3 frames) → turn head as asked (5 frames).
 */
export interface Capture { frames: string[]; challengeToken: string }

const FRONT_FRAMES = 3;
const TURN_FRAMES = 5;
const FRAME_GAP_MS = 220;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function FaceCapture({ onCapture, busy, actionLabel }: { onCapture: (c: Capture) => Promise<void> | void; busy?: boolean; actionLabel: string }) {
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
      .catch(() => setError("تعذّر تشغيل الكاميرا — تأكد من السماح للمتصفح باستخدامها"));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function grab(): string {
    const v = videoRef.current!;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 640 / (v.videoWidth || 640));
    canvas.width = Math.round((v.videoWidth || 640) * scale);
    canvas.height = Math.round((v.videoHeight || 480) * scale);
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height); // un-mirrored frame
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  async function start() {
    setError("");
    setCapturing(true);
    try {
      const { data } = await apiFetch<{ data: { challenge: "LEFT" | "RIGHT"; token: string } }>("/face/challenge");
      const frames: string[] = [];
      setPrompt("انظر مباشرة إلى الكاميرا...");
      await sleep(700);
      for (let i = 0; i < FRONT_FRAMES; i++) { frames.push(grab()); await sleep(FRAME_GAP_MS); }
      setPrompt(data.challenge === "LEFT" ? "⬅ لُفّ رأسك ببطء إلى يسارك" : "لُفّ رأسك ببطء إلى يمينك ➡");
      await sleep(600);
      for (let i = 0; i < TURN_FRAMES; i++) { frames.push(grab()); await sleep(FRAME_GAP_MS); }
      setPrompt("جارٍ التحقق...");
      await onCapture({ frames, challengeToken: data.token });
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
      <button className="btn btn-primary btn-lg w-100 mt-3" disabled={!ready || capturing || busy} onClick={start}>
        {capturing || busy ? <><span className="spinner-border spinner-border-sm ms-2"></span>انتظر...</> : actionLabel}
      </button>
      <p className="small text-secondary text-center mt-2 mb-0">
        <i className="bi bi-shield-lock ms-1"></i>لا تُحفظ أي صورة — يُحفظ رقم مشفّر فقط.
      </p>
    </div>
  );
}
