"use client";

import { useState } from "react";
import { Download, HardDrive, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  absoluteUrl,
  clearStorage,
  deleteStorageItem,
  getStorage,
  type StorageItem,
} from "@/lib/api";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString();
}

export function StorageDialog() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<StorageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const d = await getStorage();
      setItems(d.items);
      setTotal(d.total_bytes);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cargar el almacenamiento.");
    } finally {
      setLoading(false);
    }
  };

  const openDialog = () => {
    setOpen(true);
    load();
  };

  const remove = async (id: string) => {
    setWorking(true);
    try {
      await deleteStorageItem(id);
      toast.success("Archivo eliminado.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al eliminar.");
    } finally {
      setWorking(false);
    }
  };

  const clearAll = async () => {
    if (items.length === 0) return;
    setWorking(true);
    try {
      const r = await clearStorage();
      toast.success(`Liberado ${formatBytes(r.freed_bytes)} (${r.deleted} archivo(s)).`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al limpiar.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="icon" aria-label="Almacenamiento" onClick={openDialog}>
        <HardDrive className="h-5 w-5" />
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border bg-card shadow-2xl">
            {/* Cabecera */}
            <div className="flex items-start justify-between border-b p-5">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <HardDrive className="h-5 w-5 text-primary" />
                  Videos guardados
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {items.length} archivo(s) · {formatBytes(total)} en disco
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Lista */}
            <div className="flex-1 overflow-y-auto p-3">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando…
                </div>
              ) : items.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No hay videos guardados. Los resultados de video procesados aparecerán aquí.
                </div>
              ) : (
                <ul className="space-y-2">
                  {items.map((it) => (
                    <li
                      key={it.job_id}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                        <HardDrive className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{formatDate(it.modified)}</p>
                        <p className="text-xs text-muted-foreground">{formatBytes(it.size_bytes)}</p>
                      </div>
                      <a href={absoluteUrl(it.download_url)} download={`${it.job_id}.mp4`}>
                        <Button variant="ghost" size="icon" aria-label="Descargar">
                          <Download className="h-4 w-4" />
                        </Button>
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Eliminar"
                        disabled={working}
                        onClick={() => remove(it.job_id)}
                        className="text-muted-foreground hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Pie */}
            {items.length > 0 && (
              <div className="border-t p-4">
                <Button
                  variant="outline"
                  className="w-full text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30"
                  disabled={working}
                  onClick={clearAll}
                >
                  {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  Limpiar todo
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
