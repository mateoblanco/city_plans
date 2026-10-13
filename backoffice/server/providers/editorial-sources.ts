import {
  BLOCKED_HOSTS,
  DEFAULT_RESERVATION_HOSTS,
  DELIVERY_HOSTS,
  DIRECTORY_HOSTS,
  EXA_SUMMARY_URL,
  LINK_AGGREGATOR_HOSTS,
  canonical,
  hasPhrase,
  hostedBy,
  hostname,
  matchesPlaceDomain,
} from './source-hosts.ts'

// Prensa y guías gastronómicas conocidas: cuentan siempre que nombren al lugar.
export const EDITORIAL_HOSTS = [
  'elpais.com.uy', 'montevideo.com.uy', 'ladiaria.com.uy', 'elobservador.com.uy', 'busqueda.com.uy',
  'carasycaretas.com.uy', 'subrayado.com.uy', 'telemundo.com.uy', 'teledoce.com', 'canal10.com.uy',
  'lared21.com.uy', 'brecha.com.uy', 'ecos.la', 'sudestada.com.uy', 'quepensas.com.uy',
  'infobae.com', 'lanacion.com.ar', 'clarin.com', 'cntraveler.com', 'timeout.com', 'eater.com',
  'nytimes.com', 'theguardian.com', 'theworlds50best.com', 'guide.michelin.com',
  'alacarta.com.uy', 'telenoche.com.uy', 'admagazine.com',
]

// Directorios, guías comerciales, delivery, reservas, redes y agregadores: nunca son menciones editoriales.
export const NON_EDITORIAL_HOSTS = [
  ...BLOCKED_HOSTS, ...DIRECTORY_HOSTS, ...DELIVERY_HOSTS, ...DEFAULT_RESERVATION_HOSTS, ...LINK_AGGREGATOR_HOSTS,
  'ubereats.com', 'mercadolibre.com.uy', 'paginasamarillas.com.uy', 'guiamovil.com', 'booking.com', 'airbnb.com',
  'instagram.com', 'tiktok.com', 'youtube.com', 'x.com', 'twitter.com', 'wikipedia.org', 'mapcarta.com', 'cylex.com.uy',
  // Agregadores y directorios con "reseñas" o "los mejores" en su plantilla.
  '1122.com.uy', 'guiacomercial.uy', 'smartservices.uy', 'bocadium.com', 'salimos.club', 'carta.menu', 'sluurpy.com',
  'glartent.com', 'wanderboat.ai', 'triptap.com', 'happycow.net', 'yorugupino.com', 'planetauruguay.com', 'moovitapp.com',
  'waze.com', 'mapquest.com',
  // Sitios de gobierno (Intendencia, ministerios): no son prensa.
  'gub.uy',
]

// En un host desconocido, alguna de estas palabras en el host, la ruta o el título lo hace editorial.
// Nunca en el texto: la plantilla de directorios y agregadores trae "reseñas", "los mejores", "blog"…
const EDITORIAL_KEYWORDS = /\b(?:blog|resena|resenas|critica gastronomica|probamos|fuimos a|visitamos|recomendados|recomendaciones|donde comer|los mejores|las mejores|guia gastronomica|food ?blog|gastronomia|gastronomica|nota|notas|noticias|cronica|entrevista|revista)\b/
// Ranking o premio en el título o la ruta de una fuente editorial; tampoco en el texto.
const LISTED_OR_AWARDED = /\b(?:los|las) (?:\d+ )?mejores\b|\btop ?\d+\b|\bdonde comer\b|\bimperdibles?\b|\branking\b|\bpremi(?:o|os|ado|ada|ados|adas)\b|\bgalardon\w*|\bganador(?:a|es|as)?\b|\b50 best\b|\bmichelin\b|\brepsol\b/

// Segundos niveles genéricos de los ccTLD: montevideo.com.uy y no com.uy.
const GENERIC_SECOND_LEVEL = new Set(['com', 'org', 'net', 'gub', 'edu', 'gov', 'co', 'mil'])

/** Dominio registrable: sin www ni subdominios (galeria.busqueda.com.uy → busqueda.com.uy). */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.')
  const keep = labels.length >= 3 && labels.at(-1)!.length === 2 && GENERIC_SECOND_LEVEL.has(labels.at(-2)!) ? 3 : 2
  return labels.slice(-keep).join('.')
}

export type EditorialSource = { url: string; title?: string; text: string }
export type EditorialContext = { brand: string; websiteUrl?: string | null }
export type EditorialSignals = { editorialMentions: number; listedOrAwarded: boolean; editorialHosts: string[] }

const words = (value: string) => ` ${canonical(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `

/**
 * Título de la nota sin el nombre del sitio: lo que va antes del primer " - ", " | " o " — ".
 * Muchos sitios repiten un sufijo en todas sus páginas ("… - A La Carta - Donde comer bien en Montevideo").
 */
export function articleTitle(title: string | undefined) {
  return (title ?? '').split(/\s+[-|–—]\s+/)[0]
}

function urlPath(url: string) {
  try { return decodeURIComponent(new URL(url).pathname) } catch { return '' }
}

/** Web propia del lugar: la web conocida o un dominio con la marca. */
function isOfficial(host: string, context: EditorialContext) {
  const website = hostname(context.websiteUrl ?? null)
  return (website && registrableDomain(website) === registrableDomain(host)) || matchesPlaceDomain(host, context.brand)
}

/** Fuente editorial (prensa, blog o guía gastronómica) que nombra al lugar. Sin LLM: dominios y palabras clave del título o la URL. */
export function isEditorialSource(source: EditorialSource, context: EditorialContext): boolean {
  if (source.url === EXA_SUMMARY_URL) return false
  const host = hostname(source.url)
  if (!host || hostedBy(source.url, NON_EDITORIAL_HOSTS) || host.split('.').includes('tripadvisor')) return false
  if (isOfficial(host, context)) return false
  if (!hasPhrase(`${source.title ?? ''}\n${source.text}`, context.brand)) return false
  if (hostedBy(source.url, EDITORIAL_HOSTS)) return true
  return EDITORIAL_KEYWORDS.test(words(`${host} ${urlPath(source.url)} ${articleTitle(source.title)}`))
}

/** Menciones editoriales (un dominio cuenta una vez) y si alguna es un ranking o un premio. */
export function editorialSignals(sources: EditorialSource[], context: EditorialContext): EditorialSignals {
  const hosts = new Set<string>()
  let listedOrAwarded = false
  for (const source of sources) {
    if (!isEditorialSource(source, context)) continue
    hosts.add(registrableDomain(hostname(source.url)!))
    if (LISTED_OR_AWARDED.test(words(`${urlPath(source.url)} ${articleTitle(source.title)}`))) listedOrAwarded = true
  }
  return { editorialMentions: hosts.size, listedOrAwarded, editorialHosts: [...hosts] }
}
