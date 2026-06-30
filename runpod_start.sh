#!/usr/bin/env bash
# ============================================================================
# Arranque automático de Clearcut en RunPod.
#
# Pensado para el campo "Container Start Command" del pod, de modo que el
# servicio se levante solo cada vez que enciendes la máquina.
#
# Configúralo en RunPod (Edit Pod -> Container Start Command):
#
#   bash -c "[ -d /workspace/clearcut ] || git clone https://github.com/Orloxx23/clearcut /workspace/clearcut; cd /workspace/clearcut && git pull || true; bash runpod_start.sh"
#
# Lanza el setup + servidor en SEGUNDO PLANO (con log) y deja el arranque base
# de la plantilla (SSH/Jupyter) en primer plano para no perder el acceso.
# ============================================================================
set -u

REPO_DIR="${CLEARCUT_DIR:-/workspace/clearcut}"
LOG="${CLEARCUT_LOG:-/workspace/clearcut.log}"
export CLEARCUT_CACHE="${CLEARCUT_CACHE:-/workspace/.clearcut-cache}"

echo "[clearcut-start] Arrancando setup + servidor en segundo plano."
echo "[clearcut-start] Log en vivo: tail -f $LOG"
(
  cd "$REPO_DIR" || { echo "[clearcut-start] No existe $REPO_DIR"; exit 1; }
  bash runpod_setup.sh
) > "$LOG" 2>&1 &

# Mantener el arranque base de la plantilla (SSH, Jupyter…) en primer plano.
# Si no existe, mantenemos el contenedor vivo para que el servidor siga corriendo.
if [ -x /start.sh ]; then
  exec /start.sh
else
  echo "[clearcut-start] /start.sh no encontrado; manteniendo el contenedor vivo."
  exec tail -f /dev/null
fi
