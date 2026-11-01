// Hosts y comparaciones de texto de la extracción.

export const BLOCKED_HOSTS = ['google.com', 'goo.gl', 'maps.app.goo.gl', 'corner.inc', 'exa.ai', 'facebook.com', 'foursquare.com']
export const DIRECTORY_HOSTS = ['opina.com.uy', 'linkedin.com', 'tripadvisor', 'restaurantguru', 'yelp.com', 'wanderlog.com', 'saliracomer.com', 'laguiadelociouruguay.com']
// Sistemas de reservas: un link a uno no es la web del local, pero dice que toma reservas.
export const DEFAULT_RESERVATION_HOSTS = ['meitre.com', 'dinnerin', 'tablesapp', 'covermanager', 'resy', 'opentable', 'reserver.pro', 'myrestoo.net', 'setmore.com'] as const
export const LINK_AGGREGATOR_HOSTS = ['linktr.ee', 'beacons.ai', 'solo.to', 'campsite.bio', 'bio.link', 'taplink.cc', 'taplink.at', 'lnk.bio', 'linkin.bio', 'linkr.bio', 'allmylinks.com', 'msha.ke']
// Chats de WhatsApp (wa.me, api., web. y chat.whatsapp.com, whatsapp.com/send, acortadores wa.link): nunca son la web del local.
export const WHATSAPP_HOSTS = ['wa.me', 'whatsapp.com', 'wa.link', 'walink.com', 'whatsapp.link']
export const SOCIAL_HOSTS = ['instagram.com', 'instagr.am', 'facebook.com', 'tiktok.com', 'x.com', 'twitter.com', 'linkedin.com', 'youtube.com', 'threads.net', 'pinterest.com']
// Plataformas donde la página del local es una ruta (una carta publicada como artifact): su home no es la web del local.
export const SHARED_PAGE_HOSTS = ['claude.ai']
// Una página del local en estas plataformas prueba que tiene delivery.
export const DELIVERY_HOSTS = ['rappi.com.uy', 'pedidosya.com.uy']
// Pedidos y cartas online (también los Rappi y PedidosYa de otros países): no son la web del local ni dicen que tenga delivery.
export const ORDERING_HOSTS = ['ambit.la', 'dihola.uy', 'pedidosya.com', 'rappi.com']
// Constructores de sitios: el dominio es de la plataforma (lacantina.webnode.es), no dice de qué país es el local.
export const SITE_BUILDER_HOSTS = ['webnode.es', 'webnode.com', 'webnode.page', 'wixsite.com', 'wordpress.com', 'blogspot.com', 'negocio.site', 'business.site', 'godaddysites.com', 'squarespace.com', 'carrd.co', 'mitiendanube.com']
// Dominios de otros países (".com.br", ".ar"…). ".co" no: lo usan directorios uruguayos (para la web propia sí cuenta).
export const FOREIGN_TLDS = new Set(['br', 'ar', 'cl', 'py', 'pe', 'bo', 'mx', 'es', 'ec', 've', 'ph', 'pt', 'it', 'fr', 'de', 'uk', 'au', 'ca', 'us'])
// Señales de dirección de otro país: ciudades, CEP brasileño o prefijos telefónicos de Brasil y Argentina.
export const FOREIGN_ADDRESS = /\b(?:porto alegre|sao paulo|rio de janeiro|florianopolis|curitiba|buenos aires|santiago de chile|asuncion|chihuahua|ciudad de mexico|cdmx|guadalajara|monterrey|madrid|barcelona|sevilla|bogota|medellin|lima,? peru)\b|\b\d{5}-\d{3}\b|\+\s?5[45]\b/
export const MENTIONS_URUGUAY = /\b(?:uruguay|montevideo)\b/
// Resumen que arma Exa a partir de la búsqueda (que lleva el nombre): no confirma el nombre.
export const EXA_SUMMARY_URL = 'https://exa.ai/'
// Texto de plantilla (SEO armado con los atributos de Google o resúmenes generados): "ambiente informal y acogedor",
// "ideal para grupos", "sillas altas" salen igual en casi todas sus páginas. Medido sobre cache/extractions: opina dice
// "acogedor" en el 78 % de sus páginas, wanderlog en el 25 % y guiacomercial en el 23 %; smartservices es el mismo SEO;
// wanderboat y bocadium, marcadas a mano al revisar el recálculo de tags.
export const TEMPLATE_HOSTS = ['opina.com.uy', 'smartservices.uy', 'guiacomercial.uy', 'wanderlog.com', 'wanderboat.ai', 'bocadium.com']

/** Fuente de baja confianza para lo subjetivo: el resumen de Exa (lo escribe otro modelo) o una de plantilla. */
export function isLowTrustSource(url: string) {
  return url === EXA_SUMMARY_URL || hostedBy(url, TEMPLATE_HOSTS)
}

export function hostname(value: string | null) {
  try { return value ? new URL(value).hostname.toLowerCase().replace(/^www\./, '') : null } catch { return null }
}

/** El host es uno de esos dominios o un subdominio. Un nombre sin punto ("covermanager") vale como parte del host. */
export function hostedBy(value: string | null, hosts: readonly string[]) {
  const host = hostname(value)
  return Boolean(host && hosts.some((item) => host === item || host.endsWith(`.${item}`) || (!item.includes('.') && host.split('.').includes(item))))
}

/** Un directorio o un buscador (Tripadvisor, Google Maps…): la página del local ahí no es su web. */
export function isDirectoryHost(value: string | null) {
  const host = hostname(value)
  if (!host) return false
  return host.split('.').includes('tripadvisor') || [...BLOCKED_HOSTS, ...DIRECTORY_HOSTS]
    .some((directory) => host === directory || host.endsWith(`.${directory}`) || host.split('.').includes(directory))
}

export function canonical(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** La frase aparece entera en el texto, sin acentos ni puntuación. */
export function hasPhrase(text: string, phrase: string) {
  const words = (value: string) => canonical(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  const haystack = ` ${words(text)} `
  const needle = words(phrase)
  return needle.length > 1 && haystack.includes(` ${needle} `)
}

/** El dominio lleva el nombre del lugar: es su web propia. */
export function matchesPlaceDomain(host: string, name: string): boolean {
  const hostValue = canonical(host).replace(/[^a-z0-9]/g, '')
  const nameValue = canonical(name).replace(/[^a-z0-9]/g, '')
  if (nameValue.length >= 5 && hostValue.includes(nameValue)) return true
  const words = canonical(name).split(/[^a-z0-9]+/).filter((word) => word.length >= 4)
  return words.length > 0 && words.every((word) => hostValue.includes(word))
}
