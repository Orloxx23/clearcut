"""Aplica al script de inferencia de ProPainter:

- Las etiquetas de progreso (tqdm con desc 'PPSTAGE:...') que el backend parsea para
  mostrar la barra de progreso.
- La lectura del video con OpenCV en vez de torchvision.io.read_video, que falla con
  PyAV >= 14 ("open() got an unexpected keyword argument 'metadata_errors'").

Es idempotente: si ya está parcheado, no hace nada. Se ejecuta en el build de Docker
y en runpod_setup.sh tras clonar el repo de ProPainter.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Lectura del video con OpenCV. Sin autorrotación, como torchvision: así los
# fotogramas tienen las mismas dimensiones que da ffprobe, con las que el backend
# genera la máscara. fps=0 (contenedor sin dato) cae al --save_fps del script.
READ_VIDEO_ORIGINAL = """\
        vframes, aframes, info = torchvision.io.read_video(filename=frame_root, pts_unit='sec') # RGB
        frames = list(vframes.numpy())
        frames = [Image.fromarray(f) for f in frames]
        fps = info['video_fps']
"""
READ_VIDEO_PATCHED = """\
        cap = cv2.VideoCapture(frame_root)
        cap.set(cv2.CAP_PROP_ORIENTATION_AUTO, 0)
        fps = cap.get(cv2.CAP_PROP_FPS) or None
        frames = []
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
        cap.release()
        if not frames:
            raise RuntimeError(f'No se pudo leer ningún fotograma de {frame_root}')
"""

# (texto_original, texto_parcheado): los 4 bucles de fase y la lectura del video.
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
    (READ_VIDEO_ORIGINAL, READ_VIDEO_PATCHED),
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
    print(f"[patch_propainter] {changed} cambio(s) aplicado(s).")
    return 0


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "third_party/ProPainter/inference_propainter.py"
    raise SystemExit(main(target))
