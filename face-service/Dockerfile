FROM python:3.13-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# OpenCV (headless) runtime library
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Official OpenCV Zoo models (not stored in git). Downloaded at build time.
ADD https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx models/
ADD https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx models/
COPY app.py ./
RUN useradd --no-create-home appuser && chown -R appuser /app
USER appuser
EXPOSE 8001
# 0.0.0.0 inside the private docker network only — the port is NOT published to the host
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
