"""
Face service — FR-ATT-01..05, FR-ATT-22, NFR-07
Stateless HTTP service (localhost only) used by the Node backend:
  POST /process  {frames: [base64 JPEG], challenge: "LEFT"|"RIGHT"}  →  embedding + liveness result
Images are decoded in memory, never written to disk, and dropped when the request ends (NFR-07).
Models: OpenCV Zoo YuNet (detection + 5 landmarks) and SFace (128-d embedding).
Run:  face-service/.venv/Scripts/python -m uvicorn app:app --host 127.0.0.1 --port 8001   (from face-service/)
"""
import base64
import os
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODELS = Path(__file__).parent / "models"
DETECTOR_PATH = MODELS / "face_detection_yunet_2023mar.onnx"
RECOGNIZER_PATH = MODELS / "face_recognition_sface_2021dec.onnx"

# Liveness thresholds on normalised yaw = (nose_x − eyes_mid_x) / eye_distance
FRONTAL_MAX = 0.12      # a frame counts as "facing the camera"
TURN_MIN = 0.22         # a frame counts as "head turned"
# The camera image is not mirrored: when a person turns to THEIR left, the nose moves to the image's right (yaw > 0).
STRICT_DIRECTION = os.getenv("FACE_STRICT_DIRECTION", "0") == "1"
SAME_PERSON_MIN = 0.40  # all analysed frames must belong to the same person (anti face-swap)

app = FastAPI(title="School face service", docs_url=None, redoc_url=None)
detector = cv2.FaceDetectorYN.create(str(DETECTOR_PATH), "", (320, 320), score_threshold=0.85, nms_threshold=0.3, top_k=10)
recognizer = cv2.FaceRecognizerSF.create(str(RECOGNIZER_PATH), "")


class ProcessRequest(BaseModel):
    frames: list[str] = Field(min_length=1, max_length=12)
    challenge: str | None = None  # LEFT / RIGHT; None = no liveness check (not allowed by the backend)


def decode(b64: str) -> np.ndarray:
    if "," in b64[:64]:
        b64 = b64.split(",", 1)[1]  # strip data URL prefix
    buf = np.frombuffer(base64.b64decode(b64), dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "صورة غير صالحة")
    return img


def analyse(img: np.ndarray):
    h, w = img.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)
    if faces is None:
        return {"faces": 0}
    if len(faces) > 1:
        return {"faces": int(len(faces))}
    f = faces[0]
    re, le, nose = f[4:6], f[6:8], f[8:10]  # YuNet landmarks: right eye, left eye, nose, mouth R, mouth L
    eye_dist = float(np.linalg.norm(le - re)) or 1.0
    yaw = float((nose[0] - (re[0] + le[0]) / 2) / eye_dist)
    return {"faces": 1, "face": f, "yaw": yaw, "score": float(f[14]), "size": float(min(f[2], f[3]) / min(w, h))}


def embed(img: np.ndarray, face: np.ndarray) -> np.ndarray:
    aligned = recognizer.alignCrop(img, face)
    feat = recognizer.feature(aligned).flatten().astype(np.float32)
    return feat / (np.linalg.norm(feat) or 1.0)


@app.get("/health")
def health():
    return {"ok": True, "detector": DETECTOR_PATH.name, "recognizer": RECOGNIZER_PATH.name}


@app.post("/process")
def process(req: ProcessRequest):
    results = []
    for b64 in req.frames:
        img = decode(b64)
        a = analyse(img)
        if a["faces"] == 1:
            a["embedding"] = embed(img, a["face"])
        results.append(a)
        del img  # nothing is kept or written to disk (NFR-07)

    if any(r["faces"] > 1 for r in results):
        return {"ok": False, "reason": "MULTIPLE_FACES", "message": "يظهر أكثر من وجه — يجب أن يقف شخص واحد أمام الكاميرا"}
    good = [r for r in results if r["faces"] == 1]
    if len(good) < max(2, len(results) // 2):
        return {"ok": False, "reason": "NO_FACE", "message": "لم يُكتشف الوجه بوضوح — اقترب من الكاميرا وتأكد من الإضاءة"}

    yaws = [r["yaw"] for r in good]
    frontal = [r for r in good if abs(r["yaw"]) <= FRONTAL_MAX]
    if not frontal:
        return {"ok": False, "reason": "NO_FRONTAL", "message": "انظر مباشرة إلى الكاميرا في بداية التسجيل", "yaws": yaws}

    # FR-ATT-22: liveness — the head must actually turn during the capture
    liveness = {"challenge": req.challenge, "passed": req.challenge is None, "maxYaw": max(yaws), "minYaw": min(yaws)}
    if req.challenge in ("LEFT", "RIGHT"):
        turned = [y for y in yaws if abs(y) >= TURN_MIN]
        if STRICT_DIRECTION:
            want = 1 if req.challenge == "LEFT" else -1
            turned = [y for y in turned if y * want > 0]
        liveness["passed"] = len(turned) > 0
    if not liveness["passed"]:
        return {"ok": False, "reason": "LIVENESS_FAILED", "message": "لم يتم التحقق من الحيوية — حرّك رأسك كما هو مطلوب", "liveness": liveness}

    # All frames must be the same person (prevents swapping a photo in mid-capture)
    best = max(frontal, key=lambda r: (r["score"], r["size"]))
    sims = [float(np.dot(best["embedding"], r["embedding"])) for r in good]
    if min(sims) < SAME_PERSON_MIN:
        return {"ok": False, "reason": "INCONSISTENT", "message": "تغيّر الوجه أثناء الالتقاط — أعد المحاولة"}

    return {
        "ok": True,
        "embedding": best["embedding"].round(6).tolist(),
        "quality": {"detection": round(best["score"], 3), "faceSize": round(best["size"], 3), "frames": len(good)},
        "liveness": liveness,
        "model": "sface-2021dec",
    }
