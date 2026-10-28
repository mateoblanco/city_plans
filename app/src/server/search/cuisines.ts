import { CUISINES, withSubcuisines } from '@shared/tags.ts'
import type { IconCategory } from '@shared/icon-categories.ts'
import type { CandidateRow } from './candidates'

// Ícono (shared/icon-categories.ts) de un lugar cuya cocina principal es esta. Sin ícono propio, sólo cuenta signature.
const CUISINE_ICONS: Partial<Record<keyof typeof CUISINES, IconCategory[]>> = {
  japanese: ['sushi', 'ramen'],
  nikkei: ['sushi', 'fish'],
  chinese: ['wok', 'dumplings'],
  asian: ['ramen', 'wok', 'dumplings'],
  peruvian: ['fish'],
  mexican: ['taco', 'burrito', 'tamale'],
  venezuelan: ['tamale'],
  latin_american: ['tamale'],
  middle_eastern: ['falafel', 'kebab'],
  indian: ['curry'],
  spanish: ['tapas', 'octopus'],
  mediterranean: ['octopus'],
  italian: ['pasta', 'pizza'],
  uruguayan: ['grill', 'meat', 'sandwich'],
}

/** Cocinas pedidas (de los tags de must y prefer). */
export function requestedCuisines(tags: string[]): string[] {
  return [...new Set(tags.filter((id) => Object.hasOwn(CUISINES, id)))]
}

/**
 * La cocina (o una de sus hijas, si es paraguas) es la principal del lugar: está en signature o su ícono es de ella. Con
 * el tag solo, por un par de platos, es secundaria.
 */
export function isMainCuisine(row: Pick<CandidateRow, 'signature' | 'iconCategory'>, id: string): boolean {
  return withSubcuisines(id).some((cuisine) =>
    row.signature.includes(cuisine) || (row.iconCategory !== null && (CUISINE_ICONS[cuisine as keyof typeof CUISINES] ?? []).includes(row.iconCategory)))
}
