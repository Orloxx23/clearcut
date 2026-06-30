# Herramientas de video (marcas de agua + subtítulos)

Aplicación web con dos herramientas, todo procesado en local con IA:

1. **Quitar marcas de agua** de imágenes y videos (marca manual o detección
   automática; relleno clásico o reconstrucción con IA).
2. **Generar subtítulos** a partir del audio de un video (transcripción con
   Whisper), con editor integrado y exportación a SRT, VTT, TXT y JSON.

```
remove-watermark/
├── backend/    # API FastAPI (OpenCV + FFmpeg)
└── frontend/   # Next.js + Tailwind v4 + shadcn/ui
```

## Cómo funciona

Cada tipo de archivo tiene **dos modos de calidad**, seleccionables desde la UI:

| | Modo **Rápido** (clásico, sin GPU) | Modo **Alta calidad** (IA, requiere GPU CUDA) |
|---|---|---|
| **Imágenes** | OpenCV `cv2.inpaint` (Telea / Navier-Stokes) | **LaMa** — reconstruye texturas/estructuras, sin rastro |
| **Video** | FFmpeg `delogo` (interpola desde los bordes) | **ProPainter** — usa fotogramas vecinos, sin parpadeo |

- El modo **rápido** es instantáneo y no necesita GPU, pero deja cierto blur en
  zonas grandes.
- El modo **alta calidad** usa modelos de deep learning en GPU y deja la zona
  *como si la marca de agua nunca hubiera existido*. Es el recomendado.
- La **detección automática** de marcas (heurística OpenCV: gradiente morfológico
  + agrupación de texto/logos) está disponible en ambos modos para imágenes.
- El backend expone `GET /api/capabilities`; el frontend lo consulta y desactiva
  el modo IA automáticamente si no hay GPU/modelo disponible.

### Subtítulos

- Transcribe el audio del video con **faster-whisper** (modelo `large-v3`) en GPU.
- Detecta el idioma automáticamente y devuelve segmentos con marcas de tiempo.
- **Editor integrado**: corrige el texto de cada línea y salta a ese punto del
  video haciendo clic en su marca de tiempo.
- Exporta a **SRT**, **VTT**, **TXT** (texto plano) y **JSON** (con timestamps).
  La generación de formatos ocurre en el navegador a partir de los segmentos
  editados, así que es instantánea.

## Requisitos

- Node 20+ y pnpm
- Python 3.10+
- **FFmpeg** y **ffprobe** en el `PATH` (necesarios para video)
- Para el **modo alta calidad (IA)**: GPU **NVIDIA con CUDA** (probado en RTX 4060 Ti,
  16 GB). Sin GPU, la app funciona igual pero solo con el modo rápido.

## Puesta en marcha

### Backend (puerto 8000)

**Windows (PowerShell):**

```powershell
cd backend
python -m venv venv
# Opción simple (sin activar el venv):
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

> Si prefieres activar el venv: `.\venv\Scripts\Activate.ps1` y luego `uvicorn app.main:app --reload --port 8000`.
> Si PowerShell bloquea el script con *"ejecución de scripts deshabilitada"*, ejecuta una vez
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, o usa la opción simple de arriba.

**Linux / macOS:**

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Modo alta calidad (IA) — instalación

El orden importa: **instala PyTorch con CUDA primero**, o se instalará la build
CPU y la IA correrá lentísima. (Comandos en PowerShell con el python del venv.)

```powershell
cd backend
# 1) PyTorch con CUDA 12.4 (ajusta cu124 a tu versión de CUDA)
.\venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124

# 2) LaMa para imágenes (--no-deps evita degradar opencv/numpy/torch)
.\venv\Scripts\python.exe -m pip install --no-deps simple-lama-inpainting
.\venv\Scripts\python.exe -m pip install fire

# 3) ProPainter para video: clonar el repo + sus dependencias
git clone https://github.com/sczhou/ProPainter.git third_party/ProPainter
.\venv\Scripts\python.exe -m pip install av addict einops future scipy matplotlib scikit-image imageio-ffmpeg pyyaml requests timm yapf

# 4) Subtítulos: faster-whisper (aprovecha la build CUDA de torch)
.\venv\Scripts\python.exe -m pip install faster-whisper
```

> **Nota sobre ProPainter y el progreso**: para que la barra de progreso muestre
> las fases, se añadieron etiquetas `tqdm(desc='PPSTAGE:...')` a 4 bucles de
> `third_party/ProPainter/inference_propainter.py`. Si re-clonas el repo, vuelve a
> aplicar esas etiquetas (en los bucles de flujo óptico, flow completion, image
> propagation y el bucle principal de inpainting).

Los pesos de los modelos (~196 MB LaMa, ~200 MB ProPainter) se descargan solos
la primera vez que se usan. Verifica que CUDA está activo:

```powershell
.\venv\Scripts\python.exe -c "import torch; print(torch.cuda.is_available())"   # True
```

### Frontend (puerto 3000)

```bash
cd frontend
pnpm install
pnpm dev
```

Abre http://localhost:3000. La URL del backend se configura en
`frontend/.env.local` (`NEXT_PUBLIC_API_URL`).

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET`  | `/api/health` | Estado del servicio |
| `POST` | `/api/image/detect` | Sugiere regiones de marca de agua (multipart `file`) |
| `POST` | `/api/image/process` | Procesa imagen → PNG (`file`, `regions`, `algorithm`, `radius`, `feather`) |
| `POST` | `/api/video/process` | Procesa video → `{ job_id, download_url }` (`file`, `regions`) |
| `GET`  | `/api/video/download/{job_id}` | Descarga el video resultante |

`regions` es un JSON de objetos `{ "x", "y", "width", "height" }` en píxeles
sobre el archivo original.

## Límites

- Imagen: 25 MB · Video: 500 MB (configurable en `backend/app/main.py`).
- **Video en alta calidad (ProPainter)**: el procesado consume mucha VRAM. Para no
  exceder 16 GB, los videos con lado mayor a 1280px se reescalan automáticamente y
  se procesan en bloques cortos (`--fp16 --subvideo_length 40`). Videos muy largos
  o en 4K pueden agotar la memoria; en ese caso la API devuelve un error claro.
- El modo rápido (OpenCV/`delogo`) es aproximado en detalles complejos; para
  resultado sin rastro usa siempre el modo alta calidad.

## Uso responsable

Pensada para quitar marcas de agua de **contenido propio o debidamente
licenciado**. No la uses para infringir derechos de autor de terceros.
