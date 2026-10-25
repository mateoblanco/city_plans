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
  images: { remotePatterns: logoPatterns },
  turbopack: {
    root: repoRoot,
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
        // Los íconos de los marcadores (shared/icons) quedan como imágenes estáticas: URL con hash y caché.
        condition: { all: [{ not: "foreign" }, { not: { path: /shared\/icons\// } }] },
      },
    },
  },
};

export default nextConfig;
