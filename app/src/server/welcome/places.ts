import { label } from '@shared/tags.ts'
import type { IconCategory } from '@shared/icon-categories.ts'
import { logoUrl } from '../search/logo'
import { placeKind } from '../search/personal'

/** Lo que trae la base para la bienvenida: lo de la card compacta más lo que usa el sorteo (tipo y barrio). */
export type WelcomeRow = {
  id: string
  name: string
  neighborhoodId: string
  categories: string[]
  iconCategory: IconCategory | null
  logoKey: string | null
  logoBgColor: string | null
}

/** La card del paso "Elegí hasta 3 lugares": logo, nombre y tipo (la categoría principal). Lo importa el cliente (sólo el tipo). */
export type WelcomePlace = { id: string; name: string; logoUrl: string | null; logoBgColor: string | null; type: string | null }

/** El tipo para variar la grilla (cafés, bares, para comer, postres); sin tipo, aparte. */
export const welcomeKind = (row: WelcomeRow): string => placeKind(row) ?? 'other'

export function welcomePlace(row: WelcomeRow): WelcomePlace {
  const category = row.categories[0]
  return { id: row.id, name: row.name, logoUrl: logoUrl(row.logoKey), logoBgColor: row.logoBgColor, type: category ? label(category, 'es') : null }
}
