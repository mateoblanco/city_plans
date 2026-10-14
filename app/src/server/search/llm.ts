import { generateText, Output } from 'ai'
import { ALL_GROUPS, type TagGroup } from '@shared/tags.ts'
import { NEIGHBORHOOD_NAMES } from '@shared/neighborhood-names.ts'
import { SEARCH_CONFIG } from './config'
import { gatewayCost } from './cost'
import { LlmInterpretationSchema, type LlmInterpretation } from './interpretation'

function catalog() {
  return Object.entries(ALL_GROUPS)
    .map(([group, definitions]) => {
      const lines = Object.entries(definitions as TagGroup).map(
        ([id, definition]) => `- ${id}: ${definition.label.es} / ${definition.label.en} (${[...definition.synonyms.es, ...definition.synonyms.en].slice(0, 6).join(', ')})`,
      )
      return `## ${group}\n${lines.join('\n')}`
    })
    .join('\n\n')
}

export const SYSTEM_PROMPT = `Interpretás búsquedas de bares, cafés y restaurantes de Montevideo, Uruguay. La consulta puede estar en español rioplatense o en inglés, y puede ser coloquial.

Devolvés qué pidió la persona usando SOLO los ids del catálogo y los nombres de barrio de las listas de abajo.

Campos:
- nameQuery: si la consulta parece el nombre de un lugar concreto (ej. "la pasiva", "cardinal"), ese nombre tal cual; si no, null.
- must: lo concreto y verificable que se pide.
  - categories: ids del grupo categories (ej. "cafés" → cafe, "boliche" → night_club).
  - tags: ids de los demás grupos que sean requisitos concretos (terraza, música en vivo, brunch, cerveza tirada).
  - diet: vegan / vegetarian / glutenFree en true sólo si se pide ("sin TACC" → glutenFree).
  - neighborhoods: nombres de barrio de la lista ("near Ciudad Vieja" → "Ciudad Vieja", "el prado" → "Prado Nueva Savona").
  - price: low, moderate, high o very_high ("barato" → ["low"], "no muy caro" → ["low","moderate"]).
  - openAt: {now:true} para "abierto ahora"; {now:false, day, time} para un día (0 = domingo … 6 = sábado; null = hoy) y/o una hora "HH:MM" (null = cualquier momento de ese día); null si no habla de horario.
- prefer: lo subjetivo o deseable (tranquilo, acogedor, lindo, para trabajar, para una cita), en categories/tags.
- exclude: lo que la persona NO quiere ("algo que no sea pizza" → exclude tags ["pizza"] y categories ["pizzeria"]).
- dishes: platos o comidas concretas, en español, minúscula y forma estándar ("milanga" → "milanesa", "best steak" → "bife", "chivito", "milanesa napolitana"). Una comida genérica que ya es un tag del grupo foods también va acá ("pizza", "sushi", "picada"), no en tags.
  Cada plato va como {name, related}: en related, 1 a 3 ids de tags o categorías del catálogo que lo representen, para buscar por ahí si ningún lugar tiene el plato (ceviche → ["peruvian", "seafood"]; milanesa napolitana → ["milanesa"]; ramen → ["japanese"]).
- vibe: frase corta en español que describa el ambiente o la ocasión para una búsqueda semántica ("lugar tranquilo para trabajar"); null si la consulta es sólo requisitos concretos.
- language: "es" o "en", el idioma de la consulta.
- unrecognized: partes que no pudiste mapear a nada ("cerca mío", "near me", "para 15 personas").
- wantsBest: true si se pide lo mejor o lo más destacado ("el mejor chivito", "los mejores cafés", "best coffee", "top bares"); si no, false.

Reglas:
- "mejor", "best", "top" sólo marcan wantsBest: no van en must, prefer, unrecognized ni vibe. "rico" y "bueno" no son requisitos: ignoralos.
- Las bebidas coloquiales van como tags: "birra" → draft_beer, "vino" → wine.
- "cumpleaños" o grupos grandes → prefer goodFor (groups, celebration).
- No inventes ids: si algo no está en el catálogo, va a unrecognized.
- Las listas vacías van como [].

# Catálogo (id: label es / label en (sinónimos))

${catalog()}

# Barrios
${Object.values(NEIGHBORHOOD_NAMES).join(', ')}`

/** cost: lo que cobró el Gateway; computedAt: cuándo se llamó al modelo (si es anterior a la búsqueda, vino de la cache). */
export type LlmResult = { data: LlmInterpretation; model: string; cost: number | null; computedAt: number }

/**
 * Opciones de la llamada. El mensaje de sistema es fijo (instrucciones, catálogo de tags y barrios) y va con
 * prompt caching por el AI Gateway; la consulta va en prompt, fuera de lo cacheado.
 */
export function interpretationRequest(normalized: string) {
  const model = SEARCH_CONFIG.llm.model
  const providerOptions: Record<string, { structuredOutputMode: string }> = model.startsWith('anthropic/') ? { anthropic: { structuredOutputMode: 'outputFormat' } } : {}
  return {
    model,
    output: Output.object({ schema: LlmInterpretationSchema }),
    system: {
      role: 'system' as const,
      content: SYSTEM_PROMPT,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral', ttl: SEARCH_CONFIG.llm.promptCacheTtl } } },
    },
    prompt: `Consulta: ${normalized}`,
    providerOptions,
    // Sin razonamiento: la interpretación es una extracción a JSON y el razonamiento sólo sumaba segundos.
    reasoning: 'none' as const,
    abortSignal: AbortSignal.timeout(SEARCH_CONFIG.llm.timeoutMs),
  }
}

export async function interpretWithLlm(normalized: string): Promise<LlmResult> {
  const request = interpretationRequest(normalized)
  const result = await generateText(request)
  const model = request.model
  return { data: result.output, model, cost: gatewayCost(result.providerMetadata), computedAt: Date.now() }
}
