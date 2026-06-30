# Despliegue en RunPod

La app se empaqueta como **un solo contenedor Docker** con GPU: el backend FastAPI
sirve tanto la API como el frontend (Next.js exportado estático) en **un único
puerto (8000)**. No hay CORS ni URLs que configurar.

Los modelos de IA (LaMa, ProPainter y Whisper `large-v3`) se **pre-descargan dentro
de la imagen**, así que el pod arranca listo para usar.

---

## Dos formas de desplegar

- **Opción A — Imagen Docker propia**: construyes la imagen, la subes a un registro
  y lanzas el pod desde ella. Más reproducible y de arranque instantáneo, pero
  requiere Docker local y publicar ~10-12 GB.
- **Opción B — Plantilla PyTorch de RunPod + script de setup**: lanzas un pod con una
  plantilla base existente y un script instala el resto. No necesitas Docker local
  ni publicar nada; ideal si usas un **Network Volume** para no repetir el setup.

Elige una. La Opción A está abajo; la Opción B, más abajo.

---

# Opción A — Imagen Docker propia

## 1. Construir la imagen

Desde la raíz del proyecto:

```bash
docker build -t TU_USUARIO/clearcut:latest .
```

> La imagen final pesa ~10-12 GB (CUDA runtime + torch + ~3.5 GB de modelos).
> El primer build tarda bastante (descarga la base de PyTorch y los modelos).

Pruébala en local si tienes GPU NVIDIA + Docker con soporte CUDA:

```bash
docker run --rm --gpus all -p 8000:8000 TU_USUARIO/clearcut:latest
# Abre http://localhost:8000
```

## 2. Subir la imagen a un registro

RunPod arranca pods desde una imagen en un registro (Docker Hub, GHCR, etc.):

```bash
docker login
docker push TU_USUARIO/clearcut:latest
```

## 3. Crear el Pod en RunPod

1. **RunPod → Pods → Deploy** y elige una **GPU con ≥ 16 GB de VRAM**
   (p. ej. RTX 4090, A5000, L4…). Con eso ProPainter procesa vídeo holgadamente.
2. En **Container Image** pon `TU_USUARIO/clearcut:latest`.
3. **Expose HTTP Ports**: `8000`.
4. (Opcional) **Container Disk**: ≥ 20 GB para la imagen + archivos temporales.
5. Lanza el pod. Cuando esté *Running*, abre la URL del proxy:
   `https://<POD_ID>-8000.proxy.runpod.net`

¡Listo! Esa URL sirve la interfaz web completa, y la API vive bajo `/api` en el
mismo origen.

---

# Opción B — Plantilla PyTorch de RunPod + script de setup

No construyes ninguna imagen: usas una plantilla base con CUDA + PyTorch y el script
[`runpod_setup.sh`](runpod_setup.sh) instala lo que falta (ffmpeg, dependencias,
ProPainter, modelos), compila el frontend y arranca el servidor.

## 1. Lanzar el pod

1. **RunPod → Pods → Deploy**, GPU con **≥ 16 GB de VRAM**.
2. En plantilla elige **"RunPod PyTorch 2.4"** o superior.
   > Importante: usa **torch 2.4+** (trae cuDNN 9). `faster-whisper`/CTranslate2
   > necesita cuDNN 9; con plantillas más antiguas (cuDNN 8) la transcripción falla.
3. **Expose HTTP Ports**: `8000`.
4. (Recomendado) Adjunta un **Network Volume** montado en `/workspace`, para que el
   setup y los modelos persistan entre reinicios.

## 2. Setup dentro del pod

Conéctate por la **web terminal** o **SSH** y ejecuta:

```bash
cd /workspace
git clone TU_REPO clearcut
cd clearcut
# Cachear modelos en el volumen persistente (opcional pero recomendado):
export CLEARCUT_CACHE=/workspace/.clearcut-cache
bash runpod_setup.sh
```

La **primera vez** tarda (instala dependencias, clona ProPainter, descarga ~3.5 GB de
modelos y compila el frontend). En arranques posteriores reaprovecha todo lo cacheado
y levanta en segundos. Cuando veas `Arrancando servidor en 0.0.0.0:8000`, abre
`https://<POD_ID>-8000.proxy.runpod.net`.

## 3. Re-arranques

Para volver a arrancar sin rehacer el setup (mismo volumen):

```bash
cd /workspace/clearcut && export CLEARCUT_CACHE=/workspace/.clearcut-cache && bash runpod_setup.sh
```

> El script es idempotente: salta lo ya instalado. Para forzar recompilar el frontend
> tras cambios, usa `REBUILD_FRONTEND=1 bash runpod_setup.sh`.

## 4. Arranque automático al encender el pod

Para que el servicio se levante solo cada vez que enciendes la máquina (sin entrar a
la terminal), usa el **Container Start Command** del pod con el script
[`runpod_start.sh`](runpod_start.sh).

En **Edit Pod → Container Start Command** pega:

```
bash -c "[ -d /workspace/clearcut ] || git clone https://github.com/Orloxx23/clearcut /workspace/clearcut; cd /workspace/clearcut && git pull || true; bash runpod_start.sh"
```

Qué hace en cada arranque:
1. Clona el repo si falta (primer arranque) y hace `git pull`.
2. Lanza `runpod_setup.sh` en **segundo plano** (instala lo que falte, arranca el server).
3. Mantiene el arranque base de la plantilla (SSH/terminal) en primer plano.

El log del servicio queda en `/workspace/clearcut.log`:

```bash
tail -f /workspace/clearcut.log   # ver el arranque en vivo
```

> **GPU Blackwell** (RTX PRO 6000, 5090): usa la plantilla **PyTorch 2.8** (CUDA 12.8).
> Las de CUDA 12.4 (PyTorch 2.4) no traen kernels para Blackwell y fallan al procesar.
> Para Ada/Ampere (4090, A5000…) la PyTorch 2.4 va perfecta.

> **Nota**: con un Container Start Command custom, el primer arranque tras encender
> tarda lo que tarde el setup (rápido si el volumen ya tiene deps/modelos cacheados).
> Para un auto-arranque instantáneo y 100% reproducible, considera la **Opción A**
> (imagen Docker propia): su `CMD` levanta el server nativo sin scripts.

---

## Variables de entorno (opcionales)

| Variable | Por defecto | Para qué |
|----------|-------------|----------|
| `PORT` | `8000` | Puerto en el que escucha el servidor. |
| `FRONTEND_DIR` | `/app/frontend_static` | Carpeta del frontend estático. |
| `CORS_ORIGINS` | _(vacío)_ | Orígenes extra permitidos (coma-separados), o `*`. Solo necesario si sirves el frontend desde otro dominio. |
| `CLEARCUT_CACHE` | `<repo>/.cache` | (Opción B) Carpeta de cachés de modelos. Apúntala a `/workspace/...` para persistir entre pods. |
| `REBUILD_FRONTEND` | `0` | (Opción B) `1` fuerza recompilar el frontend. |

---

## Notas y límites

- **GPU obligatoria** para el modo *alta calidad* (LaMa, ProPainter) y los
  subtítulos (Whisper). Sin GPU, la app funciona pero solo en modo *rápido*
  (OpenCV/FFmpeg) y la transcripción se desactiva.
- **VRAM**: el vídeo en alta calidad se procesa a un máximo de 960px de lado y en
  bloques cortos para no exceder ~16 GB. Vídeos 4K o muy largos pueden requerir
  más memoria.
- **Estado en memoria**: los trabajos de vídeo/subtítulos se guardan en memoria del
  proceso. Para escalar a varios workers haría falta un store externo (Redis).
- **Almacenamiento efímero**: los archivos subidos/resultados viven en el disco del
  contenedor. Si necesitas persistencia, monta un volumen de RunPod en `/app/outputs`.

## Estructura relevante

```
Dockerfile                      # Opción A: build multi-stage (frontend → runtime CUDA)
.dockerignore
runpod_setup.sh                 # Opción B: setup + arranque sobre plantilla PyTorch
backend/
  app/                          # FastAPI (sirve API + frontend estático)
  scripts/
    patch_propainter.py         # añade las etiquetas de progreso a ProPainter
    download_models.py          # pre-descarga de modelos
frontend/                       # Next.js (se exporta estático en el build)
```
