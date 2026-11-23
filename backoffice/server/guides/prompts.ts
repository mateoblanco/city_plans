import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { groupOf, label } from '../../src/data/tags.ts'
import { neighborhoodDisplayName } from '../../src/data/neighborhood-names.ts'
import { SEO_DESCRIPTION_MAX } from '../../src/data/guides.ts'
import { INTENTS } from '../../../shared/intents.ts'

/**
 * Prompts de los textos de las guías. Regla central: cada texto sale SÓLO de los datos de la base que se le pasan. Lo que
 * va al modelo de cada lugar lo arma placeFacts, con una lista cerrada de claves (PLACE_FACT_KEYS). El precio va
 * sólo como palabra fija (PRICE_WORDS), nunca un monto. Nunca horarios, reservas, Instagram, web, seguidores, prominencia, ubicación ni nada de Google: no se lo pasamos, así no
 * puede decirlo.
 */

const STYLE_FILE = path.resolve(import.meta.dirname, '../../config/guide-style.md')

/** La guía de estilo, leída en cada generación (sin los comentarios HTML, que son notas para quien la edita). */
export function guideStyle(file = STYLE_FILE): string {
  return readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim()
}

/** Lo que el backoffice lee de un lugar para el prompt (store.placesForPrompt). Puede traer más columnas: no importa. */
export type PlacePromptRow = {
  id: string
  name: string
  neighborhoodId: string | null
  locatedIn: string | null
  categories: string[]
  tags: string[]
  signature: string[]
  dishes: string[]
  descriptionEs: string | null
  highlights: { es: string; en?: string }[]
  style: string | null
  /** Nivel de precio de la base (low, moderate, high, unknown); al modelo le llega como palabra fija. */
  price?: string | null
  dietVegan: string | null
  dietVegetarian: string | null
  dietGlutenFree: string | null
  [other: string]: unknown
}

/** Las únicas claves que llegan al modelo por lugar. */
export const PLACE_FACT_KEYS = [
  'nombre',
  'barrio',
  'dentro_de',
  'tipo',
  'descripcion',
  'conocido_por',
  'platos',
  'ambiente',
  'para_que',
  'comidas',
  'bebidas',
  'cocinas',
  'servicios',
  'ofertas',
  'estilo',
  'precio',
  'dietas',
] as const

/** El nivel de precio como palabra fija: lo único que el modelo puede decir del precio. Sin precio, no va. */
export const PRICE_WORDS: Record<string, string> = { low: 'económico', moderate: 'precio medio', high: 'caro' }
export type PlaceFactKey = (typeof PLACE_FACT_KEYS)[number]
export type PlaceFacts = Partial<Record<PlaceFactKey, string | string[]>>

/** Grupo de tags.ts → clave del prompt. Los tags de otro grupo (o desconocidos) no van. */
const TAG_KEYS: Record<string, PlaceFactKey> = {
  atmosphere: 'ambiente',
  goodFor: 'para_que',
  moments: 'para_que',
  foods: 'comidas',
  drinks: 'bebidas',
  cuisines: 'cocinas',
  features: 'servicios',
  offers: 'ofertas',
}

const DIET_LEVEL: Record<string, string | null> = { fully: 'todo el menú', has_options: 'tiene opciones' }

const clean = (values: (string | null | undefined)[]) => [...new Set(values.map((value) => value?.trim() ?? '').filter(Boolean))]

/**
 * Los datos de un lugar que puede usar el modelo, con claves en español y labels (nunca ids). Un dato vacío no va.
 * Lo que no esté en PLACE_FACT_KEYS no sale de acá, aunque la fila lo traiga.
 */
export function placeFacts(row: PlacePromptRow): PlaceFacts {
  const facts: PlaceFacts = {}
  const put = (key: PlaceFactKey, value: string | (string | null)[] | null | undefined) => {
    if (Array.isArray(value)) {
      const list = clean(value)
      if (list.length > 0) facts[key] = list
    } else if (value?.trim()) facts[key] = value.trim()
  }
  put('nombre', row.name)
  put('barrio', row.neighborhoodId ? (neighborhoodDisplayName(row.neighborhoodId) ?? row.neighborhoodId) : null)
  put('dentro_de', row.locatedIn)
  put('tipo', row.categories.map((id) => label(id, 'es')))
  put('descripcion', row.descriptionEs)
  put('conocido_por', [...row.highlights.map((item) => item.es), ...row.signature.map((id) => label(id, 'es'))])
  put('platos', row.dishes)
  for (const tag of row.tags) {
    const group = groupOf(tag)
    const key = group ? TAG_KEYS[group] : undefined
    if (!key) continue
    const current = (facts[key] as string[] | undefined) ?? []
    facts[key] = clean([...current, label(tag, 'es')])
  }
  put('estilo', row.style ? label(row.style, 'es') : null)
  put('precio', row.price ? (PRICE_WORDS[row.price] ?? null) : null)
  put('dietas', [
    DIET_LEVEL[row.dietVegan ?? ''] ? `Vegano: ${DIET_LEVEL[row.dietVegan!]}` : null,
    DIET_LEVEL[row.dietVegetarian ?? ''] ? `Vegetariano: ${DIET_LEVEL[row.dietVegetarian!]}` : null,
    DIET_LEVEL[row.dietGlutenFree ?? ''] ? `Sin TACC: ${DIET_LEVEL[row.dietGlutenFree!]}` : null,
  ])
  return facts
}

/** Los datos de un lugar como líneas "clave: valor". */
export function factsBlock(facts: PlaceFacts): string {
  return PLACE_FACT_KEYS.flatMap((key) => {
    const value = facts[key]
    if (value === undefined) return []
    return [`${key}: ${Array.isArray(value) ? value.join('; ') : value}`]
  }).join('\n')
}

/** Cantidad de datos del lugar (para pedir un texto más corto si son pocos). */
export const factCount = (facts: PlaceFacts) => Object.keys(facts).length

const RULES = `Reglas (no se negocian):
- Usá SÓLO los datos que te paso. No agregues nada de tu conocimiento propio sobre estos lugares, el barrio o la ciudad.
- Si un dato no está, no lo digas ni lo supongas. Con pocos datos, escribí menos.
- Del precio, sólo podés usar tal cual la palabra del dato "precio" (económico, precio medio o caro). Nunca montos, monedas ni comparaciones de precio ("más barato que", "más caro").
- Nunca menciones horarios, días ni horas de apertura, direcciones ni comparaciones entre lugares.
- En los textos de cada lugar y en las introducciones, nunca uses superlativos ni frases como "el mejor", "la mejor", "único", "imperdible" o "el más …", salvo que estén textuales en los datos. En el título visible y en el título para Google sí se permiten ("Los mejores chivitos de Montevideo").
- Respondé en español del Uruguay, siguiendo la guía de estilo.`

/** El system de todas las generaciones: la guía de estilo y las reglas. */
export const systemPrompt = (style = guideStyle()) => `Escribís textos para guías editoriales de lugares para salir en Montevideo.\n\n${style}\n\n${RULES}`

export type GuideDraftContext = {
  idea: string
  title: string
  intro: string
  neighborhoodId: string | null
  group: keyof typeof INTENTS
}

const scope = (neighborhoodId: string | null) => (neighborhoodId ? `el barrio ${neighborhoodDisplayName(neighborhoodId) ?? neighborhoodId}, Montevideo` : 'toda Montevideo')

function guideHeader(draft: GuideDraftContext) {
  return [
    `Grupo: ${INTENTS[draft.group].label.es}`,
    `Alcance: ${scope(draft.neighborhoodId)}`,
    draft.idea.trim() ? `Idea de la guía: ${draft.idea.trim()}` : null,
    draft.title.trim() ? `Título actual: ${draft.title.trim()}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

const placesList = (places: PlaceFacts[]) => places.map((facts, index) => `Lugar ${index + 1}\n${factsBlock(facts)}`).join('\n\n')

export const TITLE_MAX = 80
export const SEO_TITLE_MAX = 60
export const INTRO_MAX = 700
export const PLACE_TEXT_MAX = 320

/** Los pedidos, cada uno con su schema (el texto se valida además en código: generate.ts). */
/** "Gancho: descripción": un solo ":" con texto de los dos lados. */
export const TITLE_FORMULA = /^[^:]{3,}: [^:]{3,}$/

export const SCHEMAS = {
  title: z.object({ title: z.string().min(3).max(TITLE_MAX).regex(TITLE_FORMULA, 'El título tiene que ser "Gancho: descripción".') }),
  seo: z.object({ seoTitle: z.string().min(10).max(SEO_TITLE_MAX), seoDescription: z.string().min(50).max(SEO_DESCRIPTION_MAX) }),
  // 2 o 3 frases, una por ítem: el schema cuenta las frases.
  intro: z.object({ sentences: z.array(z.string().min(15).max(260)).min(2).max(3) }),
  place: z.object({ text: z.string().min(10).max(PLACE_TEXT_MAX) }),
  areaIntro: z.object({ paragraphs: z.array(z.string().min(20)).min(1).max(2) }),
} as const

export function titlePrompt(draft: GuideDraftContext, places: PlaceFacts[]) {
  return `${guideHeader(draft)}\n\nLos lugares de la guía:\n\n${placesList(places)}\n\nEscribí el título visible de la guía con la fórmula "Gancho: descripción" (como los ejemplos de la guía de estilo): un gancho corto con el plan, dos puntos, y qué lugares son y para qué. Hasta ${TITLE_MAX - 10} caracteres, un solo ":".`
}

export function seoPrompt(draft: GuideDraftContext, places: PlaceFacts[]) {
  return `${guideHeader(draft)}\nCantidad de lugares: ${places.length}\n\nLos lugares de la guía:\n\n${placesList(places)}\n\nEscribí el título para Google (hasta ${SEO_TITLE_MAX} caracteres, sin el nombre de la app) y la descripción para Google (120 a ${SEO_DESCRIPTION_MAX} caracteres).`
}

export function introPrompt(draft: GuideDraftContext, places: PlaceFacts[]) {
  return `${guideHeader(draft)}\n\nLos lugares de la guía (sólo para que sepas de qué se trata; no los nombres):\n\n${placesList(places)}\n\nEscribí la introducción de la guía: 2 o 3 frases (una por ítem) sobre el plan, qué tienen en común estos lugares y para qué sirven. No nombres ningún lugar ni enumeres barrios.`
}

/**
 * El texto de un lugar. `others`: los textos que ya tiene la guía (de otros lugares), para no repetir frases ni
 * arranques. El tema ya lo dice el título: el texto no lo repite.
 */
export function placePrompt(draft: GuideDraftContext, facts: PlaceFacts, others: readonly string[] = []) {
  const short = factCount(facts) <= 4 ? '\n- Hay pocos datos: una sola oración.' : ''
  const written = others.length > 0 ? `\n\nTextos que ya tiene la guía (de otros lugares). No repitas sus frases, sus palabras de arranque ni sus giros:\n${others.map((text) => `- ${text}`).join('\n')}` : ''
  return `${guideHeader(draft)}\n\nEl lugar:\n${factsBlock(facts)}${written}\n\nEscribí el texto de este lugar dentro de la guía: 1 a 3 oraciones, hasta ${PLACE_TEXT_MAX} caracteres.
- El tema de la guía ya lo dice el título: no lo repitas (nada de "para una primera cita", "para ir con la compu" ni parecidos). Contá qué tiene este lugar.
- Como máximo 2 platos, los más distintivos. Nunca enumeres la carta.
- El precio, sólo si aporta y dentro de una frase ("un bodegón económico con…"); nunca como frase suelta ("Es caro.").
- No empieces con el nombre del lugar ni con el mismo arranque que otro texto.${short}`
}

/** Lo de un barrio o de la ciudad para su intro: sólo de la base (sus guías publicadas y sus lugares publicados). */
export type AreaContext = {
  neighborhoodId: string | null
  guides: { title: string; group: keyof typeof INTENTS }[]
  /** Labels de los tipos y tags más comunes entre sus lugares publicados, con la cantidad. */
  categories: { label: string; count: number }[]
  tags: { label: string; count: number }[]
  placeCount: number
  /** Para la ciudad: los barrios con guías. */
  neighborhoods?: string[]
}

export function areaPrompt(area: AreaContext) {
  const lines = [
    `Página: ${area.neighborhoodId ? `guías del barrio ${neighborhoodDisplayName(area.neighborhoodId) ?? area.neighborhoodId}` : 'guías de toda Montevideo'}`,
    `Lugares publicados: ${area.placeCount}`,
    area.guides.length > 0 ? `Guías publicadas: ${area.guides.map((guide) => `${guide.title} (${INTENTS[guide.group].label.es})`).join('; ')}` : null,
    area.categories.length > 0 ? `Tipos de lugar más comunes: ${area.categories.map((item) => `${item.label} (${item.count})`).join('; ')}` : null,
    area.tags.length > 0 ? `Lo más repetido en sus lugares: ${area.tags.map((item) => `${item.label} (${item.count})`).join('; ')}` : null,
    area.neighborhoods && area.neighborhoods.length > 0 ? `Barrios con guías: ${area.neighborhoods.join('; ')}` : null,
  ].filter(Boolean)
  return `${lines.join('\n')}\n\nEscribí la introducción de esta página: 1 o 2 párrafos cortos sobre qué tipo de salidas hay, sólo con estos datos. No nombres lugares.`
}

export const AREA_INTRO_MAX = 600

/** Los labels de una lista de ids (tipos o tags), contados, los más comunes primero. */
export function topLabels(ids: string[], max: number): { label: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([id, count]) => ({ label: label(id, 'es'), count }))
}
