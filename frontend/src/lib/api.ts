/** Cliente del backend de eliminación de marcas de agua. */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
  score?: number;
}

export type InpaintAlgorithm = "telea" | "ns";
export type Quality = "fast" | "high";

export interface ImageOptions {
  quality: Quality;
  algorithm: InpaintAlgorithm;
  radius: number;
  feather: number;
  dilation: number;
}

export interface Capabilities {
  image: { fast: boolean; high: boolean };
  video: { fast: boolean; high: boolean };
  subtitles: boolean;
  device: string;
}

export interface Segment {
  id: number;
  start: number; // segundos
  end: number;
  text: string;
}

export interface SubtitleStatus {
  status: "processing" | "done" | "error";
  progress: number;
  stage: string;
  error: string | null;
  result?: { language: string; segments: Segment[] };
}

/** Lanza la transcripción de un video; devuelve el job_id. */
export async function startSubtitleJob(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/api/subtitles/generate`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.job_id as string;
}

/** Consulta el estado de un trabajo de subtítulos. */
export async function getSubtitleStatus(jobId: string): Promise<SubtitleStatus> {
  const res = await fetch(`${API_URL}/api/subtitles/status/${jobId}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** Consulta qué modos de alta calidad (IA) están disponibles en el servidor. */
export async function getCapabilities(): Promise<Capabilities> {
  const res = await fetch(`${API_URL}/api/capabilities`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data.detail ?? `Error ${res.status}`;
  } catch {
    return `Error ${res.status}`;
  }
}

/** Solicita al backend regiones candidatas de marca de agua para una imagen. */
export async function detectRegions(file: File): Promise<Region[]> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/api/image/detect`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.regions as Region[];
}

/** Procesa una imagen y devuelve el blob resultante (PNG). */
export async function processImage(
  file: File,
  regions: Region[],
  options: ImageOptions,
): Promise<Blob> {
  const form = new FormData();
  form.append("file", file);
  form.append("regions", JSON.stringify(regions));
  form.append("quality", options.quality);
  form.append("algorithm", options.algorithm);
  form.append("radius", String(options.radius));
  form.append("feather", String(options.feather));
  form.append("dilation", String(options.dilation));
  const res = await fetch(`${API_URL}/api/image/process`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.blob();
}

/** Procesa un video; devuelve la URL de descarga del resultado. */
/** Lanza el procesamiento de un video; devuelve el job_id para seguir el progreso. */
export async function startVideoJob(
  file: File,
  regions: Region[],
  quality: Quality = "fast",
): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("regions", JSON.stringify(regions));
  form.append("quality", quality);
  const res = await fetch(`${API_URL}/api/video/process`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.job_id as string;
}

export interface VideoStatus {
  status: "processing" | "done" | "error";
  progress: number; // 0-100
  stage: string;
  eta: number | null; // segundos restantes estimados
  error: string | null;
  download_url?: string;
}

/** Consulta el estado de un trabajo de video. */
export async function getVideoStatus(jobId: string): Promise<VideoStatus> {
  const res = await fetch(`${API_URL}/api/video/status/${jobId}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** URL absoluta de descarga del resultado de un job. */
export function videoDownloadUrl(jobId: string): string {
  return `${API_URL}/api/video/download/${jobId}`;
}
