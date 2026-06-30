"""Inpainting de alta calidad con LaMa (deep learning).

A diferencia de cv2.inpaint (que propaga colores de los bordes y deja blur),
LaMa reconstruye texturas y estructuras plausibles, dejando la zona como si la
marca de agua nunca hubiera existido.

El modelo se carga una sola vez (singleton perezoso) y se reutiliza entre
peticiones. Usa GPU automáticamente si hay CUDA disponible.
"""
from __future__ import annotations

import io
import threading

import cv2
import numpy as np
from PIL import Image

_lama = None
_lock = threading.Lock()


def is_available() -> bool:
    """Indica si LaMa puede usarse (paquete instalado)."""
    try:
        import simple_lama_inpainting  # noqa: F401
        return True
    except Exception:
        return False


def device() -> str:
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _get_model():
    """Devuelve la instancia de SimpleLama, cargándola la primera vez."""
    global _lama
    if _lama is None:
        with _lock:
            if _lama is None:
                from simple_lama_inpainting import SimpleLama
                # SimpleLama detecta CUDA automáticamente vía torch.
                _lama = SimpleLama()
    return _lama


def _build_mask(shape: tuple[int, int], regions: list[dict], dilation: int) -> np.ndarray:
    """Máscara binaria (255 = reconstruir). `dilation` expande la zona para
    cubrir bordes/sombras/halo de la marca de agua."""
    h, w = shape
    mask = np.zeros((h, w), dtype=np.uint8)
    for r in regions:
        x = int(round(r["x"]))
        y = int(round(r["y"]))
        rw = int(round(r["width"]))
        rh = int(round(r["height"]))
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(w, x + rw), min(h, y + rh)
        if x1 > x0 and y1 > y0:
            mask[y0:y1, x0:x1] = 255
    if dilation > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilation * 2 + 1, dilation * 2 + 1))
        mask = cv2.dilate(mask, k)
    return mask


def inpaint_image(image_bytes: bytes, regions: list[dict], dilation: int = 8) -> bytes:
    """Reconstruye las regiones marcadas con LaMa. Devuelve PNG en bytes."""
    if not regions:
        raise ValueError("No se especificaron regiones para procesar.")

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    arr = np.array(img)
    mask = _build_mask(arr.shape[:2], regions, dilation)

    model = _get_model()
    # SimpleLama espera imagen RGB (PIL) y máscara en modo "L" (blanco = relleno).
    result = model(img, Image.fromarray(mask).convert("L"))

    out = io.BytesIO()
    result.convert("RGB").save(out, format="PNG")
    return out.getvalue()
