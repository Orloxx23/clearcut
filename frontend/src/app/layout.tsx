import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sparkles } from "lucide-react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clearcut — Quita marcas de agua y genera subtítulos",
  description:
    "Elimina marcas de agua de imágenes y videos con IA, y genera subtítulos automáticos. Procesado en local, privado y sin rastro.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {/* Navbar */}
          <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
            <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient shadow-sm shadow-primary/30">
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <span className="text-lg font-semibold tracking-tight">Clearcut</span>
              </div>
              <ThemeToggle />
            </div>
          </header>

          {children}

          <footer className="border-t border-border/60">
            <div className="mx-auto w-full max-w-6xl px-4 py-8 text-center text-xs text-muted-foreground sm:px-6">
              <p>
                Procesado 100% en local con IA · Usa estas herramientas solo con contenido sobre el que tengas derechos.
              </p>
            </div>
          </footer>
        </ThemeProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
