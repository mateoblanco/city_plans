import path from "node:path";
import type { NextConfig } from "next";
import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";
import { NAMED_CRAWLERS } from "./src/server/seo/indexing";

// /shared (tags y barrios compartidos con el backoffice) vive en la raíz del repo.
const repoRoot = path.join(__dirname, "..");

// Logos en R2: next/image sólo optimiza imágenes del origen de LOGO_BASE_URL.
const logoBase = process.env.LOGO_BASE_URL?.trim().replace(/\/+$/, "");
const logoPatterns = logoBase ? [new URL(`${logoBase}/**`)] : [];

// Metadata bloqueante (título, descripción, canonical en el <head>) para los bots: la lista de Next y los rastreadores de
// LLMs de robots.txt (GPTBot, ClaudeBot, PerplexityBot…, que no ejecutan JS y Next no trae). A los navegadores la
// metadata de una página dinámica les sigue llegando por streaming al final del <body> (no esperan la base para el
// primer byte). Definir htmlLimitedBots reemplaza la lista de Next, por eso se suma a la suya.
// Googlebot NO va: Vercel le sirve el shell del PPR desde la CDN aunque esté en esta lista (x-vercel-cache: HIT), y la
// función, al verlo en la lista, no manda la metadata por streaming: le llegaba la ficha sin <title>, description ni
// canonical. Fuera de la lista recibe la metadata por streaming, como un navegador (Google ejecuta JS).
const HEAD_METADATA_BOTS = [...NAMED_CRAWLERS];
const htmlLimitedBots = new RegExp(
  [HTML_LIMITED_BOT_UA_RE.source, ...HEAD_METADATA_BOTS.map((bot) => bot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))].join("|"),
  "i",
);

const nextConfig: NextConfig = {
  reactCompiler: true,
  htmlLimitedBots,
  // "use cache" para la interpretación de búsquedas y los embeddings de consultas.
  cacheComponents: true,
  // Guías publicadas desde el backoffice, sin webhook: se revalidan cada minuto. Cinco minutos de expire conserva el
  // prerender de Next; una ruta que la caché todavía no conoce se confirma puntualmente contra la base.
  cacheLife: {
    guides: { stale: 30, revalidate: 60, expire: 300 },
  },
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
