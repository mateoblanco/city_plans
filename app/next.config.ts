import path from "node:path";
import type { NextConfig } from "next";

// /shared (tags y barrios compartidos con el backoffice) vive en la raíz del repo.
const repoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  reactCompiler: true,
  // "use cache" para la interpretación de búsquedas y los embeddings de consultas.
  cacheComponents: true,
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
        condition: { not: "foreign" },
      },
    },
  },
};

export default nextConfig;
