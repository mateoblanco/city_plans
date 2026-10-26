import { generateText, Output } from 'ai'
import { ALL_GROUPS, type TagGroup } from '@shared/tags.ts'
import { NEIGHBORHOOD_NAMES } from '@shared/neighborhood-names.ts'
import { INTENTS, type IntentDef } from '@shared/intents.ts'
import { SECTIONS, type SectionDef } from '@shared/sections.ts'
import { SEARCH_CONFIG } from './config'
import { gatewayCost } from './cost'
import { LlmInterpretationSchema, type LlmInterpretation } from './interpretation'

function catalog() {
  return Object.entries(ALL_GROUPS)
    .map(([group, definitions]) => {
      const lines = Object.entries(definitions as TagGroup).map(
        ([id, definition]) =>
          `- ${id}: ${definition.label.es} / ${definition.label.en} (${[...definition.synonyms.es, ...definition.synonyms.en].slice(0, 6).join(', ')})` +
          (definition.dishes ? ` platos: ${definition.dishes.es.join(', ')}` : ''),
      )
      return `## ${group}\n${lines.join('\n')}`
    })
    .join('\n\n')
}

/** Verbos de cada intención, para el campo intent. */
function intentVerbs() {
  return (Object.entries(INTENTS) as [string, IntentDef][])
    .map(([id, intent]) => `"${[...intent.verbs.es, ...intent.verbs.en].join('", "')}" → ${id}`)
    .join('; ')
}

/** Grupos para agrupar los resultados, para el campo sections. */
function sectionCatalog() {
  return (Object.entries(SECTIONS) as [string, SectionDef][]).map(([id, section]) => `- ${id}: ${section.title.es} (${section.rule})`).join('\n')
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
  - price: low, moderate, high o very_high ("barato" o "económico" → ["low"], "no muy caro" → ["low","moderate"], "caro" → ["high","very_high"], "de lujo" → ["very_high"]).
  - openAt: {today:true, tonight:false} para "hoy", "ahora", "abierto ahora" o "today" (abierto ahora o abre más tarde hoy); {today:true, tonight:true} para "esta noche" o "tonight"; {today:false, tonight:false, day, time} para otro día y/o una hora concreta (0 = domingo … 6 = sábado; null = hoy; hora "HH:MM", null = cualquier momento de ese día): "el sábado" → day 6, "mañana a la noche" → mañana con time "21:00", "hoy a las 22" → day null, time "22:00"; null si no habla de horario.
- prefer: lo subjetivo o deseable (tranquilo, acogedor, lindo, para trabajar), en categories/tags.
  - Momentos u ocasiones, siempre en prefer.tags y nunca en must: "con amigos" o "en grupo" → groups; "cita", "romántico" o "en pareja" → date; "con los chicos" o "con niños" → kids_friendly; "festejar" o "cumpleaños" → celebration; "algo rápido" o "al paso" → quick.
  - Estilo del lugar, también en prefer.tags y nunca en must: "descontracturado" o "informal" → casual; "especial", "elegante" o "de autor" → cuidado.
  - "de barrio", "bolichito", "boliche de barrio", "clásico del barrio" o "bodegón de barrio" → neighborhood_spot en prefer.tags (no es lo mismo que barato: no agregues precio). "boliche" solo sigue siendo night_club.
  - Una cita puede traer el estilo: "primera cita", "algo tranqui para una cita" o "cita descontracturada" → date + casual; "aniversario", "anniversary" o "cita especial" → date + cuidado; "cena romántica" → date + cuidado y además dinner, igual que "cena"; "cita" sola → sólo date.
- exclude: lo que la persona NO quiere ("algo que no sea pizza" → exclude tags ["pizza"] y categories ["pizzeria"]).
- dishes: platos o comidas concretas, en español, minúscula y forma estándar ("milanga" → "milanesa", "best steak" → "bife", "chivito", "milanesa napolitana"). Una comida genérica que ya es un tag del grupo foods también va acá ("pizza", "sushi", "picada"), no en tags.
  Cada plato va como {name, related}: en related, 1 a 3 ids de tags o categorías del catálogo que lo representen, para buscar por ahí si ningún lugar tiene el plato (ceviche → ["peruvian", "seafood"]; milanesa napolitana → ["milanesa"]; ramen → ["japanese"]). Un plato típico de una cocina (los "platos:" del catálogo) va siempre en dishes con esa cocina en related, nunca como tag de cocina en must: "tacos" → dishes [{name: "tacos", related: ["mexican"]}].
- vibe: frase corta en español que describa el ambiente o la ocasión para una búsqueda semántica ("lugar tranquilo para trabajar"); null si la consulta es sólo requisitos concretos.
- language: "es" o "en", el idioma de la consulta.
- unrecognized: partes que no pudiste mapear a nada ("cerca mío", "near me", "para 15 personas").
- intent: qué quiere hacer la persona cuando lo dice con un verbo y no con un tag: ${intentVerbs()}. "almorzar", "cenar" y "merendar" ya son tags (lunch, dinner, afternoon_snack) y no necesitan intent, pero no está mal ponerlo. null si la consulta no dice qué quiere hacer.
- sections: si la consulta es amplia (sin lugar, plato ni requisitos concretos: "comer con amigos", "algo para una cita", "café en Pocitos"), 2 a 5 ids de la lista "Secciones" que sirvan para agrupar los resultados de esa búsqueda, del más útil al menos; [] si la consulta es específica.
- wantsBest: true si se pide lo mejor o lo más destacado ("el mejor chivito", "los mejores cafés", "best coffee", "top bares"); si no, false.

Reglas:
- "mejor", "best", "top" sólo marcan wantsBest: no van en must, prefer, unrecognized ni vibe. "rico" y "bueno" no son requisitos: ignoralos.
- Las bebidas coloquiales van como tags: "birra" → draft_beer, "vino" → wine. Pero "tomar algo", "unas cervezas" o "unos tragos" sólo dicen la intención (intent bars), no piden un tag.
- No inventes ids: si algo no está en el catálogo, va a unrecognized.
- Las listas vacías van como [].

# Catálogo (id: label es / label en (sinónimos))

${catalog()}

# Secciones (id: título (qué lugares entran))
${sectionCatalog()}

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
    // Determinística: la misma consulta tiene que dar la misma interpretación ("comer carne" salía como tag o plato).
    temperature: 0,
    abortSignal: AbortSignal.timeout(SEARCH_CONFIG.llm.timeoutMs),
  }
}

export async function interpretWithLlm(normalized: string): Promise<LlmResult> {
  const request = interpretationRequest(normalized)
  const result = await generateText(request)
  const model = request.model
  return { data: result.output, model, cost: gatewayCost(result.providerMetadata), computedAt: Date.now() }
}
