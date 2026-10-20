import { z } from 'zod'
import { CATEGORIES, DIETARY, TAG_IDS, isOccasionTag, isStyleId, normalize, type StyleId } from '@shared/tags.ts'
import { resolveNeighborhood } from '@shared/neighborhood-aliases.ts'
import { isIntentId, type IntentId } from '@shared/intents.ts'
import { canonicalOf } from './dishes'

export const PRICES = ['low', 'moderate', 'high', 'very_high'] as const
export type Price = (typeof PRICES)[number]
export const DIET_KEYS = ['vegan', 'vegetarian', 'glutenFree'] as const
export type DietKey = (typeof DIET_KEYS)[number]
export type Lang = 'es' | 'en'

/** "now", o un día (0 = domingo; null = hoy) y una hora HH:MM (null = en algún momento de ese día). */
export type OpenAt = 'now' | { day: number | null; time: string | null } | null

/** Un plato pedido y los tags o categorías que lo representan si ningún lugar lo tiene (ceviche → peruvian, seafood). */
export type Dish = { name: string; relatedTags: string[]; relatedCategories: string[] }

export type Interpretation = {
  nameQuery: string | null
  must: {
    categories: string[]
    tags: string[]
    diet: Partial<Record<DietKey, boolean>>
    neighborhoods: string[]
    price: Price[]
    openAt: OpenAt
  }
  /** style: estilo pedido ("de barrio" → casual); como los momentos, siempre preferencia. */
  prefer: { categories: string[]; tags: string[]; style: StyleId | null }
  exclude: { categories: string[]; tags: string[] }
  dishes: Dish[]
  vibe: string | null
  language: Lang
  unrecognized: string[]
  needsLocation: boolean
  /** Pide lo mejor ("el mejor chivito", "best coffee"): amplía el multiplicador de calidad. No es filtro ni chip. */
  wantsBest: boolean
  /** Intención pedida con un verbo ("comer", "tomar algo"): vota por ella como un tag; no es filtro por sí misma. */
  intent: IntentId | null
}

export function emptyInterpretation(language: Lang = 'es'): Interpretation {
  return {
    nameQuery: null,
    must: { categories: [], tags: [], diet: {}, neighborhoods: [], price: [], openAt: null },
    prefer: { categories: [], tags: [], style: null },
    exclude: { categories: [], tags: [] },
    dishes: [],
    vibe: null,
    language,
    unrecognized: [],
    needsLocation: false,
    wantsBest: false,
    intent: null,
  }
}

// Lo que devuelve el modelo: strings simples, sin enums, para que la gramática no crezca.
export const LlmInterpretationSchema = z.object({
  nameQuery: z.string().nullable(),
  must: z.object({
    categories: z.array(z.string()),
    tags: z.array(z.string()),
    diet: z.object({ vegan: z.boolean(), vegetarian: z.boolean(), glutenFree: z.boolean() }),
    neighborhoods: z.array(z.string()),
    price: z.array(z.string()),
    openAt: z.object({ now: z.boolean(), day: z.number().int().nullable(), time: z.string().nullable() }).nullable(),
  }),
  prefer: z.object({ categories: z.array(z.string()), tags: z.array(z.string()) }),
  exclude: z.object({ categories: z.array(z.string()), tags: z.array(z.string()) }),
  dishes: z.array(z.object({ name: z.string(), related: z.array(z.string()) })),
  vibe: z.string().nullable(),
  language: z.string(),
  unrecognized: z.array(z.string()),
  wantsBest: z.boolean(),
  intent: z.string().nullable(),
})
export type LlmInterpretation = z.infer<typeof LlmInterpretationSchema>

const TAG_ID_SET = new Set<string>(TAG_IDS)
const DIET_BY_TAG: Record<string, DietKey> = { vegan: 'vegan', vegetarian: 'vegetarian', gluten_free: 'glutenFree' }

export type Term = { kind: 'category' | 'tag'; id: string } | { kind: 'diet'; key: DietKey } | { kind: 'style'; id: StyleId }

/** Id válido de tags.ts para lo que mandó el modelo o escribió la persona (id, label o sinónimo). */
export function classifyTerm(raw: string): Term | null {
  const value = raw.trim()
  if (value in CATEGORIES) return { kind: 'category', id: value }
  if (value in DIETARY) return { kind: 'diet', key: DIET_BY_TAG[value] }
  if (TAG_ID_SET.has(value)) return { kind: 'tag', id: value }
  if (isStyleId(value)) return { kind: 'style', id: value }
  const found = canonicalOf(normalize(value.replace(/_/g, ' ')))
  // Un plato típico ("tacos") no es un tag: va como plato, no como filtro de cocina.
  if (!found || found.dish) return null
  if (found.group === 'categories') return { kind: 'category', id: found.id }
  if (found.group === 'style' && isStyleId(found.id)) return { kind: 'style', id: found.id }
  if (found.group === 'dietary') return { kind: 'diet', key: DIET_BY_TAG[found.id] }
  return TAG_ID_SET.has(found.id) ? { kind: 'tag', id: found.id } : null
}

const NEAR_ME = /\b(cerca (mio|mia|de mi|de aca|de aqui)|near (me|here)|nearby|por aca|alrededor mio)\b/

export function mentionsNearMe(text: string) {
  return NEAR_ME.test(normalize(text))
}

/** Palabras que piden lo mejor, en es/en. */
export const BEST_WORDS = new Map<string, 'es' | 'en' | null>([['mejor', 'es'], ['mejores', 'es'], ['best', 'en'], ['top', null]])
const BEST = new RegExp(`\\b(${[...BEST_WORDS.keys()].join('|')})\\b`)

export function mentionsBest(text: string) {
  return BEST.test(normalize(text))
}

/** Una parte que sólo pide lo mejor ("el mejor", "the best"): no es algo sin reconocer. */
const onlyBest = (text: string) => normalize(text).split(' ').every((word) => BEST_WORDS.has(word) || ['el', 'la', 'los', 'las', 'lo', 'the'].includes(word))

const unique = <T,>(values: T[]) => [...new Set(values)]

function normalizeTime(raw: string | null): string | null {
  const match = raw?.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(h|hs)?$/i)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2] ?? 0)
  if (hours > 24 || minutes > 59) return null
  return `${String(hours % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function validOpenAt(raw: LlmInterpretation['must']['openAt']): OpenAt {
  if (!raw) return null
  if (raw.now) return 'now'
  const day = raw.day !== null && Number.isInteger(raw.day) && raw.day >= 0 && raw.day <= 6 ? raw.day : null
  const time = normalizeTime(raw.time)
  return day === null && time === null ? null : { day, time }
}

/** toPrefer: momentos que el modelo puso como requisito y pasaron a preferencia (`tag:groups`). */
export type Validation = { interpretation: Interpretation; discarded: string[]; toPrefer: string[] }

/** Se queda sólo con ids de tags.ts y barrios conocidos; lo demás se descarta (y se informa en debug). */
export function validateInterpretation(raw: LlmInterpretation): Validation {
  const discarded: string[] = []
  const toPrefer: string[] = []
  const result = emptyInterpretation(raw.language?.trim().toLowerCase().startsWith('en') ? 'en' : 'es')

  // El style va siempre a preferencias, venga de must o de prefer; excluir un estilo no existe.
  const sortTerms = (values: string[], into: { categories: string[]; tags: string[] }, diet?: Interpretation['must']['diet'], styleAllowed = true) => {
    for (const value of values) {
      const term = classifyTerm(value)
      if (!term) discarded.push(value)
      else if (term.kind === 'style') {
        if (styleAllowed) result.prefer.style ??= term.id
        else discarded.push(value)
      } else if (term.kind === 'diet') {
        if (diet) diet[term.key] = true
        else discarded.push(value)
      } else (term.kind === 'category' ? into.categories : into.tags).push(term.id)
    }
  }

  sortTerms([...raw.must.categories, ...raw.must.tags], result.must, result.must.diet)
  sortTerms([...raw.prefer.categories, ...raw.prefer.tags], result.prefer)
  sortTerms([...raw.exclude.categories, ...raw.exclude.tags], result.exclude, undefined, false)
  // Los momentos (con amigos, cita…) nunca filtran: si el modelo los exigió, pasan a preferencia.
  for (const id of result.must.tags.filter(isOccasionTag)) {
    result.must.tags = result.must.tags.filter((item) => item !== id)
    result.prefer.tags.push(id)
    toPrefer.push(`tag:${id}`)
  }
  for (const key of DIET_KEYS) if (raw.must.diet[key]) result.must.diet[key] = true

  for (const value of raw.must.neighborhoods) {
    const id = resolveNeighborhood(value)
    if (id) result.must.neighborhoods.push(id)
    else discarded.push(value)
  }
  for (const value of raw.must.price) {
    const price = value.trim().toLowerCase() as Price
    if (PRICES.includes(price)) result.must.price.push(price)
    else discarded.push(value)
  }
  result.must.openAt = validOpenAt(raw.must.openAt)

  result.nameQuery = raw.nameQuery?.trim() || null
  for (const dish of raw.dishes) {
    const name = dish.name.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!name) continue
    const related = { categories: [] as string[], tags: [] as string[] }
    sortTerms(dish.related, related)
    result.dishes.push({ name, relatedTags: related.tags, relatedCategories: related.categories })
  }
  result.vibe = raw.vibe?.trim() || null
  result.unrecognized = raw.unrecognized.map((part) => part.trim()).filter((part) => part && !onlyBest(part))
  result.needsLocation = result.unrecognized.some(mentionsNearMe)
  result.wantsBest = raw.wantsBest === true
  // Una interpretación cacheada de antes del campo no lo trae.
  const intent = raw.intent?.trim() ?? ''
  result.intent = isIntentId(intent) ? intent : null
  if (intent && !result.intent) discarded.push(`intent:${intent}`)

  return { interpretation: tidy(result), discarded, toPrefer }
}

/** Sin repetidos; lo excluido o exigido no aparece también como preferencia. */
export function tidy(value: Interpretation): Interpretation {
  const exclude = { categories: unique(value.exclude.categories), tags: unique(value.exclude.tags) }
  const must = {
    ...value.must,
    categories: unique(value.must.categories).filter((id) => !exclude.categories.includes(id)),
    tags: unique(value.must.tags).filter((id) => !exclude.tags.includes(id)),
    neighborhoods: unique(value.must.neighborhoods),
    price: unique(value.must.price),
  }
  // Los momentos nunca son requisito; "elegante" también pide un lugar cuidado.
  const occasions = must.tags.filter(isOccasionTag)
  must.tags = must.tags.filter((id) => !isOccasionTag(id))
  const preferTags = unique([...value.prefer.tags, ...occasions])
  const prefer = {
    categories: unique(value.prefer.categories).filter((id) => !must.categories.includes(id) && !exclude.categories.includes(id)),
    tags: preferTags.filter((id) => !must.tags.includes(id) && !exclude.tags.includes(id)),
    style: value.prefer.style ?? (preferTags.includes('elegant') || must.tags.includes('elegant') ? 'cuidado' : null),
  }
  const dishes = new Map<string, Dish>()
  for (const dish of value.dishes) {
    const key = normalize(dish.name)
    const seen = dishes.get(key)
    dishes.set(key, {
      name: seen?.name ?? dish.name,
      relatedTags: unique([...(seen?.relatedTags ?? []), ...dish.relatedTags]),
      relatedCategories: unique([...(seen?.relatedCategories ?? []), ...dish.relatedCategories]),
    })
  }
  return { ...value, must, prefer, exclude, dishes: [...dishes.values()] }
}

export const REMOVABLE_KINDS = ['name', 'category', 'tag', 'prefer', 'exclude', 'diet', 'neighborhood', 'price', 'openAt', 'dish', 'vibe', 'near', 'intent'] as const
export type ChipKind = (typeof REMOVABLE_KINDS)[number]

/** Parsea `remove=tag:terrace,neighborhood:POCITOS`; ignora lo que no tenga forma kind:id. */
export function parseRemove(raw: string | null | undefined): { kind: ChipKind; id: string }[] {
  if (!raw) return []
  return raw.split(',').flatMap((part) => {
    const index = part.indexOf(':')
    if (index <= 0) return []
    const kind = part.slice(0, index).trim() as ChipKind
    const id = part.slice(index + 1).trim()
    return REMOVABLE_KINDS.includes(kind) && id ? [{ kind, id }] : []
  })
}

/** Saca de la interpretación lo que la persona quitó de los chips, sin volver a interpretar. */
export function applyRemove(value: Interpretation, removals: { kind: ChipKind; id: string }[]): Interpretation {
  const next: Interpretation = structuredClone(value)
  const sameDish = (a: string, b: string) => normalize(a) === normalize(b)
  for (const { kind, id } of removals) {
    if (kind === 'name') next.nameQuery = null
    else if (kind === 'vibe') next.vibe = null
    else if (kind === 'openAt') next.must.openAt = null
    else if (kind === 'category') next.must.categories = next.must.categories.filter((item) => item !== id)
    else if (kind === 'tag') next.must.tags = next.must.tags.filter((item) => item !== id)
    else if (kind === 'neighborhood') next.must.neighborhoods = next.must.neighborhoods.filter((item) => item !== id)
    else if (kind === 'price') next.must.price = next.must.price.filter((item) => item !== id)
    else if (kind === 'diet') delete next.must.diet[id as DietKey]
    else if (kind === 'dish') next.dishes = next.dishes.filter((item) => !sameDish(item.name, id))
    else if (kind === 'prefer') {
      next.prefer.categories = next.prefer.categories.filter((item) => item !== id)
      next.prefer.tags = next.prefer.tags.filter((item) => item !== id)
      if (next.prefer.style === id) next.prefer.style = null
    } else if (kind === 'exclude') {
      next.exclude.categories = next.exclude.categories.filter((item) => item !== id)
      next.exclude.tags = next.exclude.tags.filter((item) => item !== id)
    }
  }
  return next
}

