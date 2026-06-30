"""Pre-descarga los modelos de IA durante el build de Docker, para que el pod
arranque listo para usar sin esperas en el primer procesamiento.

- LaMa (big-lama.pt, ~196 MB) → caché de torch hub
- Whisper large-v3 (~3 GB) → caché de HuggingFace
- ProPainter (ProPainter.pth, raft, flow completion, ~200 MB) → weights/ del repo

Es tolerante a fallos parciales: si un modelo no se puede bajar, avisa pero no
aborta el build (se descargaría en runtime como respaldo).
"""
from __future__ import annotations

import sys


def download_lama() -> None:
    print("[models] Descargando LaMa…", flush=True)
    from simple_lama_inpainting import SimpleLama
    SimpleLama()  # descarga big-lama.pt al instanciar
    print("[models] LaMa OK", flush=True)


def download_whisper() -> None:
    print("[models] Descargando Whisper large-v3…", flush=True)
    from faster_whisper import WhisperModel
    # Forzamos descarga del modelo; en CPU basta para cachear los pesos.
    WhisperModel("large-v3", device="cpu", compute_type="int8")
    print("[models] Whisper OK", flush=True)


def download_propainter() -> None:
    """Descarga los pesos de ProPainter ejecutando su utilitario de descarga."""
    print("[models] Descargando pesos de ProPainter…", flush=True)
    import os
    from urllib.request import urlretrieve

    base = "https://github.com/sczhou/ProPainter/releases/download/v0.1.0/"
    weights_dir = os.path.join("third_party", "ProPainter", "weights")
    os.makedirs(weights_dir, exist_ok=True)
    files = [
        "ProPainter.pth",
        "recurrent_flow_completion.pth",
        "raft-things.pth",
        "i3d_rgb_imagenet.pt",
    ]
    for f in files:
        dest = os.path.join(weights_dir, f)
        if os.path.exists(dest):
            continue
        urlretrieve(base + f, dest)
    print("[models] ProPainter OK", flush=True)


def main() -> int:
    failures = []
    for name, fn in [("LaMa", download_lama), ("Whisper", download_whisper), ("ProPainter", download_propainter)]:
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            print(f"[models] AVISO: falló la descarga de {name}: {e}", file=sys.stderr, flush=True)
            failures.append(name)
    if failures:
        print(f"[models] Descargas pendientes (se bajarán en runtime): {', '.join(failures)}", flush=True)
    return 0  # nunca abortamos el build por esto


if __name__ == "__main__":
    raise SystemExit(main())
