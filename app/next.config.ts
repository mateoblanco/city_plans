import path from "node:path";
import type { NextConfig } from "next";

// /shared (tags y barrios compartidos con el backoffice) vive en la raíz del repo.
const repoRoot = path.join(__dirname, "..");

// Logos en R2: next/image sólo optimiza imágenes del origen de LOGO_BASE_URL.
const logoBase = process.env.LOGO_BASE_URL?.trim().replace(/\/+$/, "");
const logoPatterns = logoBase ? [new URL(`${logoBase}/**`)] : [];

const nextConfig: NextConfig = {
  reactCompiler: true,
  // "use cache" para la interpretación de búsquedas y los embeddings de consultas.
  cacheComponents: true,
  outputFileTracingRoot: repoRoot,
  // Dev: probar desde el teléfono por la IP de la red local (192.168.x.x). Sin esto, Next bloquea sus scripts de dev
  // para otros orígenes y la página nunca hidrata (sin mapa ni panel en /search). No afecta producción.
  allowedDevOrigins: ["192.168.*.*"],
  // AVIF primero (más liviano que WebP); el navegador que no lo acepta recibe WebP.
  images: { remotePatterns: logoPatterns, formats: ["image/avif", "image/webp"] },
  turbopack: {
    root: repoRoot,
    rules: {
      "*.svg": {
        loaders: [
          {
            loader: "@svgr/webpack",
            // Sin viewBox, achicar el ícono con CSS lo recorta en vez de escalarlo.
            options: {
              svgoConfig: { plugins: [{ name: "preset-default", params: { overrides: { removeViewBox: false } } }] },
            },
          },
        ],
        as: "*.js",
        condition: { not: "foreign" },
      },
    },
  },
};

export default nextConfig;
