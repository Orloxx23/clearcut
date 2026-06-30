"use client";

import { useState } from "react";
import { Captions, Eraser, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { WatermarkEditor } from "@/components/watermark-editor";
import { SubtitleTool } from "@/components/subtitle-tool";

type Tool = "watermark" | "subtitles";

const TABS: { id: Tool; label: string; icon: typeof Eraser }[] = [
  { id: "watermark", label: "Quitar marca de agua", icon: Eraser },
  { id: "subtitles", label: "Generar subtítulos", icon: Captions },
];

export default function Home() {
  const [tool, setTool] = useState<Tool>("watermark");

  return (
    <main className="relative flex-1">
      {/* Halo de fondo */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-aurora" />

      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-16">
        {/* Hero */}
        <section className="mx-auto max-w-3xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Procesado con IA en tu equipo · privado y sin rastro
          </div>
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            Edita tus videos sin <span className="text-gradient">complicaciones</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
            Quita marcas de agua de imágenes y videos, o genera subtítulos automáticos. Reconstrucción con IA que no deja
            rastro, todo en local.
          </p>

          {/* Chips de features */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" /> Reconstrucción con IA
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-primary" /> Acelerado por GPU
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-primary" /> 100% privado
            </span>
          </div>
        </section>

        {/* Selector de herramienta */}
        <div className="mt-10 flex justify-center">
          <div className="inline-flex rounded-2xl border border-border/70 bg-card/70 p-1.5 shadow-sm backdrop-blur">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTool(id)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all sm:px-5 ${
                  tool === id
                    ? "bg-brand-gradient text-white shadow-md shadow-primary/25"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Herramienta activa */}
        <div className="mt-10">{tool === "watermark" ? <WatermarkEditor /> : <SubtitleTool />}</div>
      </div>
    </main>
  );
}
