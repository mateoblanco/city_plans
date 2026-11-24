import { gateway, generateText, Output } from 'ai'
import type { z } from 'zod'
import { llmUsageCost, type LlmUsage } from '../providers/place-extraction-service.ts'
import { withServiceLimit } from '../providers/service-limits.ts'
import { isNoCredit } from '../providers/ai-credit.ts'
import {
  areaPrompt,
  factsBlock,
  introPrompt,
  placeFacts,
  placePrompt,
  SCHEMAS,
  seoPrompt,
  systemPrompt,
  titlePrompt,
  type AreaContext,
  type GuideDraftContext,
  type PlaceFacts,
  type PlacePromptRow,
} from './prompts.ts'
import { guideStyle } from './prompts.ts'
import { dishIssues, forbiddenPhrases, introIssues, openingIssues, phraseIssues, standalonePriceIssues, themeIssues } from './style-checks.ts'

// Compartidos con la extracción de lugares.
export { AI_CREDIT_URL, isNoCredit } from '../providers/ai-credit.ts'

/** El mejor modelo disponible en el AI Gateway para escribir; se cambia con GUIDES_MODEL. */
export const DEFAULT_GUIDES_MODEL = 'anthropic/claude-opus-5.5'

export function guidesModel(env: Record<string, string | undefined> = process.env): string {
  return env.GUIDES_MODEL?.trim() || DEFAULT_GUIDES_MODEL
}


/** Llamada al modelo con salida estructurada; se reemplaza en los tests. Sin cache: regenerar tiene que dar otro texto. */
export type GuideLlmCall = (request: { model: string; system: string; prompt: string; schema: z.ZodType }) => Promise<{ output: unknown; costUsd: number }>

export const gatewayGuideCall: GuideLlmCall = async ({ model, system, prompt, schema }) => {
  const result = await withServiceLimit('llm', () =>
    generateText({
      model,
      output: Output.object({ schema }),
      system,
      prompt,
      ...(model.startsWith('anthropic/') ? { providerOptions: { anthropic: { structuredOutputMode: 'outputFormat' } } } : {}),
      maxRetries: 0,
    }),
  )
  const usage: LlmUsage = {
    inputTokens: result.usage?.inputTokens ?? null,
    cachedInputTokens: result.usage?.inputTokenDetails?.cacheReadTokens ?? null,
    cacheWriteTokens: result.usage?.inputTokenDetails?.cacheWriteTokens ?? null,
    outputTokens: result.usage?.outputTokens ?? null,
    gatewayCostUsd: Number((result.providerMetadata?.gateway as { cost?: unknown } | undefined)?.cost) || null,
  }
  const { inputCost, outputCost } = llmUsageCost(model, usage)
  return { output: result.output, costUsd: usage.gatewayCostUsd ?? inputCost + outputCost }
}

/** El saldo del AI Gateway (USD); null si no se pudo leer (no bloquea nada: vale el 402 del momento). */
export async function gatewayBalance(): Promise<number | null> {
  try {
    const credits = await gateway.getCredits()
    const balance = Number(credits.balance)
    return Number.isFinite(balance) ? balance : null
  } catch {
    return null
  }
}

/** Errores con código para la API (el editor muestra el mensaje y, sin crédito, el link). */
export class GuideAiError extends Error {
  readonly code: 'AI_NO_CREDIT' | 'AI_INVALID_OUTPUT' | 'AI_ERROR'
  /** Lo que se pagó aunque el texto no sirva (una respuesta inválida se cobra igual). */
  readonly costUsd: number
  constructor(code: GuideAiError['code'], message: string, costUsd = 0) {
    super(message)
    this.code = code
    this.costUsd = costUsd
  }
}


const plain = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

type Rule = { what: string; pattern: RegExp }

/** Siempre, en cualquier texto: un monto o una comparación de precio, aunque los datos los traigan. */
const NEVER: Rule[] = [
  { what: 'un monto', pattern: /\$|\bpesos\b|\buyu\b|\bu\$s\b|\busd\b|\bdolares\b|\beuros?\b/ },
  {
    what: 'una comparación de precio',
    pattern: /\b(?:mas|menos) (?:barat[oa]s?|car[oa]s?|economic[oa]s?|accesibles?)\b|\b(?:barat[oa]s?|car[oa]s?|economic[oa]s?) que\b|\bprecios? (?:mas|menos) \w+\b/,
  },
]

/** En cualquier texto, sólo si los datos lo dicen con el mismo patrón: un horario. */
const FROM_DATA: Rule[] = [{ what: 'un horario', pattern: /\b\d{1,2}(?::|\.|h)\d{2}\b|\b\d{1,2}\s?(?:hs|horas)\b|\babre(?:n)?\b|\bcierra(?:n)?\b/ }]

/**
 * Las palabras de precio: cada una sólo si está en los datos. El precio llega como palabra fija (prompts.ts PRICE_WORDS:
 * económico, precio medio o caro); "barato" nunca está en los datos, así que nunca pasa.
 */
const PRICE_WORDS: RegExp[] = [/\beconomic[oa]s?\b/, /\bprecio medio\b/, /\bcar[oa]s?\b/, /\bbarat[oa]s?\b/, /\baccesibles?\b/]

/** Sólo en los textos de cada lugar y las introducciones (en los títulos se permiten), si los datos no los traen. */
const SUPERLATIVES: Rule[] = [
  { what: 'un superlativo', pattern: /\b(?:el|la|los|las) mejor(?:es)?\b|\bunic[oa]s?\b|\bimperdible(?:s)?\b|\b(?:el|la|los|las) mas \w+\b|\bjoya escondida\b/ },
  { what: 'una comparación', pattern: /\bmejor(?:es)? que\b|\bpeor(?:es)? que\b|\bmas \w+ que\b|\bmenos \w+ que\b/ },
]

/**
 * Lo que el texto dice y no puede: montos y comparaciones de precio (siempre); horarios y palabras de precio que no
 * están en los datos; y, con `superlatives` (textos de lugares e introducciones), superlativos y comparaciones que no
 * están en los datos. Vacío = el texto pasa. Es un chequeo de seguridad además del prompt, no un detector perfecto.
 */
export function groundingIssues(text: string, sources: string[], options: { superlatives: boolean } = { superlatives: true }): string[] {
  const value = plain(text)
  const data = plain(sources.join('\n'))
  const fromData = options.superlatives ? [...FROM_DATA, ...SUPERLATIVES] : FROM_DATA
  return [
    ...NEVER.filter((rule) => rule.pattern.test(value)).map((rule) => rule.what),
    ...(PRICE_WORDS.some((word) => word.test(value) && !word.test(data)) ? ['una palabra de precio'] : []),
    ...fromData.filter((rule) => rule.pattern.test(value) && !rule.pattern.test(data)).map((rule) => rule.what),
  ]
}

const sourcesOf = (facts: PlaceFacts[]) => facts.map(factsBlock)

type Generated<T> = { value: T; costUsd: number }

/** Intentos por generación: el primero y, si no pasa los chequeos, uno más con el motivo (ver run). */
export const GENERATION_ATTEMPTS = 2

/** El pedido para el reintento: el texto anterior y por qué no sirvió, para que el modelo corrija eso y no lo repita. */
export const retryPrompt = (prompt: string, previous: string[], problems: string[]) =>
  `${prompt}\n\nTu intento anterior no sirve:\n«${previous.join(' ')}»\nProblemas: ${problems.join('; ')}.\nEscribilo de nuevo corrigiendo exactamente eso y respetando todas las reglas.`

async function run<S extends z.ZodType>(
  call: GuideLlmCall,
  model: string,
  schema: S,
  prompt: string,
  sources: string[],
  texts: (value: z.infer<S>) => string[],
  /** Chequear superlativos y comparaciones: sí en textos de lugares e introducciones, no en los títulos. */
  superlatives: boolean,
  /** Chequeos de estilo extra (style-checks.ts) sobre cada texto. */
  style: (text: string) => string[] = () => [],
): Promise<Generated<z.infer<S>>> {
  // Si el texto no pasa los chequeos (datos o estilo), se reintenta una vez con el motivo en el pedido: regenerar con el
  // mismo pedido tiende a dar el mismo texto (el modelo no sabe qué estuvo mal). Se paga cada intento.
  let costUsd = 0
  let request = prompt
  let failure: GuideAiError | null = null
  for (let attempt = 1; attempt <= GENERATION_ATTEMPTS; attempt++) {
    let result: { output: unknown; costUsd: number }
    try {
      result = await call({ model, system: systemPrompt(), prompt: request, schema })
    } catch (error) {
      if (isNoCredit(error)) throw new GuideAiError('AI_NO_CREDIT', 'El AI Gateway no tiene crédito: cargá crédito y volvé a intentar.', costUsd)
      const detail = error instanceof Error ? error.message : String(error)
      if (/schema|validat|parse|no object|json/i.test(detail)) throw new GuideAiError('AI_INVALID_OUTPUT', 'La respuesta del modelo no tiene el formato esperado. Volvé a generar.', costUsd)
      throw new GuideAiError('AI_ERROR', `No se pudo generar: ${detail}`, costUsd)
    }
    costUsd += result.costUsd
    const parsed = schema.safeParse(result.output)
    if (!parsed.success) {
      const reason = parsed.error.issues[0]?.message ?? 'formato'
      failure = new GuideAiError('AI_INVALID_OUTPUT', `La respuesta del modelo no es válida (${reason}). Volvé a generar.`, costUsd)
      request = retryPrompt(prompt, [JSON.stringify(result.output ?? null)], [`no cumple el formato pedido (${reason})`])
      continue
    }
    const written = texts(parsed.data)
    const grounding = [...new Set(written.flatMap((text) => groundingIssues(text, sources, { superlatives })))]
    const styleIssues = [...new Set(written.flatMap(style))]
    if (grounding.length === 0 && styleIssues.length === 0) return { value: parsed.data, costUsd }
    failure =
      grounding.length > 0
        ? new GuideAiError('AI_INVALID_OUTPUT', `El texto generado menciona ${grounding.join(', ')}, que no se permite o no está en los datos. Volvé a generar.`, costUsd)
        : new GuideAiError('AI_INVALID_OUTPUT', `El texto generado no sigue la guía de estilo: ${styleIssues.join('; ')}. Volvé a generar.`, costUsd)
    const problems = [...grounding.map((issue) => `menciona ${issue}, que no se permite o no está en los datos`), ...styleIssues]
    request = retryPrompt(prompt, written, problems)
  }
  // Los dos intentos fallaron: el error del último, con lo pagado por los dos.
  throw new GuideAiError(failure!.code, failure!.message, costUsd)
}

export type Generator = ReturnType<typeof guideGenerator>

/** Las generaciones del editor. Devuelven el texto y el costo; nunca guardan nada. */
export function guideGenerator(options: { call?: GuideLlmCall; model?: string } = {}) {
  const call = options.call ?? gatewayGuideCall
  const model = options.model ?? guidesModel()
  const factsOf = (rows: PlacePromptRow[]) => rows.map(placeFacts)

  return {
    model,
    title: (draft: GuideDraftContext, rows: PlacePromptRow[]) => {
      const facts = factsOf(rows)
      return run(call, model, SCHEMAS.title, titlePrompt(draft, facts), [draft.idea, ...sourcesOf(facts)], (value) => [value.title], false)
    },
    seo: (draft: GuideDraftContext, rows: PlacePromptRow[]) => {
      const facts = factsOf(rows)
      return run(call, model, SCHEMAS.seo, seoPrompt(draft, facts), [draft.idea, ...sourcesOf(facts)], (value) => [value.seoTitle, value.seoDescription], false)
    },
    intro: (draft: GuideDraftContext, rows: PlacePromptRow[]) => {
      const facts = factsOf(rows)
      const phrases = forbiddenPhrases(guideStyle())
      return run(call, model, SCHEMAS.intro, introPrompt(draft, facts), [draft.idea, ...sourcesOf(facts)], (value) => [value.sentences.join(' ')], true, (text) => [
        ...phraseIssues(text, phrases),
        ...introIssues(text, rows.map((row) => row.name)),
      ])
    },
    /** `others`: los textos que ya tiene la guía (de otros lugares), para no repetir arranques ni frases. */
    place: (draft: GuideDraftContext, row: PlacePromptRow, others: readonly string[] = []) => {
      const facts = placeFacts(row)
      const phrases = forbiddenPhrases(guideStyle())
      const dishes = (facts.platos as string[] | undefined) ?? []
      return run(call, model, SCHEMAS.place, placePrompt(draft, facts, others), [draft.idea, factsBlock(facts)], (value) => [value.text], true, (text) => [
        ...phraseIssues(text, phrases),
        ...themeIssues(text, [draft.title, draft.idea]),
        ...openingIssues(text, others),
        ...dishIssues(text, dishes),
        ...standalonePriceIssues(text),
      ])
    },
    area: (area: AreaContext) => {
      const prompt = areaPrompt(area)
      return run(call, model, SCHEMAS.areaIntro, prompt, [prompt], (value) => value.paragraphs, true)
    },
  }
}
