"use client";

import { useCallback, useRef, useState } from "react";
import { Captions, Download, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getSubtitleStatus,
  startSubtitleJob,
  type Segment,
} from "@/lib/api";
import {
  downloadSubtitles,
  FORMAT_META,
  type SubtitleFormat,
} from "@/lib/subtitles";

interface LoadedVideo {
  file: File;
  url: string;
}

function fmtClock(seconds: number): string {
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  const s = Math.floor(seconds) % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${h > 0 ? p(h) + ":" : ""}${p(m)}:${p(s)}.${p(ms, 3)}`;
}

const FORMATS: SubtitleFormat[] = ["srt", "vtt", "txt", "json"];

export function SubtitleTool() {
  const [video, setVideo] = useState<LoadedVideo | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [language, setLanguage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith("video")) {
      toast.error("Sube un archivo de video.");
      return;
    }
    setSegments([]);
    setLanguage(null);
    setVideo({ file, url: URL.createObjectURL(file) });
  }, []);

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) loadFile(file);
  };

  const handleTranscribe = async () => {
    if (!video) return;
    setBusy(true);
    setProgress(0);
    setStage("Subiendo video…");
    setSegments([]);
    try {
      const jobId = await startSubtitleJob(video.file);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const s = await getSubtitleStatus(jobId);
        setProgress(s.progress);
        setStage(s.stage);
        if (s.status === "done" && s.result) {
          setSegments(s.result.segments);
          setLanguage(s.result.language);
          toast.success(`Subtítulos generados (${s.result.segments.length} líneas, idioma: ${s.result.language}).`);
          break;
        }
        if (s.status === "error") throw new Error(s.error ?? "Error al transcribir.");
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al transcribir.");
    } finally {
      setBusy(false);
    }
  };

  const updateText = (id: number, text: string) =>
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, text } : s)));

  const removeSegment = (id: number) =>
    setSegments((prev) => prev.filter((s) => s.id !== id));

  const seekTo = (t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      videoRef.current.play().catch(() => {});
    }
  };

  const reset = () => {
    if (video) URL.revokeObjectURL(video.url);
    setVideo(null);
    setSegments([]);
    setLanguage(null);
    setProgress(0);
  };

  const baseName = video?.file.name.replace(/\.[^.]+$/, "") || "subtitulos";

  // --- Dropzone ---
  if (!video) {
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
          dragOver ? "scale-[1.01] border-primary bg-primary/5" : "border-border bg-card/50 hover:border-primary/50 hover:bg-accent/40"
        }`}
      >
        <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={(e) => onFiles(e.target.files)} />
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-gradient shadow-lg shadow-primary/25 transition-transform group-hover:scale-105">
          <Captions className="h-7 w-7 text-white" />
        </div>
        <p className="mt-5 text-lg font-semibold">Arrastra un video para subtitular</p>
        <p className="mt-1 text-sm text-muted-foreground">o haz clic para seleccionar un archivo</p>
        <div className="mt-5 flex gap-1.5">
          {["MP4", "MOV", "WebM", "AVI"].map((f) => (
            <span key={f} className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {f}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* Video + transcripción */}
      <div className="space-y-4">
        <Card className="overflow-hidden p-0">
          <div className="flex max-h-[45vh] justify-center bg-black">
            <video ref={videoRef} src={video.url} className="max-h-[45vh] w-auto" controls />
          </div>
        </Card>

        {busy && (
          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {stage || "Procesando…"}
              </span>
              <span className="tabular-nums text-muted-foreground">{Math.round(progress)}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${Math.max(2, progress)}%` }} />
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Transcribiendo con IA (Whisper) en la GPU. La primera vez carga el modelo (~10s).
            </p>
          </Card>
        )}

        {/* Editor de segmentos */}
        {segments.length > 0 && (
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-medium">Subtítulos ({segments.length})</h3>
              {language && <Badge variant="secondary">Idioma: {language}</Badge>}
            </div>
            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {segments.map((s) => (
                <div key={s.id} className="group flex gap-2 rounded-lg border p-2">
                  <button
                    type="button"
                    onClick={() => seekTo(s.start)}
                    className="shrink-0 rounded bg-muted px-2 py-1 text-[11px] font-mono tabular-nums text-muted-foreground hover:bg-primary/10 hover:text-primary"
                    title="Ir a este momento en el video"
                  >
                    {fmtClock(s.start)}
                    <br />
                    {fmtClock(s.end)}
                  </button>
                  <textarea
                    value={s.text}
                    onChange={(e) => updateText(s.id, e.target.value)}
                    rows={2}
                    className="min-h-0 flex-1 resize-none rounded border-0 bg-transparent p-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => removeSegment(s.id)}
                    className="shrink-0 self-start text-muted-foreground opacity-0 transition hover:text-rose-600 group-hover:opacity-100"
                    title="Eliminar línea"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Panel lateral */}
      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Video</h3>
            <Badge variant="secondary">Audio → texto</Badge>
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground" title={video.file.name}>
            {video.file.name}
          </p>
          <p className="text-xs text-muted-foreground">{(video.file.size / 1024 / 1024).toFixed(1)} MB</p>
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={reset} disabled={busy}>
            <Trash2 className="mr-2 h-4 w-4" />
            Cambiar video
          </Button>
        </Card>

        {segments.length === 0 ? (
          <Button className="w-full" size="lg" onClick={handleTranscribe} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Captions className="mr-2 h-4 w-4" />}
            {busy ? "Transcribiendo…" : "Generar subtítulos"}
          </Button>
        ) : (
          <Card className="space-y-3 p-4">
            <h3 className="font-medium">Exportar</h3>
            <p className="text-xs text-muted-foreground">Descarga los subtítulos editados en el formato que necesites.</p>
            <div className="grid grid-cols-2 gap-2">
              {FORMATS.map((f) => (
                <Button key={f} variant="secondary" onClick={() => downloadSubtitles(segments, f, baseName)}>
                  <Download className="mr-2 h-4 w-4" />
                  {FORMAT_META[f].label}
                </Button>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="w-full" onClick={handleTranscribe} disabled={busy}>
              <Plus className="mr-2 h-4 w-4" />
              Volver a transcribir
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
