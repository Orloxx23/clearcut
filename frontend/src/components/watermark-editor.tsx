"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  Gauge,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { RegionOverlay } from "@/components/region-overlay";
import { CompareSlider } from "@/components/compare-slider";
import {
  detectRegions,
  getCapabilities,
  getVideoStatus,
  processImage,
  startVideoJob,
  videoDownloadUrl,
  type Capabilities,
  type InpaintAlgorithm,
  type Quality,
  type Region,
} from "@/lib/api";

type MediaKind = "image" | "video";

interface Loaded {
  file: File;
  url: string;
  kind: MediaKind;
  naturalWidth: number;
  naturalHeight: number;
}

const ACCEPT = "image/*,video/*";

function formatTime(s: number | null): string {
  if (s == null) return "";
  if (s < 60) return `~${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return sec ? `~${m} min ${sec} s` : `~${m} min`;
}

export function WatermarkEditor() {
  const [media, setMedia] = useState<Loaded | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [quality, setQuality] = useState<Quality>("high");
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [algorithm, setAlgorithm] = useState<InpaintAlgorithm>("telea");
  const [radius, setRadius] = useState(5);
  const [feather, setFeather] = useState(3);
  const [dilation, setDilation] = useState(8);
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Progreso de video
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [eta, setEta] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const cancelPoll = useRef(false);

  useEffect(() => {
    getCapabilities()
      .then((c) => {
        setCaps(c);
        if (!c.image.high) setQuality("fast");
      })
      .catch(() => setCaps(null));
  }, []);

  const reset = useCallback(() => {
    cancelPoll.current = true;
    if (media) URL.revokeObjectURL(media.url);
    if (resultUrl && resultUrl.startsWith("blob:")) URL.revokeObjectURL(resultUrl);
    setMedia(null);
    setRegions([]);
    setResultUrl(null);
    setProgress(0);
    setStage("");
    setEta(null);
    setBusy(false);
  }, [media, resultUrl]);

  const loadFile = useCallback((file: File) => {
    const kind: MediaKind = file.type.startsWith("video") ? "video" : "image";
    const url = URL.createObjectURL(file);
    setRegions([]);
    setResultUrl(null);

    if (kind === "image") {
      const img = new Image();
      img.onload = () =>
        setMedia({ file, url, kind, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
      img.onerror = () => toast.error("No se pudo cargar la imagen.");
      img.src = url;
    } else {
      const vid = document.createElement("video");
      vid.onloadedmetadata = () =>
        setMedia({ file, url, kind, naturalWidth: vid.videoWidth, naturalHeight: vid.videoHeight });
      vid.onerror = () => toast.error("No se pudo cargar el video.");
      vid.src = url;
    }
  }, []);

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image") && !file.type.startsWith("video")) {
      toast.error("Formato no soportado. Sube una imagen o un video.");
      return;
    }
    loadFile(file);
  };

  const handleDetect = async () => {
    if (!media || media.kind !== "image") return;
    setDetecting(true);
    try {
      const found = await detectRegions(media.file);
      if (found.length === 0) {
        toast.info("No se detectaron marcas automáticamente. Márcalas a mano.");
      } else {
        setRegions((prev) => [...prev, ...found]);
        toast.success(`${found.length} región(es) detectada(s). Ajústalas si hace falta.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al detectar.");
    } finally {
      setDetecting(false);
    }
  };

  const handleProcess = async () => {
    if (!media) return;
    if (regions.length === 0) {
      toast.error("Marca al menos una región sobre la marca de agua.");
      return;
    }
    setBusy(true);
    setResultUrl(null);
    setProgress(0);
    setStage(media.kind === "video" ? "Subiendo video…" : "Procesando…");
    setEta(null);

    try {
      if (media.kind === "image") {
        const blob = await processImage(media.file, regions, { quality, algorithm, radius, feather, dilation });
        setResultUrl(URL.createObjectURL(blob));
        toast.success("Imagen procesada.");
      } else {
        cancelPoll.current = false;
        const jobId = await startVideoJob(media.file, regions, quality);
        // Polling del progreso cada segundo.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (cancelPoll.current) return;
          const s = await getVideoStatus(jobId);
          setProgress(s.progress);
          setStage(s.stage);
          setEta(s.eta);
          if (s.status === "done") {
            setResultUrl(videoDownloadUrl(jobId));
            toast.success("Video procesado.");
            break;
          }
          if (s.status === "error") {
            throw new Error(s.error ?? "Error al procesar el video.");
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al procesar.");
    } finally {
      setBusy(false);
    }
  };

  const aiUnavailable = media
    ? media.kind === "image"
      ? !caps?.image.high
      : !caps?.video.high
    : false;

  // --- Pantalla inicial: dropzone ---
  if (!media) {
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`group flex min-h-[440px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed transition-all ${
          dragOver
            ? "scale-[1.01] border-primary bg-primary/5"
            : "border-border bg-card/50 hover:border-primary/50 hover:bg-accent/40"
        }`}
      >
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => onFiles(e.target.files)} />
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-gradient shadow-lg shadow-primary/25 transition-transform group-hover:scale-105">
          <Upload className="h-7 w-7 text-white" />
        </div>
        <p className="mt-5 text-lg font-semibold">Arrastra una imagen o un video</p>
        <p className="mt-1 text-sm text-muted-foreground">o haz clic para seleccionar un archivo</p>
        <div className="mt-5 flex gap-1.5">
          {["JPG", "PNG", "WebP", "MP4", "MOV", "WebM"].map((f) => (
            <span key={f} className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {f}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // --- Editor ---
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      {/* Lienzo */}
      <div className="space-y-4">
        <Card className="overflow-hidden p-0">
          <div className="flex max-h-[65vh] items-center justify-center bg-[repeating-conic-gradient(#0001_0%_25%,transparent_0%_50%)] [background-size:24px_24px] p-2">
            {resultUrl ? (
              /* Comparador antes/después sobre el mismo lienzo */
              <CompareSlider beforeUrl={media.url} afterUrl={resultUrl} kind={media.kind} />
            ) : (
              <div className="relative inline-block max-h-[calc(65vh-1rem)]">
                {media.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={media.url}
                    alt="media"
                    className="block max-h-[calc(65vh-1rem)] w-auto object-contain"
                    draggable={false}
                  />
                ) : (
                  <video
                    src={media.url}
                    className="block max-h-[calc(65vh-1rem)] w-auto object-contain"
                    controls={false}
                    muted
                    loop
                    autoPlay
                    playsInline
                  />
                )}
                <RegionOverlay
                  naturalWidth={media.naturalWidth}
                  naturalHeight={media.naturalHeight}
                  regions={regions}
                  onChange={setRegions}
                  disabled={busy}
                />
              </div>
            )}
          </div>
        </Card>

        {resultUrl ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-center text-sm text-muted-foreground">
              Arrastra la barra para comparar el antes y el después.
            </p>
            <div className="flex w-full gap-2">
              <a
                className="flex-1"
                href={resultUrl}
                download={media.kind === "image" ? "resultado.png" : "resultado.mp4"}
              >
                <Button className="w-full">
                  <Download className="mr-2 h-4 w-4" />
                  Descargar resultado
                </Button>
              </a>
              <Button variant="outline" onClick={() => setResultUrl(null)}>
                Volver a editar
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            Dibuja un rectángulo sobre cada marca de agua. Pasa el cursor sobre una región para eliminarla.
          </p>
        )}

        {/* Barra de progreso (video) */}
        {busy && media.kind === "video" && (
          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {stage || "Procesando…"}
              </span>
              <span className="tabular-nums text-muted-foreground">{Math.round(progress)}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                style={{ width: `${Math.max(2, progress)}%` }}
              />
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {eta != null && eta > 0 ? `Tiempo restante ${formatTime(eta)}` : "Estimando tiempo…"}
              {" · "}El video se procesa con IA en la GPU; puede tardar unos minutos.
            </p>
          </Card>
        )}
      </div>

      {/* Panel de control */}
      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Archivo</h3>
            <Badge variant="secondary">{media.kind === "image" ? "Imagen" : "Video"}</Badge>
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground" title={media.file.name}>
            {media.file.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {media.naturalWidth}×{media.naturalHeight}px · {(media.file.size / 1024 / 1024).toFixed(1)} MB
          </p>
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={reset} disabled={busy}>
            <Trash2 className="mr-2 h-4 w-4" />
            Cambiar archivo
          </Button>
        </Card>

        {/* Calidad */}
        <Card className="space-y-3 p-4">
          <h3 className="font-medium">Calidad</h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setQuality("high")}
              disabled={busy || aiUnavailable}
              className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition disabled:cursor-not-allowed disabled:opacity-40 ${
                quality === "high" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
              }`}
            >
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Alta calidad</span>
              <span className="text-[11px] text-muted-foreground">IA · sin rastro</span>
            </button>
            <button
              type="button"
              onClick={() => setQuality("fast")}
              disabled={busy}
              className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition disabled:cursor-not-allowed disabled:opacity-40 ${
                quality === "fast" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
              }`}
            >
              <Zap className="h-4 w-4" />
              <span className="text-sm font-medium">Rápido</span>
              <span className="text-[11px] text-muted-foreground">Clásico · instantáneo</span>
            </button>
          </div>
          {caps && !aiUnavailable && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Gauge className="h-3 w-3" />
              {quality === "high"
                ? `Procesando en ${caps.device.toUpperCase()} con IA`
                : "Método clásico (OpenCV / FFmpeg)"}
            </p>
          )}
          {aiUnavailable && (
            <p className="text-[11px] text-amber-600">
              El modo alta calidad no está disponible para {media.kind === "image" ? "imágenes" : "video"} en este servidor.
            </p>
          )}
        </Card>

        {/* Regiones */}
        <Card className="space-y-4 p-4">
          <h3 className="font-medium">Regiones ({regions.length})</h3>
          {media.kind === "image" && (
            <Button variant="secondary" className="w-full" onClick={handleDetect} disabled={detecting || busy}>
              {detecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              Detectar automáticamente
            </Button>
          )}
          {regions.length > 0 && (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setRegions([])} disabled={busy}>
              Limpiar regiones
            </Button>
          )}
        </Card>

        {/* Ajustes modo rápido (imagen) */}
        {media.kind === "image" && quality === "fast" && (
          <Card className="space-y-4 p-4">
            <h3 className="font-medium">Ajustes de relleno</h3>
            <div className="space-y-2">
              <Label>Algoritmo</Label>
              <Select value={algorithm} onValueChange={(v) => setAlgorithm(v as InpaintAlgorithm)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="telea">Telea (rápido)</SelectItem>
                  <SelectItem value="ns">Navier-Stokes (texturas)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Radio</Label>
                <span className="text-sm text-muted-foreground">{radius}px</span>
              </div>
              <Slider value={[radius]} min={1} max={20} step={1} onValueChange={(v) => setRadius(Array.isArray(v) ? v[0] : v)} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Margen (feather)</Label>
                <span className="text-sm text-muted-foreground">{feather}px</span>
              </div>
              <Slider value={[feather]} min={0} max={15} step={1} onValueChange={(v) => setFeather(Array.isArray(v) ? v[0] : v)} />
            </div>
          </Card>
        )}

        {/* Ajustes modo IA (imagen) */}
        {media.kind === "image" && quality === "high" && (
          <Card className="space-y-4 p-4">
            <h3 className="font-medium">Ajustes de IA</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Margen del borde</Label>
                <span className="text-sm text-muted-foreground">{dilation}px</span>
              </div>
              <Slider value={[dilation]} min={0} max={30} step={1} onValueChange={(v) => setDilation(Array.isArray(v) ? v[0] : v)} />
              <p className="text-[11px] text-muted-foreground">
                Expande la zona a reconstruir para cubrir bordes y sombras de la marca de agua.
              </p>
            </div>
          </Card>
        )}

        <Separator />

        <Button className="w-full" size="lg" onClick={handleProcess} disabled={busy || regions.length === 0}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {busy ? "Procesando…" : "Quitar marca de agua"}
        </Button>
      </div>
    </div>
  );
}
