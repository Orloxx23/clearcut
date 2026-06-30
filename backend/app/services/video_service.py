"""Servicio de procesamiento de video con FFmpeg.

Estrategia principal: el filtro `delogo` de FFmpeg, que difumina/reconstruye una región
rectangular interpolando desde los píxeles del borde. Es muy eficiente (no requiere IA)
y funciona bien para logos/marcas semitransparentes fijas.
"""
from __future__ import annotations

import asyncio
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Awaitable, Callable

import cv2
import numpy as np

# Callback de progreso: (etiqueta_fase, porcentaje 0-100, segundos_restantes|None)
ProgressCb = Callable[[str, float, float | None], Awaitable[None] | None]

# Patrón de las barras tqdm de ProPainter. Capturamos la etiqueta de fase
# (inyectada como desc 'PPSTAGE:xxx') y el porcentaje + ETA. P.ej.:
#   "PPSTAGE:flow:  45%|████▌     | 135/300 [01:23<01:42,  1.61it/s]"
_TQDM_RE = re.compile(
    r"(?:PPSTAGE:(\w+):)?\s*(\d+)%\|.*?\|\s*\d+/\d+\s*\[\d+:\d+<(\d+:\d+)"
)


def _mmss_to_seconds(s: str) -> float | None:
    try:
        m, sec = s.split(":")
        return int(m) * 60 + int(sec)
    except Exception:
        return None

# Ubicación del repo de ProPainter (clonado en backend/third_party/ProPainter).
PROPAINTER_DIR = Path(__file__).resolve().parent.parent.parent / "third_party" / "ProPainter"
PROPAINTER_SCRIPT = PROPAINTER_DIR / "inference_propainter.py"


def _ffmpeg_bin() -> str:
    return shutil.which("ffmpeg") or "ffmpeg"


def propainter_available() -> bool:
    """True si ProPainter (alta calidad de video con IA) está listo para usarse."""
    if not PROPAINTER_SCRIPT.exists():
        return False
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


def _build_delogo_filter(regions: list[dict], video_w: int, video_h: int) -> str:
    """Encadena un filtro delogo por cada región.

    delogo exige que la región quede dentro del frame con al menos 1px de margen,
    así que recortamos las coordenadas.
    """
    filters = []
    for r in regions:
        x = max(1, int(round(r["x"])))
        y = max(1, int(round(r["y"])))
        rw = int(round(r["width"]))
        rh = int(round(r["height"]))
        # Mantener 1px de margen contra los bordes del frame.
        rw = min(rw, video_w - x - 1)
        rh = min(rh, video_h - y - 1)
        if rw <= 0 or rh <= 0:
            continue
        filters.append(f"delogo=x={x}:y={y}:w={rw}:h={rh}")
    if not filters:
        raise ValueError("No hay regiones válidas para procesar en el video.")
    return ",".join(filters)


async def _run(cmd: list[str]) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    out, _ = await proc.communicate()
    return proc.returncode, out.decode("utf-8", errors="replace")


async def probe_dimensions(input_path: Path) -> tuple[int, int]:
    """Obtiene ancho y alto del video con ffprobe."""
    ffprobe = shutil.which("ffprobe") or "ffprobe"
    cmd = [
        ffprobe, "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0",
        str(input_path),
    ]
    code, out = await _run(cmd)
    if code != 0:
        raise RuntimeError(f"ffprobe falló: {out}")
    try:
        w, h = out.strip().split("x")
        return int(w), int(h)
    except ValueError:
        raise RuntimeError(f"No se pudieron leer las dimensiones del video: {out!r}")


async def process_video(
    input_path: Path,
    output_path: Path,
    regions: list[dict],
) -> None:
    """Aplica delogo sobre las regiones y escribe el video resultante.

    Conserva el audio original (copy) y re-codifica solo el video.
    """
    video_w, video_h = await probe_dimensions(input_path)
    vf = _build_delogo_filter(regions, video_w, video_h)

    cmd = [
        _ffmpeg_bin(), "-y",
        "-i", str(input_path),
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-c:a", "copy",
        "-movflags", "+faststart",
        str(output_path),
    ]
    code, out = await _run(cmd)
    if code != 0:
        raise RuntimeError(f"FFmpeg falló al procesar el video:\n{out[-2000:]}")


def _write_mask(regions: list[dict], width: int, height: int, dilation: int, path: Path) -> None:
    """Crea una máscara PNG (blanco = zona a rellenar) del tamaño del video.

    ProPainter aplica una sola máscara a todos los fotogramas: ideal para marcas
    de agua fijas.
    """
    mask = np.zeros((height, width), dtype=np.uint8)
    for r in regions:
        x = max(0, int(round(r["x"])))
        y = max(0, int(round(r["y"])))
        x1 = min(width, x + int(round(r["width"])))
        y1 = min(height, y + int(round(r["height"])))
        if x1 > x and y1 > y:
            mask[y:y1, x:x1] = 255
    if dilation > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilation * 2 + 1, dilation * 2 + 1))
        mask = cv2.dilate(mask, k)
    if not mask.any():
        raise ValueError("No hay regiones válidas para procesar en el video.")
    cv2.imwrite(str(path), mask)


# Resolución máxima de procesado para no saturar la VRAM (16 GB).
# Procesar por encima de ~960px en el lado mayor provoca thrashing y lentitud.
MAX_PROCESS_DIM = 960

# Fases de ProPainter, identificadas por su etiqueta PPSTAGE. Cada una tiene un
# peso aproximado en el progreso total (el flujo óptico RAFT es lo más pesado) y
# un offset acumulado calculado a partir de los pesos anteriores.
_STAGE_INFO: dict[str, tuple[str, float]] = {
    "flow": ("Analizando movimiento", 0.45),
    "complete": ("Completando el flujo", 0.10),
    "prop": ("Propagando píxeles", 0.10),
    "inpaint": ("Reconstruyendo la zona", 0.35),
}
_STAGE_ORDER = ["flow", "complete", "prop", "inpaint"]


def _stage_offset(key: str) -> float:
    """% global acumulado por las fases anteriores a `key`."""
    idx = _STAGE_ORDER.index(key)
    return sum(_STAGE_INFO[k][1] for k in _STAGE_ORDER[:idx]) * 100.0


async def process_video_hq(
    input_path: Path,
    output_path: Path,
    regions: list[dict],
    mask_dilation: int = 6,
    on_progress: ProgressCb | None = None,
) -> None:
    """Elimina marcas de agua de video con ProPainter (coherencia temporal, IA).

    Reconstruye la zona usando información de fotogramas vecinos, sin el parpadeo
    de procesar cada frame por separado. Corre en GPU (CUDA).

    `on_progress(etiqueta, pct, eta_segundos)` se invoca con el avance en vivo.
    """
    if not propainter_available():
        raise RuntimeError("ProPainter no está disponible (falta el repo o CUDA).")

    width, height = await probe_dimensions(input_path)

    longest = max(width, height)
    resize_ratio = 1.0 if longest <= MAX_PROCESS_DIM else round(MAX_PROCESS_DIM / longest, 4)

    async def emit(label: str, pct: float, eta: float | None) -> None:
        if on_progress is None:
            return
        res = on_progress(label, max(0.0, min(100.0, pct)), eta)
        if asyncio.iscoroutine(res):
            await res

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        mask_path = tmp_dir / "mask.png"
        out_dir = tmp_dir / "out"
        _write_mask(regions, width, height, mask_dilation, mask_path)

        cmd = [
            sys.executable, "-u", str(PROPAINTER_SCRIPT),  # -u: salida sin buffer
            "--video", str(input_path),
            "--mask", str(mask_path),
            "--output", str(out_dir),
            "--mask_dilation", "0",        # ya dilatamos la máscara nosotros
            "--fp16",                      # media precisión: menos VRAM
            "--subvideo_length", "30",     # bloques cortos -> menos memoria, más estable
            "--neighbor_length", "6",
            "--ref_stride", "20",
        ]
        if resize_ratio < 1.0:
            cmd += ["--resize_ratio", str(resize_ratio)]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(PROPAINTER_DIR),       # el script usa rutas relativas (weights/, configs/)
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        await emit("Preparando el modelo", 1.0, None)
        await _consume_progress(proc, emit)

        rc = await proc.wait()
        if rc != 0:
            # Releemos lo que quede (ya consumido en _consume_progress vía tail).
            raise RuntimeError(
                "La GPU se quedó sin memoria, o ProPainter falló al procesar el "
                "video. Prueba con un video más corto o de menor resolución."
            )

        # ProPainter escribe en {out_dir}/{nombre_video}/inpaint_out.mp4
        stem = input_path.stem
        result = out_dir / stem / "inpaint_out.mp4"
        if not result.exists():
            matches = list(out_dir.rglob("inpaint_out.mp4"))
            if not matches:
                raise RuntimeError("No se encontró el resultado de ProPainter.")
            result = matches[0]

        await emit("Restaurando el audio", 99.0, 0)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        # ProPainter genera video sin audio: reincorporamos la pista del original.
        await _mux_with_original_audio(result, input_path, output_path)
        await emit("Completado", 100.0, 0)


async def _mux_with_original_audio(video_only: Path, original: Path, output_path: Path) -> None:
    """Combina el video reconstruido (sin audio) con el audio del original.

    El mapeo de audio es opcional ('?'): si el original no tiene audio, no falla y
    el resultado simplemente queda mudo. Si el mux falla, se entrega el video tal cual.
    """
    cmd = [
        _ffmpeg_bin(), "-y",
        "-i", str(video_only),   # pista de video reconstruida
        "-i", str(original),     # original, solo para tomar su audio
        "-map", "0:v:0",
        "-map", "1:a:0?",        # audio opcional: no falla si no existe
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        "-movflags", "+faststart",
        str(output_path),
    ]
    code, out = await _run(cmd)
    if code != 0:
        # Fallback: al menos entregamos el video reconstruido (sin audio).
        shutil.copyfile(video_only, output_path)


async def _consume_progress(proc, emit: Callable[[str, float, float | None], Awaitable[None]]) -> None:
    """Lee el stdout de ProPainter en vivo y traduce las barras tqdm a progreso global.

    tqdm reescribe la misma línea con '\\r', así que leemos por chunks y separamos
    por '\\r' y '\\n'. Cada barra trae su etiqueta de fase (PPSTAGE:xxx), con la que
    componemos un progreso global ponderado.
    """
    current_key = "flow"   # primera fase por defecto
    buf = b""

    while True:
        chunk = await proc.stdout.read(256)
        if not chunk:
            break
        buf += chunk
        parts = re.split(rb"[\r\n]", buf)
        buf = parts.pop()  # último fragmento (incompleto) se conserva
        for raw in parts:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            m = _TQDM_RE.search(line)
            if not m:
                continue
            key = m.group(1)
            pct_in_stage = float(m.group(2))
            eta_stage = _mmss_to_seconds(m.group(3))

            if key in _STAGE_INFO:
                current_key = key
            label, weight = _STAGE_INFO.get(current_key, ("Procesando", 1.0))
            global_pct = _stage_offset(current_key) + pct_in_stage * weight
            await emit(label, global_pct, eta_stage)
