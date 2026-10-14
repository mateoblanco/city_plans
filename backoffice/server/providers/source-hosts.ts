// Hosts y comparaciones de texto que comparten la extracción y la clasificación editorial.

export const BLOCKED_HOSTS = ['google.com', 'goo.gl', 'maps.app.goo.gl', 'corner.inc', 'exa.ai', 'facebook.com', 'foursquare.com']
export const DIRECTORY_HOSTS = ['opina.com.uy', 'linkedin.com', 'tripadvisor', 'restaurantguru', 'yelp.com', 'wanderlog.com', 'saliracomer.com', 'laguiadelociouruguay.com']
export const DEFAULT_RESERVATION_HOSTS = ['meitre.com', 'dinnerin', 'tablesapp', 'covermanager', 'resy', 'opentable'] as const
export const LINK_AGGREGATOR_HOSTS = ['linktr.ee', 'beacons.ai', 'solo.to', 'campsite.bio']
// Una página del local en estas plataformas prueba que tiene delivery.
export const DELIVERY_HOSTS = ['rappi.com.uy', 'pedidosya.com.uy']
// Resumen que arma Exa a partir de la búsqueda (que lleva el nombre): no confirma el nombre.
export const EXA_SUMMARY_URL = 'https://exa.ai/'

export function hostname(value: string | null) {
  try { return value ? new URL(value).hostname.toLowerCase().replace(/^www\./, '') : null } catch { return null }
}

export function hostedBy(value: string | null, hosts: readonly string[]) {
  const host = hostname(value)
  return Boolean(host && hosts.some((item) => host === item || host.endsWith(`.${item}`)))
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
