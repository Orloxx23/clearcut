/** Generadores de formatos de subtítulos a partir de segmentos {start, end, text}. */
import type { Segment } from "@/lib/api";

export type SubtitleFormat = "srt" | "vtt" | "txt" | "json";

export const FORMAT_META: Record<SubtitleFormat, { label: string; ext: string; mime: string }> = {
  srt: { label: "SRT", ext: "srt", mime: "application/x-subrip" },
  vtt: { label: "VTT", ext: "vtt", mime: "text/vtt" },
  txt: { label: "TXT", ext: "txt", mime: "text/plain" },
  json: { label: "JSON", ext: "json", mime: "application/json" },
};

function pad(n: number, len = 2): string {
  return String(Math.floor(n)).padStart(len, "0");
}

/** Formatea segundos como "HH:MM:SS,mmm" (SRT) o "HH:MM:SS.mmm" (VTT). */
function timestamp(seconds: number, sep: "," | "."): string {
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  const s = Math.floor(seconds) % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`;
}

function toSrt(segments: Segment[]): string {
  return segments
    .map((s, i) => `${i + 1}\n${timestamp(s.start, ",")} --> ${timestamp(s.end, ",")}\n${s.text}\n`)
    .join("\n");
}

function toVtt(segments: Segment[]): string {
  const body = segments
    .map((s) => `${timestamp(s.start, ".")} --> ${timestamp(s.end, ".")}\n${s.text}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

function toTxt(segments: Segment[]): string {
  return segments.map((s) => s.text).join("\n");
}

function toJson(segments: Segment[]): string {
  return JSON.stringify(
    segments.map((s) => ({ start: s.start, end: s.end, text: s.text })),
    null,
    2,
  );
}

export function generateSubtitles(segments: Segment[], format: SubtitleFormat): string {
  switch (format) {
    case "srt":
      return toSrt(segments);
    case "vtt":
      return toVtt(segments);
    case "txt":
      return toTxt(segments);
    case "json":
      return toJson(segments);
  }
}

/** Dispara la descarga de los subtítulos en el formato dado. */
export function downloadSubtitles(segments: Segment[], format: SubtitleFormat, baseName = "subtitulos"): void {
  const meta = FORMAT_META[format];
  const content = generateSubtitles(segments, format);
  const blob = new Blob([content], { type: meta.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}.${meta.ext}`;
  a.click();
  URL.revokeObjectURL(url);
}
