# face-service

Stateless face service (OpenCV YuNet + SFace) for attendance — FR-ATT-01..05, 22.
Images are processed in memory only and never stored (NFR-07). The backend stores only an encrypted vector.

## Setup (once)
```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```
Download the two official models from https://github.com/opencv/opencv_zoo into `models/`:
- `models/face_detection_yunet/face_detection_yunet_2023mar.onnx`
- `models/face_recognition_sface/face_recognition_sface_2021dec.onnx`

## Run
```bash
.venv/Scripts/python -m uvicorn app:app --host 127.0.0.1 --port 8001
```
