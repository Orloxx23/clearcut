"""Servicio de procesamiento de imágenes: inpainting manual y detección automática de marcas de agua."""
from __future__ import annotations

import cv2
import numpy as np


# --- Tipos de relleno disponibles ---
INPAINT_ALGORITHMS = {
    "telea": cv2.INPAINT_TELEA,   # rápido, bueno para regiones pequeñas
    "ns": cv2.INPAINT_NS,         # Navier-Stokes, mejor en texturas
}


def _build_mask(shape: tuple[int, int], regions: list[dict], feather: int = 0) -> np.ndarray:
    """Construye una máscara binaria (255 = zona a reconstruir) a partir de regiones rectangulares.

    Cada región es {"x", "y", "width", "height"} en píxeles sobre la imagen original.
    `feather` expande la región para cubrir bordes/sombras de la marca de agua.
    """
    h, w = shape
    mask = np.zeros((h, w), dtype=np.uint8)
    for r in regions:
        x = int(round(r["x"])) - feather
        y = int(round(r["y"])) - feather
        rw = int(round(r["width"])) + feather * 2
        rh = int(round(r["height"])) + feather * 2
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(w, x + rw), min(h, y + rh)
        if x1 > x0 and y1 > y0:
            mask[y0:y1, x0:x1] = 255
    return mask


def inpaint_image(
    image_bytes: bytes,
    regions: list[dict],
    algorithm: str = "telea",
    radius: int = 5,
    feather: int = 3,
) -> bytes:
    """Reconstruye las regiones marcadas de una imagen usando inpainting de OpenCV.

    Devuelve los bytes de la imagen resultante (PNG).
    """
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("No se pudo decodificar la imagen.")

    if not regions:
        raise ValueError("No se especificaron regiones para procesar.")

    mask = _build_mask(img.shape[:2], regions, feather=feather)
    flag = INPAINT_ALGORITHMS.get(algorithm, cv2.INPAINT_TELEA)
    result = cv2.inpaint(img, mask, inpaintRadius=max(1, radius), flags=flag)

    ok, encoded = cv2.imencode(".png", result)
    if not ok:
        raise RuntimeError("No se pudo codificar la imagen resultante.")
    return encoded.tobytes()


def detect_watermark_regions(image_bytes: bytes, max_regions: int = 8) -> list[dict]:
    """Heurística de detección de candidatos a marca de agua (texto/logo).

    Estrategia: detección de regiones tipo texto con el detector MSER + morfología,
    priorizando zonas de alto contraste cerca de bordes/esquinas (donde suelen ir
    las marcas). Devuelve una lista de rectángulos sugeridos {x, y, width, height, score}.
    Es una *sugerencia* — el usuario puede ajustarla en el editor.
    """
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("No se pudo decodificar la imagen.")

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Realce de bordes para destacar texto/logos sobre el fondo.
    grad = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    _, bw = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)

    # Unir caracteres/elementos cercanos en bloques.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(9, w // 40), max(3, h // 80)))
    connected = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(connected, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates: list[dict] = []
    img_area = w * h
    for c in contours:
        x, y, rw, rh = cv2.boundingRect(c)
        area = rw * rh
        # Filtrar ruido y bloques demasiado grandes (probable fondo).
        if area < img_area * 0.0008 or area > img_area * 0.25:
            continue
        ar = rw / float(rh)
        if ar < 0.8 or ar > 25:  # las marcas suelen ser horizontales/alargadas
            continue

        # Puntuación: cercanía a un borde/esquina (donde suelen estar las marcas).
        cx, cy = x + rw / 2, y + rh / 2
        edge_dist = min(cx, w - cx, cy, h - cy) / (min(w, h) / 2)
        score = float(1.0 - edge_dist)  # más cerca del borde -> mayor score

        candidates.append({
            "x": int(x), "y": int(y), "width": int(rw), "height": int(rh),
            "score": round(score, 3),
        })

    candidates.sort(key=lambda r: r["score"], reverse=True)
    return candidates[:max_regions]
