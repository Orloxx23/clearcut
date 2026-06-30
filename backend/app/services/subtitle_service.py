"""Generación de subtítulos a partir del audio de un video con faster-whisper.

Transcribe en GPU (CUDA) usando el modelo Whisper large-v3 y devuelve segmentos
con marcas de tiempo. El modelo se carga una sola vez (singleton perezoso).
"""
from __future__ import annotations

import shutil
import subprocess
import threading
from pathlib import Path
from typing import Awaitable, Callable

_model = None
_lock = threading.Lock()

MODEL_SIZE = "large-v3"

# Callback de progreso: (etiqueta, porcentaje 0-100)
ProgressCb = Callable[[str, float], Awaitable[None] | None]


def is_available() -> bool:
    """True si faster-whisper está instalado y hay CUDA disponible."""
    try:
        import faster_whisper  # noqa: F401
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


def device() -> str:
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def has_audio_stream(video_path: Path) -> bool:
    """Comprueba con ffprobe si el video tiene al menos una pista de audio."""
    ffprobe = shutil.which("ffprobe") or "ffprobe"
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "a",
             "-show_entries", "stream=index", "-of", "csv=p=0", str(video_path)],
            capture_output=True, text=True, timeout=30,
        )
        return bool(out.stdout.strip())
    except Exception:
        # Si ffprobe falla, dejamos que el flujo normal intente y reporte.
        return True


def _get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from faster_whisper import WhisperModel
                dev = device()
                compute = "float16" if dev == "cuda" else "int8"
                _model = WhisperModel(MODEL_SIZE, device=dev, compute_type=compute)
    return _model


def transcribe(video_path: Path, on_progress=None) -> dict:
    """Transcribe el audio del video. Devuelve {language, segments:[{id,start,end,text}]}.

    `on_progress(label, pct)` se invoca con el avance (basado en el timestamp del
    segmento actual frente a la duración total).
    """
    import asyncio

    def emit(label: str, pct: float) -> None:
        if on_progress is None:
            return
        res = on_progress(label, max(0.0, min(100.0, pct)))
        if asyncio.iscoroutine(res):
            # El callback es síncrono en nuestro uso; si fuera async se programaría.
            asyncio.ensure_future(res)

    if not has_audio_stream(video_path):
        raise ValueError("El video no tiene pista de audio, así que no hay nada que transcribir.")

    emit("Cargando modelo de transcripción", 1.0)
    model = _get_model()

    emit("Analizando el audio", 3.0)
    # vad_filter recorta silencios y mejora la segmentación de subtítulos.
    segments_gen, info = model.transcribe(
        str(video_path),
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )

    total = info.duration or 0.0
    out_segments: list[dict] = []
    for i, seg in enumerate(segments_gen):
        text = seg.text.strip()
        if text:
            out_segments.append({
                "id": i,
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": text,
            })
        if total > 0:
            pct = 3.0 + (seg.end / total) * 96.0
            emit("Transcribiendo", pct)

    emit("Completado", 100.0)
    return {"language": info.language, "segments": out_segments}
