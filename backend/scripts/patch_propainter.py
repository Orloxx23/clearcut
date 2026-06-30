"""Aplica al script de inferencia de ProPainter las etiquetas de progreso (tqdm
con desc 'PPSTAGE:...') que el backend parsea para mostrar la barra de progreso.

Es idempotente: si ya está parcheado, no hace nada. Se ejecuta en el build de Docker
tras clonar el repo de ProPainter.
"""
from __future__ import annotations

import sys
from pathlib import Path

# (texto_original, texto_parcheado) para cada uno de los 4 bucles de fase.
REPLACEMENTS = [
    (
        "for f in range(0, video_length, short_clip_len):",
        "for f in tqdm(range(0, video_length, short_clip_len), desc='PPSTAGE:flow'):",
    ),
    (
        "for f in range(0, flow_length, args.subvideo_length):",
        "for f in tqdm(range(0, flow_length, args.subvideo_length), desc='PPSTAGE:complete'):",
    ),
    (
        "for f in range(0, video_length, subvideo_length_img_prop):",
        "for f in tqdm(range(0, video_length, subvideo_length_img_prop), desc='PPSTAGE:prop'):",
    ),
    (
        "for f in tqdm(range(0, video_length, neighbor_stride)):",
        "for f in tqdm(range(0, video_length, neighbor_stride), desc='PPSTAGE:inpaint'):",
    ),
]


def main(script_path: str) -> int:
    path = Path(script_path)
    if not path.exists():
        print(f"[patch_propainter] No existe: {path}", file=sys.stderr)
        return 1

    text = path.read_text(encoding="utf-8")
    changed = 0
    for original, patched in REPLACEMENTS:
        if patched in text:
            continue  # ya parcheado
        if original in text:
            text = text.replace(original, patched, 1)
            changed += 1
        else:
            print(f"[patch_propainter] AVISO: no se encontró el patrón:\n  {original}", file=sys.stderr)

    if changed:
        path.write_text(text, encoding="utf-8")
    print(f"[patch_propainter] {changed} bucle(s) parcheado(s).")
    return 0


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "third_party/ProPainter/inference_propainter.py"
    raise SystemExit(main(target))
