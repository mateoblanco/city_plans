import type { Guide } from '../types'

/** Guías de prueba (en memoria, sólo para tests): lo que devolvería la base. */
export const testGuide = (overrides: Partial<Guide> & Pick<Guide, 'slug'>): Guide => ({
  id: `id-${overrides.slug}`,
  city: 'montevideo',
  neighborhood: 'CORDON',
  group: 'cafes',
  title: `Guía ${overrides.slug}`,
  seoTitle: overrides.slug,
  seoDescription: overrides.slug,
  intro: ['Intro.'],
  updatedAt: '2026-11-19',
  places: [],
  featured: false,
  color: '#FF8E00',
  draft: false,
  live: true,
  publishedPlaces: overrides.live === false ? 0 : (overrides.places?.length ?? 0),
  ...overrides,
})

const ids = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}`, text: `Texto ${prefix} ${index + 1}` }))

export const CORDON_CAFES = testGuide({ slug: 'cafes-donde-nadie-te-apura', title: 'Cafés donde nadie te apura', featured: true, places: ids('cafe', 4) })
export const CORDON_BEERS = testGuide({ slug: 'cervezas-artesanales', group: 'bars', draft: true, places: ids('beer', 4) })
export const SUSHI_CITY = testGuide({ slug: 'sushi-para-una-cita', title: 'Lugares de sushi para una cita', neighborhood: null, group: 'eat', updatedAt: '2026-11-20', places: ids('sushi', 4) })
/** Cordón llega al mínimo (3 publicadas con página: cafés, tapas y vinos; la de cervezas es borrador): su página existe. */
export const CORDON_TAPAS = testGuide({ slug: 'tapas-en-cordon', group: 'eat', places: ids('tapas', 4) })
export const CORDON_WINES = testGuide({ slug: 'vinos-en-cordon', group: 'bars', updatedAt: '2026-11-18', places: ids('wine', 4) })
/** Pocitos no llega: una con página y una sin lugares publicados. */
export const POCITOS_PIZZA = testGuide({ slug: 'pizzas-en-pocitos', neighborhood: 'POCITOS', group: 'eat', places: ids('pizza', 4) })
/** Publicada, pero sin ningún lugar publicado: no tiene página ni cuenta para el mínimo. */
export const POCITOS_EMPTY = testGuide({ slug: 'brunch-en-pocitos', neighborhood: 'POCITOS', group: 'eat', live: false, places: ids('brunch', 4) })

/** Lo que leería la vista previa: publicadas y borradores. */
export const ALL_GUIDES = [CORDON_CAFES, CORDON_BEERS, SUSHI_CITY, CORDON_TAPAS, CORDON_WINES, POCITOS_PIZZA, POCITOS_EMPTY]
/** Lo que leen las páginas públicas: sólo publicadas. */
export const PUBLISHED_GUIDES = ALL_GUIDES.filter((guide) => !guide.draft)
