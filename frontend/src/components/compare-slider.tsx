"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MoveHorizontal } from "lucide-react";

interface CompareSliderProps {
  /** Media original (con marca de agua) — se muestra a la izquierda. */
  beforeUrl: string;
  /** Resultado reconstruido — se muestra a la derecha. */
  afterUrl: string;
  kind: "image" | "video";
}

/**
 * Comparador "antes/después": muestra ambas medias superpuestas y una barra
 * vertical arrastrable que revela una u otra. Para video, sincroniza la
 * reproducción de ambos clips.
 */
export function CompareSlider({ beforeUrl, afterUrl, kind }: CompareSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const beforeVideoRef = useRef<HTMLVideoElement>(null);
  const afterVideoRef = useRef<HTMLVideoElement>(null);
  const dragging = useRef(false);
  const [pos, setPos] = useState(50); // % del divisor
  const [width, setWidth] = useState(0); // ancho renderizado, para alinear el "antes"

  // Medir el ancho del contenedor (lo define la media "después").
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Sincronizar ambos videos al del "después" (master).
  useEffect(() => {
    if (kind !== "video") return;
    const after = afterVideoRef.current;
    const before = beforeVideoRef.current;
    if (!after || !before) return;
    let raf = 0;
    const sync = () => {
      if (Math.abs(before.currentTime - after.currentTime) > 0.08) {
        before.currentTime = after.currentTime;
      }
      raf = requestAnimationFrame(sync);
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [kind]);

  const moveTo = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const p = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.max(0, Math.min(100, p)));
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative inline-block max-h-[60vh] cursor-ew-resize touch-none select-none"
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        moveTo(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && moveTo(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      {/* DESPUÉS (resultado) — define el tamaño del contenedor */}
      {kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={afterUrl} alt="después" className="block max-h-[60vh] w-auto" draggable={false} />
      ) : (
        <video ref={afterVideoRef} src={afterUrl} className="block max-h-[60vh] w-auto" autoPlay loop muted playsInline />
      )}

      {/* ANTES (original), recortado al ancho del divisor */}
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={beforeUrl}
            alt="antes"
            className="block h-full max-w-none object-cover"
            style={{ width: width || "auto" }}
            draggable={false}
          />
        ) : (
          <video
            ref={beforeVideoRef}
            src={beforeUrl}
            className="block h-full max-w-none object-cover"
            style={{ width: width || "auto" }}
            autoPlay
            loop
            muted
            playsInline
          />
        )}
      </div>

      {/* Etiquetas */}
      <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/55 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
        Antes
      </span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/55 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
        Después
      </span>

      {/* Divisor + tirador */}
      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow-[0_0_8px_rgba(0,0,0,0.4)]"
        style={{ left: `${pos}%`, transform: "translateX(-50%)" }}
      >
        <div className="absolute top-1/2 left-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/10">
          <MoveHorizontal className="h-5 w-5 text-gray-700" />
        </div>
      </div>
    </div>
  );
}
