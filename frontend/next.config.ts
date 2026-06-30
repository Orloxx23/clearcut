import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exporta un sitio estático (HTML/JS) servible por cualquier servidor — en
  // producción lo sirve el propio backend FastAPI en el mismo origen, así que
  // las llamadas a /api no necesitan CORS ni URL absoluta.
  output: "export",
  // El export estático no usa el optimizador de imágenes de Next.
  images: { unoptimized: true },
};

export default nextConfig;
