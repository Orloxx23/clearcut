"""API de eliminación de marcas de agua (imágenes y video)."""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from app.services import image_service, lama_service, subtitle_service, video_service

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

MAX_IMAGE_BYTES = 25 * 1024 * 1024     # 25 MB
MAX_VIDEO_BYTES = 500 * 1024 * 1024    # 500 MB

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/bmp"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"}

app = FastAPI(title="Watermark Remover API", version="0.1.0")

# Registro de trabajos en memoria (un proceso). Para producción multi-worker
# convendría Redis/DB, pero para uso local esto es suficiente.
# job_id -> {status, progress, stage, eta, error, started}
VIDEO_JOBS: dict[str, dict] = {}
# job_id -> {status, progress, stage, error, result:{language, segments}}
SUBTITLE_JOBS: dict[str, dict] = {}

# Orígenes permitidos. En el despliegue todo-en-uno el frontend se sirve desde el
# mismo origen (sin CORS), pero permitimos configurar orígenes extra por env var
# (separados por comas) para escenarios con frontend desplegado aparte.
_default_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
_extra = os.getenv("CORS_ORIGINS", "").strip()
_origins = _default_origins + [o.strip() for o in _extra.split(",") if o.strip()] if _extra != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _parse_regions(raw: str) -> list[dict]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="El campo 'regions' no es JSON válido.")
    if not isinstance(data, list):
        raise HTTPException(status_code=400, detail="'regions' debe ser una lista.")
    for r in data:
        if not all(k in r for k in ("x", "y", "width", "height")):
            raise HTTPException(
                status_code=400,
                detail="Cada región requiere x, y, width y height.",
            )
    return data


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/api/capabilities")
async def capabilities() -> dict:
    """Informa al frontend qué modos de alta calidad (IA) están disponibles."""
    lama_ok = lama_service.is_available()
    return {
        "image": {"fast": True, "high": lama_ok},
        "video": {"fast": True, "high": video_service.propainter_available()},
        "subtitles": subtitle_service.is_available(),
        "device": lama_service.device(),
    }


@app.post("/api/image/detect")
async def detect(file: UploadFile = File(...)) -> dict:
    """Sugiere regiones de marca de agua de forma automática."""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail=f"Tipo no soportado: {file.content_type}")
    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="La imagen supera el tamaño máximo (25 MB).")
    try:
        regions = image_service.detect_watermark_regions(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"regions": regions}


@app.post("/api/image/process")
async def process_image(
    file: UploadFile = File(...),
    regions: str = Form(...),
    quality: str = Form("fast"),     # "fast" (OpenCV) | "high" (LaMa)
    algorithm: str = Form("telea"),  # solo modo fast
    radius: int = Form(5),           # solo modo fast
    feather: int = Form(3),          # solo modo fast
    dilation: int = Form(8),         # solo modo high (expansión de máscara)
) -> Response:
    """Elimina las marcas de agua de una imagen y devuelve el PNG resultante."""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail=f"Tipo no soportado: {file.content_type}")
    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="La imagen supera el tamaño máximo (25 MB).")

    region_list = _parse_regions(regions)
    try:
        if quality == "high":
            if not lama_service.is_available():
                raise HTTPException(status_code=503, detail="El modo alta calidad (IA) no está disponible en el servidor.")
            result = lama_service.inpaint_image(data, region_list, dilation=dilation)
        else:
            result = image_service.inpaint_image(
                data, region_list, algorithm=algorithm, radius=radius, feather=feather,
            )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return Response(
        content=result,
        media_type="image/png",
        headers={"Content-Disposition": 'attachment; filename="resultado.png"'},
    )


@app.post("/api/video/process")
async def process_video_endpoint(
    file: UploadFile = File(...),
    regions: str = Form(...),
    quality: str = Form("fast"),   # "fast" (FFmpeg delogo) | "high" (ProPainter)
) -> dict:
    """Elimina marcas de agua de un video. Devuelve un job_id para descargar el resultado."""
    if file.content_type not in ALLOWED_VIDEO_TYPES:
        raise HTTPException(status_code=415, detail=f"Tipo no soportado: {file.content_type}")

    if quality == "high" and not video_service.propainter_available():
        raise HTTPException(status_code=503, detail="El modo alta calidad (IA) no está disponible para video.")

    region_list = _parse_regions(regions)

    job_id = uuid.uuid4().hex
    suffix = Path(file.filename or "video.mp4").suffix or ".mp4"
    input_path = UPLOAD_DIR / f"{job_id}{suffix}"
    output_path = OUTPUT_DIR / f"{job_id}.mp4"

    # Guardar en streaming para no cargar todo en memoria.
    size = 0
    with input_path.open("wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_VIDEO_BYTES:
                f.close()
                input_path.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="El video supera el tamaño máximo (500 MB).")
            f.write(chunk)

    # Crear el job y lanzar el procesamiento en segundo plano: devolvemos de
    # inmediato para que el cliente pueda seguir el progreso por polling.
    VIDEO_JOBS[job_id] = {
        "status": "processing",
        "progress": 0.0,
        "stage": "En cola",
        "eta": None,
        "error": None,
        "started": time.time(),
    }
    asyncio.create_task(
        _run_video_job(job_id, input_path, output_path, region_list, quality)
    )
    return {"job_id": job_id}


async def _run_video_job(
    job_id: str,
    input_path: Path,
    output_path: Path,
    region_list: list[dict],
    quality: str,
) -> None:
    """Ejecuta el procesamiento de video y va actualizando el estado del job."""
    job = VIDEO_JOBS[job_id]

    def on_progress(label: str, pct: float, eta) -> None:
        job["stage"] = label
        job["progress"] = round(pct, 1)
        job["eta"] = round(eta) if eta is not None else None

    try:
        if quality == "high":
            await video_service.process_video_hq(
                input_path, output_path, region_list, on_progress=on_progress
            )
        else:
            job["stage"] = "Procesando"
            await video_service.process_video(input_path, output_path, region_list)
        job["status"] = "done"
        job["progress"] = 100.0
        job["stage"] = "Completado"
        job["eta"] = 0
    except (ValueError, RuntimeError) as e:
        job["status"] = "error"
        job["error"] = str(e)
    except Exception as e:  # noqa: BLE001 — no dejar el job colgado ante fallos inesperados
        job["status"] = "error"
        job["error"] = f"Error inesperado: {e}"
    finally:
        input_path.unlink(missing_ok=True)


@app.get("/api/video/status/{job_id}")
async def video_status(job_id: str) -> dict:
    """Estado y progreso de un trabajo de video."""
    job = VIDEO_JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Trabajo no encontrado.")
    out = {
        "status": job["status"],
        "progress": job["progress"],
        "stage": job["stage"],
        "eta": job["eta"],
        "error": job["error"],
    }
    if job["status"] == "done":
        out["download_url"] = f"/api/video/download/{job_id}"
    return out


@app.get("/api/video/download/{job_id}")
async def download_video(job_id: str) -> FileResponse:
    """Descarga el video procesado."""
    # Validación: job_id debe ser hexadecimal puro (evita path traversal).
    if not job_id.isalnum():
        raise HTTPException(status_code=400, detail="job_id inválido.")
    output_path = OUTPUT_DIR / f"{job_id}.mp4"
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="Resultado no encontrado o expirado.")
    return FileResponse(output_path, media_type="video/mp4", filename="resultado.mp4")


# ----------------------------- Subtítulos -----------------------------

@app.post("/api/subtitles/generate")
async def generate_subtitles(file: UploadFile = File(...)) -> dict:
    """Transcribe el audio de un video y genera subtítulos. Devuelve un job_id."""
    if file.content_type not in ALLOWED_VIDEO_TYPES:
        raise HTTPException(status_code=415, detail=f"Tipo no soportado: {file.content_type}")
    if not subtitle_service.is_available():
        raise HTTPException(status_code=503, detail="La transcripción no está disponible (falta GPU/modelo).")

    job_id = uuid.uuid4().hex
    suffix = Path(file.filename or "video.mp4").suffix or ".mp4"
    input_path = UPLOAD_DIR / f"sub_{job_id}{suffix}"

    size = 0
    with input_path.open("wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_VIDEO_BYTES:
                f.close()
                input_path.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="El video supera el tamaño máximo (500 MB).")
            f.write(chunk)

    SUBTITLE_JOBS[job_id] = {
        "status": "processing", "progress": 0.0, "stage": "En cola",
        "error": None, "result": None,
    }
    asyncio.create_task(_run_subtitle_job(job_id, input_path))
    return {"job_id": job_id}


async def _run_subtitle_job(job_id: str, input_path: Path) -> None:
    job = SUBTITLE_JOBS[job_id]

    def on_progress(label: str, pct: float) -> None:
        job["stage"] = label
        job["progress"] = round(pct, 1)

    try:
        # La transcripción es bloqueante (GPU): la corremos en un hilo para no
        # bloquear el event loop del servidor.
        result = await asyncio.to_thread(
            subtitle_service.transcribe, input_path, on_progress
        )
        job["result"] = result
        job["status"] = "done"
        job["progress"] = 100.0
        job["stage"] = "Completado"
    except ValueError as e:
        # Errores esperables (p. ej. video sin audio): mensaje directo al usuario.
        job["status"] = "error"
        job["error"] = str(e)
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()  # queda en el log del servidor para diagnóstico
        job["status"] = "error"
        job["error"] = f"Error al transcribir: {e}"
    finally:
        input_path.unlink(missing_ok=True)


@app.get("/api/subtitles/status/{job_id}")
async def subtitle_status(job_id: str) -> dict:
    """Estado y resultado de un trabajo de subtítulos."""
    job = SUBTITLE_JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Trabajo no encontrado.")
    out = {
        "status": job["status"],
        "progress": job["progress"],
        "stage": job["stage"],
        "error": job["error"],
    }
    if job["status"] == "done":
        out["result"] = job["result"]
    return out


# ----------------------- Frontend estático (despliegue todo-en-uno) -----------------------
# Se monta al final, después de todas las rutas /api, para que estas tengan prioridad.
# La ruta del build del frontend se configura con FRONTEND_DIR (por defecto, junto al backend).
_frontend_dir = Path(os.getenv("FRONTEND_DIR", BASE_DIR / "frontend_static"))
if _frontend_dir.is_dir():
    app.mount("/", StaticFiles(directory=_frontend_dir, html=True), name="frontend")
