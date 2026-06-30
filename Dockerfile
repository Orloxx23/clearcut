# syntax=docker/dockerfile:1

# ============================================================================
# Stage 1 — Build del frontend (Next.js export estático)
# ============================================================================
FROM node:20-slim AS frontend
WORKDIR /fe

# El frontend usará rutas relativas (/api/...) servidas por el mismo backend.
ENV NEXT_PUBLIC_API_URL=""

RUN npm install -g pnpm@10
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build   # genera ./out (output: "export")

# ============================================================================
# Stage 2 — Runtime con CUDA (backend + modelos + frontend estático)
# ============================================================================
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime AS runtime

# ffmpeg/ffprobe (video y audio) y git (clonar ProPainter)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Dependencias Python (torch/torchvision ya vienen en la imagen base) ---
RUN pip install --no-cache-dir \
        fastapi==0.115.6 "uvicorn[standard]==0.34.0" python-multipart==0.0.20 \
        opencv-python-headless==4.11.0.86 Pillow \
        faster-whisper \
        av addict einops future scipy matplotlib scikit-image imageio-ffmpeg pyyaml requests timm yapf \
    && pip install --no-cache-dir --no-deps simple-lama-inpainting \
    && pip install --no-cache-dir fire

# --- Código del backend ---
COPY backend/app ./app
COPY backend/scripts ./scripts

# --- ProPainter: clonar + aplicar parche de progreso ---
RUN git clone --depth 1 https://github.com/sczhou/ProPainter.git third_party/ProPainter \
    && python scripts/patch_propainter.py third_party/ProPainter/inference_propainter.py

# --- Pre-descarga de modelos (LaMa, Whisper large-v3, pesos de ProPainter) ---
RUN python scripts/download_models.py

# --- Frontend estático servido por FastAPI ---
COPY --from=frontend /fe/out ./frontend_static
ENV FRONTEND_DIR=/app/frontend_static

# Carpetas de trabajo
RUN mkdir -p uploads outputs

EXPOSE 8000
ENV PORT=8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
