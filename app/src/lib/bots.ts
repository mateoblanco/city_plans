// Puro (sin dependencias): lo usa el servidor (eventos, ficha, /api/place-google) y el navegador (el mapa de las guías).
// Crawlers, previsualizadores de links, herramientas de medición y clientes sin navegador. Sin user agent también es bot.
const BOT_PATTERN =
  /bot|crawl|spider|slurp|scrap|headless|lighthouse|pagespeed|chrome-lighthouse|gtmetrix|pingdom|uptime|monitor|preview|facebookexternalhit|embedly|whatsapp\/|vercel-|curl|wget|python|httpclient|http-client|okhttp|axios|node-fetch|undici|go-http|java\/|libwww|phantom|puppeteer|playwright|selenium/i

export const isBot = (userAgent: string | null | undefined) => !userAgent?.trim() || BOT_PATTERN.test(userAgent)
