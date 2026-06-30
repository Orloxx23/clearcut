#!/usr/bin/env bash
# ============================================================================
# Setup + arranque de Clearcut sobre una plantilla PyTorch existente de RunPod
# (p. ej. "RunPod PyTorch 2.4+"), que ya trae CUDA, PyTorch y Python.
#
# Uso (dentro del pod, en la web terminal o por SSH):
#   git clone <TU_REPO> /workspace/clearcut
#   cd /workspace/clearcut
#   bash runpod_setup.sh
#
# Es idempotente: en arranques posteriores reaprovecha lo ya instalado/descargado.
# Si el repo vive en /workspace (volumen persistente), los modelos y el build del
# frontend persisten entre reinicios del pod.
# ============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

# --- Cachés persistentes (si estamos en /workspace, se conservan entre pods) ---
CACHE_ROOT="${CLEARCUT_CACHE:-$APP_DIR/.cache}"
export TORCH_HOME="$CACHE_ROOT/torch"
export HF_HOME="$CACHE_ROOT/huggingface"
mkdir -p "$TORCH_HOME" "$HF_HOME"

echo "==> [1/6] Dependencias del sistema (ffmpeg, git)"
if ! command -v ffmpeg >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y --no-install-recommends ffmpeg git curl ca-certificates
fi

echo "==> [2/6] Node.js + pnpm (para compilar el frontend)"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
command -v pnpm >/dev/null 2>&1 || npm install -g pnpm@10

echo "==> [3/6] Dependencias Python del backend (torch ya viene en la plantilla)"
# Marcador para no reinstalar en cada arranque.
if [ ! -f "$CACHE_ROOT/.deps_ok" ]; then
  pip install --no-cache-dir \
    fastapi==0.115.6 "uvicorn[standard]==0.34.0" python-multipart==0.0.20 \
    opencv-python-headless==4.11.0.86 Pillow \
    faster-whisper \
    av addict einops future scipy matplotlib scikit-image imageio-ffmpeg pyyaml requests timm yapf
  pip install --no-cache-dir --no-deps simple-lama-inpainting
  pip install --no-cache-dir fire
  touch "$CACHE_ROOT/.deps_ok"
else
  echo "    (ya instaladas)"
fi

echo "==> [4/6] ProPainter (clonar + parche de progreso)"
cd "$APP_DIR/backend"
if [ ! -d third_party/ProPainter ]; then
  git clone --depth 1 https://github.com/sczhou/ProPainter.git third_party/ProPainter
fi
python scripts/patch_propainter.py third_party/ProPainter/inference_propainter.py

echo "==> [5/6] Pre-descarga de modelos (LaMa, Whisper, ProPainter)"
python scripts/download_models.py

echo "==> [6/6] Compilar el frontend (estático) y dejarlo listo para el backend"
if [ ! -d frontend_static ] || [ "${REBUILD_FRONTEND:-0}" = "1" ]; then
  cd "$APP_DIR/frontend"
  pnpm install --frozen-lockfile
  NEXT_PUBLIC_API_URL="" pnpm build
  rm -rf "$APP_DIR/backend/frontend_static"
  cp -r out "$APP_DIR/backend/frontend_static"
else
  echo "    (frontend ya compilado; usa REBUILD_FRONTEND=1 para forzar)"
fi

echo "==> Arrancando servidor en 0.0.0.0:${PORT:-8000}"
cd "$APP_DIR/backend"
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
