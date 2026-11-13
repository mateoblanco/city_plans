import { searchHref } from '@/components/pages/SearchPage/utils/search-href'
import { choiceKey, parseChoice, providerName, selectedProviders, type DiscountChoice } from '../discounts/selection'
import { runSearch, type SearchDeps } from '../search/search'
import type { HomeRow } from './assemble'
import { HOME_CONFIG } from './config'
import { openResults } from './rows'

/** Prefijo del id de estas filas (`discount:itau`): HomeSections las cuenta como personales. */
export const DISCOUNT_ROW_PREFIX = 'discount:'

export const discountRowTitle = (name: string) => `Descuentos con ${name}`

/** El `f` de la fila: "Abre hoy" (como las demás filas de la home) y los tipos elegidos de ese proveedor. */
const rowFilters = (choices: DiscountChoice[]) => ['open:today', ...choices.map((choice) => `discount:${choiceKey(choice)}`)].join(',')

/**
 * "Descuentos con <Banco>": una fila por proveedor de mis tarjetas (la cookie `cards`, ya validada), en el orden de la
 * config, con los lugares que tienen descuento con los tipos elegidos (un beneficio "cualquier tarjeta" cuenta para
 * débito y crédito: lo resuelve el filtro). La búsqueda vacía con el filtro (sólo SQL), como las filas del config;
 * href es su "Ver todos" con los mismos parámetros. Sin caché: dependen de las tarjetas de cada persona. Pasan por
 * assembleHome (mínimo, sin cadenas, sin repetir). Si falla la de un proveedor, las demás salen igual.
 */
export async function homeDiscountRows(deps: SearchDeps, cards: string[], now?: Date): Promise<HomeRow[]> {
  const choices = cards.flatMap((key) => parseChoice(key) ?? [])
  const rows = await Promise.all(
    selectedProviders(choices).map(async (provider): Promise<HomeRow | null> => {
      const filters = rowFilters(choices.filter((choice) => choice.provider === provider))
      try {
        const response = await runSearch('', deps, { filters, now })
        return {
          id: `${DISCOUNT_ROW_PREFIX}${provider}`,
          title: discountRowTitle(providerName(provider)),
          places: openResults(response).slice(0, HOME_CONFIG.candidates),
          href: searchHref({ q: '', f: filters }),
        }
      } catch (error) {
        console.error(`Falló "Descuentos con ${providerName(provider)}" de la home`, error)
        return null
      }
    }),
  )
  return rows.flatMap((row) => row ?? [])
}
