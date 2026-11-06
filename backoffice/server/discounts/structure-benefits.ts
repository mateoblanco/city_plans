import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generateText, Output } from 'ai'
import { z } from 'zod'
import type { CardType } from '../../src/types/discounts.ts'
import { CARD_TYPES } from '../../src/types/discounts.ts'
import { llmUsageCost, type LlmUsage } from '../providers/place-extraction-service.ts'
import { withRateLimitRetry } from '../providers/rate-limit.ts'
import { withServiceLimit } from '../providers/service-limits.ts'

/** El más barato de LLM_PRICES_PER_MILLION que alcanza para estructurar unas líneas de texto. */
export const DEFAULT_DISCOUNTS_MODEL = 'anthropic/claude-haiku-5.5'

export function discountsModel(env: Record<string, string | undefined> = process.env): string {
  return env.DISCOUNTS_MODEL?.trim() || DEFAULT_DISCOUNTS_MODEL
}

/** Un beneficio leído por el modelo, ya validado en código. */
export type StructuredBenefit = {
  percent: number
  cardType: CardType
  cardTiers: string[]
  instantPercent: number | null
  refundPercent: number | null
  cap: string | null
  daysText: string | null
}

export type BenefitStructurer = (text: string) => Promise<{ benefits: StructuredBenefit[]; costUsd: number; cached: boolean }>

// Strings con "" = sin dato y números con 0 = sin dato, como el schema del pipeline (sin nullable ni enums).
const Schema = z.object({
  benefits: z.array(z.object({
    percent: z.number(),
    cardType: z.string(),
    cardTiers: z.array(z.string()),
    instantPercent: z.number(),
    refundPercent: z.number(),
    cap: z.string(),
    days: z.string(),
  })),
})

const PROMPT = `Recibís el texto de un descuento gastronómico de un banco o billetera de Uruguay.
Devolvé un beneficio por cada combinación de porcentaje y tipo de tarjeta que aparezca.
- percent: porcentaje total del descuento.
- cardType: "debit", "credit" u "other" (prepagas, billeteras, otras).
- cardTiers: niveles de tarjeta tal cual aparecen (Internacional, Oro, Platinum, Black, Infinite…); [] si no los nombra.
- instantPercent: la parte que se descuenta en el momento (punto de venta); 0 si no se dice.
- refundPercent: la parte que vuelve como reintegro o en el estado de cuenta; 0 si no se dice.
- cap: el tope tal cual lo escribe el texto; "" si no hay.
- days: los días tal cual los escribe el texto ("martes y jueves"); "" si no los nombra.
No inventes: si un dato no está en el texto, dejalo vacío.`

function validBenefit(raw: z.infer<typeof Schema>['benefits'][number]): StructuredBenefit | null {
  if (!(raw.percent > 0 && raw.percent <= 100)) return null
  const cardType = (CARD_TYPES as readonly string[]).includes(raw.cardType) ? (raw.cardType as CardType) : 'other'
  const part = (value: number) => (value > 0 && value <= raw.percent ? value : null)
  return {
    percent: raw.percent,
    cardType,
    cardTiers: raw.cardTiers.map((tier) => tier.trim()).filter(Boolean),
    instantPercent: part(raw.instantPercent),
    refundPercent: part(raw.refundPercent),
    cap: raw.cap.trim() || null,
    daysText: raw.days.trim() || null,
  }
}

/**
 * Estructura texto libre con el modelo (AI Gateway). Cada respuesta se guarda por hash del texto en `cacheDir`: al
 * reprocesar el mismo texto no se vuelve a pagar.
 */
export function llmBenefitStructurer(options: { model?: string; cacheDir: string }): BenefitStructurer {
  const model = options.model ?? discountsModel()
  return async (text) => {
    const key = createHash('sha256').update(`${model}\n${PROMPT}\n${text}`).digest('hex').slice(0, 32)
    const file = join(options.cacheDir, `${key}.json`)
    try {
      const cached = JSON.parse(await readFile(file, 'utf8')) as { benefits: StructuredBenefit[] }
      return { benefits: cached.benefits, costUsd: 0, cached: true }
    } catch {
      // sin cache
    }
    const result = await withRateLimitRetry('llm', () => withServiceLimit('llm', () => generateText({
      model,
      output: Output.object({ schema: Schema }),
      system: PROMPT,
      prompt: text,
      ...(model.startsWith('anthropic/') ? { providerOptions: { anthropic: { structuredOutputMode: 'outputFormat' } } } : {}),
      maxRetries: 0,
    })), null)
    const usage: LlmUsage = {
      inputTokens: result.usage?.inputTokens ?? null,
      cachedInputTokens: result.usage?.inputTokenDetails?.cacheReadTokens ?? null,
      cacheWriteTokens: result.usage?.inputTokenDetails?.cacheWriteTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      gatewayCostUsd: Number((result.providerMetadata?.gateway as { cost?: unknown } | undefined)?.cost) || null,
    }
    const { inputCost, outputCost } = llmUsageCost(model, usage)
    const benefits = result.output.benefits.flatMap((raw) => validBenefit(raw) ?? [])
    await mkdir(options.cacheDir, { recursive: true })
    await writeFile(file, JSON.stringify({ model, text, benefits }, null, 2))
    return { benefits, costUsd: usage.gatewayCostUsd ?? inputCost + outputCost, cached: false }
  }
}
