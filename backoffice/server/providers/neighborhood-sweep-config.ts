import type { FoodPlaceType } from '../../src/data/food-place-types.ts'
import type { CategoryId } from '../../src/data/tags.ts'

export type SweepTypeConfig = {
  googleType: FoodPlaceType
  seedCategory: CategoryId
  queries: readonly string[]
}

// Configuración editable del barrido por barrio. Cada consulta se corre con
// includedType del tipo y strictTypeFiltering: true.
export const SWEEP_TYPES: readonly SweepTypeConfig[] = [
  { googleType: 'restaurant', seedCategory: 'restaurant', queries: ['restaurante', 'comida'] },
  { googleType: 'cafe', seedCategory: 'cafe', queries: ['café', 'cafetería'] },
  { googleType: 'coffee_shop', seedCategory: 'cafe', queries: ['café de especialidad'] },
  { googleType: 'bar', seedCategory: 'bar', queries: ['bar', 'tragos'] },
  { googleType: 'pub', seedCategory: 'bar', queries: ['pub', 'cervecería'] },
  { googleType: 'wine_bar', seedCategory: 'wine_bar', queries: ['vinoteca', 'wine bar'] },
  { googleType: 'bakery', seedCategory: 'bakery', queries: ['panadería', 'confitería'] },
  { googleType: 'ice_cream_shop', seedCategory: 'ice_cream_shop', queries: ['heladería'] },
  { googleType: 'steak_house', seedCategory: 'grill', queries: ['parrilla'] },
  { googleType: 'pizza_restaurant', seedCategory: 'pizzeria', queries: ['pizzería'] },
]

// Filtro previo al pipeline (sólo modo completo). Se evalúa con businessStatus, primaryType y reseñas.
// Orden: cerrado → rejected; REJECT → rejected; REVIEW → review (review_type:<tipo>);
// ACCEPT (lista o sufijo) → accepted, o review por pocas reseñas (few_reviews);
// cualquier otro → review (unknown_type:<tipo>). El primaryType manda: los types secundarios no cuentan.
export const MIN_REVIEWS_TO_ACCEPT = 10

export const REJECTED_BUSINESS_STATUSES: readonly string[] = ['CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY']

export const ACCEPT_PRIMARY_TYPES: readonly string[] = [
  'restaurant',
  'steak_house',
  'cafe',
  'coffee_shop',
  'cafeteria',
  'bar',
  'pub',
  'wine_bar',
  'cocktail_bar',
  'brewery',
  'brewpub',
  'gastropub',
  'bar_and_grill',
  'lounge_bar',
  'snack_bar',
  'ice_cream_shop',
  'diner',
  'bistro',
  'tea_house',
  'juice_shop',
  'dessert_shop',
  'sandwich_shop',
  'food_court',
]

// Subtipos de comida de Google: pizza_restaurant, sushi_restaurant, etc.
export const ACCEPT_PRIMARY_TYPE_SUFFIXES: readonly string[] = ['_restaurant']

// Tipos de comida que siempre van a revisión manual aunque sean de comida.
export const REVIEW_PRIMARY_TYPES: readonly string[] = [
  'bakery',
  'meal_takeaway',
  'chocolate_shop',
  'food_store',
  'confectionery',
  'deli',
]

export const REJECT_PRIMARY_TYPES: readonly string[] = [
  'supermarket',
  'grocery_store',
  'convenience_store',
  'gas_station',
  'hotel',
  'lodging',
  'catering_service',
  'food_delivery',
  'store',
  'liquor_store',
  'indoor_playground',
  'gym',
  'school',
  'night_club',
]

// Consultas de rescate: sólo para celdas mínimas que siguen saturadas.
export const RESCUE_TYPE: FoodPlaceType = 'restaurant'
export const RESCUE_SEED_CATEGORY: CategoryId = 'restaurant'
export const RESCUE_QUERIES: readonly string[] = [
  'parrilla',
  'pizzería',
  'sushi',
  'hamburguesas',
  'chivitos',
  'pastas',
  'comida vegana',
  'empanadas',
  'minutas',
  'comida árabe',
  'comida peruana',
  'comida mexicana',
]

// Text Search devuelve como máximo 60 resultados por consulta, pero cerca del tope las cantidades
// varían entre corridas. Dividir desde 40 deja margen y hace los conteos más estables.
export const SUBDIVIDE_THRESHOLD = 40
export const MAX_PAGES_PER_QUERY = 3
export const PAGE_SIZE = 20
export const MIN_CELL_METERS = 150
export const CALL_DELAY_MS = 300
// Pausa antes de reintentar una página intermedia (nextPageToken) que falló tras los reintentos normales.
export const PAGE_RETRY_DELAY_MS = 2000
export const MAX_RETRIES = 3
export const DEFAULT_MAX_CALLS = 1500
