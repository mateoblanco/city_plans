// Validación de la web propia de un local: ni WhatsApp, agregador de links, red social, reservas, pedidos, plataforma
// compartida o directorio (por el host), ni una web de otro país (por el dominio o por el texto scrapeado).
import { findPhoneNumbersInText } from 'libphonenumber-js/max'
import {
  DEFAULT_RESERVATION_HOSTS, DELIVERY_HOSTS, FOREIGN_ADDRESS, FOREIGN_TLDS, LINK_AGGREGATOR_HOSTS, MENTIONS_URUGUAY, ORDERING_HOSTS,
  SHARED_PAGE_HOSTS, SITE_BUILDER_HOSTS, SOCIAL_HOSTS, WHATSAPP_HOSTS, canonical, hostedBy, hostname, isDirectoryHost,
} from './source-hosts.ts'

export type WebsiteRejectionReason =
  | 'whatsapp' | 'link_aggregator' | 'social' | 'reservations' | 'ordering' | 'shared_page' | 'directory' | 'foreign_domain' | 'foreign_content'

export const WEBSITE_REJECTION_LABELS: Record<WebsiteRejectionReason, string> = {
  whatsapp: 'link de WhatsApp',
  link_aggregator: 'agregador de links',
  social: 'red social',
  reservations: 'sistema de reservas',
  ordering: 'sistema de pedidos',
  shared_page: 'página en una plataforma compartida',
  directory: 'directorio',
  foreign_domain: 'dominio de otro país',
  foreign_content: 'web de otro país',
}

export type WebsiteRejection = { reason: WebsiteRejectionReason; detail: string }

// Para la web propia también cuenta ".co" (en las fuentes no, por los directorios uruguayos).
const WEBSITE_FOREIGN_TLDS = new Set([...FOREIGN_TLDS, 'co'])
// Precios en otra moneda. "$" solo no: es el peso uruguayo.
const FOREIGN_CURRENCY = /€|\b(?:eur|euros?|mxn|ars|cop|clp|brl|pen)\b|r\$\s?\d|\bs\/\s?\d|\bpesos (?:mexicanos|argentinos|colombianos|chilenos)\b/

/** Motivo por el que el host no puede ser la web del local, o null. */
export function websiteHostRejection(url: string, reservationHosts: readonly string[] = DEFAULT_RESERVATION_HOSTS): WebsiteRejection | null {
  const host = hostname(url) ?? url
  const checks: [WebsiteRejectionReason, readonly string[]][] = [
    ['whatsapp', WHATSAPP_HOSTS],
    ['link_aggregator', LINK_AGGREGATOR_HOSTS],
    ['social', SOCIAL_HOSTS],
    ['reservations', reservationHosts],
    ['ordering', [...ORDERING_HOSTS, ...DELIVERY_HOSTS]],
    ['shared_page', SHARED_PAGE_HOSTS],
  ]
  for (const [reason, hosts] of checks) if (hostedBy(url, hosts)) return { reason, detail: host }
  return isDirectoryHost(url) ? { reason: 'directory', detail: host } : null
}

/** TLD de otro país, salvo en un constructor de sitios (webnode.es), donde el dominio es de la plataforma. */
export function foreignWebsiteTld(url: string): string | null {
  const host = hostname(url)
  const tld = host?.split('.').at(-1)
  return tld && WEBSITE_FOREIGN_TLDS.has(tld) && !hostedBy(url, SITE_BUILDER_HOSTS) ? tld : null
}

/** Señal de otro país en el texto: precios en otra moneda, un teléfono con prefijo de otro país o una ciudad de otro país. */
export function foreignContentSignal(text: string): string | null {
  const normalized = canonical(text)
  const currency = normalized.match(FOREIGN_CURRENCY)
  if (currency) return `precios en ${currency[0].trim()}`
  // Sin país por defecto, libphonenumber sólo encuentra números con prefijo internacional.
  const phone = findPhoneNumbersInText(text).find(({ number }) => number.country && number.country !== 'UY')
  if (phone) return `teléfono ${phone.number.formatInternational()}`
  const address = normalized.match(FOREIGN_ADDRESS)
  return address ? `dirección o teléfono de ${address[0].trim()}` : null
}

/**
 * Motivo por el que la URL no es la web del local, o null. `texts` es el texto scrapeado de esa web (del mismo host):
 * un dominio de otro país, o precios, teléfonos o direcciones de otro país, la descartan salvo que mencione Montevideo
 * o Uruguay.
 */
export function websiteRejection(url: string, texts: readonly string[] = [], reservationHosts: readonly string[] = DEFAULT_RESERVATION_HOSTS): WebsiteRejection | null {
  const byHost = websiteHostRejection(url, reservationHosts)
  if (byHost) return byHost
  const text = texts.join('\n')
  if (MENTIONS_URUGUAY.test(canonical(text))) return null
  const tld = foreignWebsiteTld(url)
  if (tld) return { reason: 'foreign_domain', detail: `.${tld}` }
  const signal = foreignContentSignal(text)
  return signal ? { reason: 'foreign_content', detail: signal } : null
}

/** "sistema de reservas (setmore.com)". El borrador guarda el motivo como string: uno desconocido se muestra tal cual. */
export function websiteRejectionLabel(rejection: { reason: string; detail: string }): string {
  return `${WEBSITE_REJECTION_LABELS[rejection.reason as WebsiteRejectionReason] ?? rejection.reason} (${rejection.detail})`
}
