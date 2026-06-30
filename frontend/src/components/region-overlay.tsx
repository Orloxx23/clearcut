"use client";

import { useCallback, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Region } from "@/lib/api";
import { cn } from "@/lib/utils";

interface RegionOverlayProps {
  /** Dimensiones naturales (en píxeles reales) de la media. */
  naturalWidth: number;
  naturalHeight: number;
  regions: Region[];
  onChange: (regions: Region[]) => void;
  disabled?: boolean;
}

interface DraftRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Capa transparente sobre la imagen/video que permite dibujar rectángulos
 * con el ratón. Las regiones se almacenan en coordenadas naturales; aquí se
 * convierten a/desde coordenadas de pantalla según el tamaño renderizado.
 */
export function RegionOverlay({
  naturalWidth,
  naturalHeight,
  regions,
  onChange,
  disabled,
}: RegionOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<DraftRect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  // Factor para pasar de coordenadas de pantalla -> naturales.
  const scale = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 1;
    return naturalWidth / rect.width;
  }, [naturalWidth]);

  const relativePos = useCallback((e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(e.clientY - rect.top, rect.height)),
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = relativePos(e);
    startRef.current = p;
    setDraft({ x: p.x, y: p.y, width: 0, height: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!startRef.current) return;
    const p = relativePos(e);
    const s = startRef.current;
    setDraft({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      width: Math.abs(p.x - s.x),
      height: Math.abs(p.y - s.y),
    });
  };

  const onPointerUp = () => {
    if (draft && draft.width > 6 && draft.height > 6) {
      const s = scale();
      onChange([
        ...regions,
        {
          x: Math.round(draft.x * s),
          y: Math.round(draft.y * s),
          width: Math.round(draft.width * s),
          height: Math.round(draft.height * s),
        },
      ]);
    }
    startRef.current = null;
    setDraft(null);
  };

  const removeRegion = (i: number) => {
    onChange(regions.filter((_, idx) => idx !== i));
  };

  // Conversión natural -> pantalla para renderizar (% del contenedor).
  const toPct = (region: Region) => ({
    left: `${(region.x / naturalWidth) * 100}%`,
    top: `${(region.y / naturalHeight) * 100}%`,
    width: `${(region.width / naturalWidth) * 100}%`,
    height: `${(region.height / naturalHeight) * 100}%`,
  });

  return (
    <div
      ref={ref}
      className={cn(
        "absolute inset-0 touch-none",
        disabled ? "cursor-not-allowed" : "cursor-crosshair",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {regions.map((r, i) => (
        <div
          key={i}
          className="absolute border-2 border-rose-500 bg-rose-500/20 group"
          style={toPct(r)}
        >
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => removeRegion(i)}
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-white opacity-0 transition group-hover:opacity-100"
            aria-label="Eliminar región"
          >
            <X className="h-3 w-3" />
          </button>
          {r.score !== undefined && (
            <span className="absolute left-0 top-0 -translate-y-full bg-rose-600 px-1 text-[10px] text-white">
              auto {Math.round(r.score * 100)}%
            </span>
          )}
        </div>
      ))}

      {draft && (
        <div
          className="absolute border-2 border-dashed border-sky-400 bg-sky-400/20"
          style={{
            left: draft.x,
            top: draft.y,
            width: draft.width,
            height: draft.height,
          }}
        />
      )}
    </div>
  );
}
