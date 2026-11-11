import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generateText, Output } from 'ai'
import type { z } from 'zod'
import { llmUsageCost, type LlmUsage } from '../providers/place-extraction-service.ts'
import { withRateLimitRetry } from '../providers/rate-limit.ts'
import { withServiceLimit } from '../providers/service-limits.ts'

/** El más barato de LLM_PRICES_PER_MILLION que alcanza para estructurar unas líneas de texto. */
export const DEFAULT_DISCOUNTS_MODEL = 'anthropic/claude-haiku-5.5'

export function discountsModel(env: Record<string, string | undefined> = process.env): string {
  return env.DISCOUNTS_MODEL?.trim() || DEFAULT_DISCOUNTS_MODEL
}

/**
 * Llamada al modelo (AI Gateway) con salida estructurada según `schema`. Separada para poder reemplazarla en los tests;
 * la salida se valida después en código.
 */
export type LlmCall = (request: { model: string; system: string; prompt: string; schema: z.ZodType }) => Promise<{ output: unknown; costUsd: number }>

export const gatewayLlmCall: LlmCall = async ({ model, system, prompt, schema }) => {
  const result = await withRateLimitRetry('llm', () => withServiceLimit('llm', () => generateText({
    model,
    output: Output.object({ schema }),
    system,
    prompt,
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
  return { output: result.output, costUsd: usage.gatewayCostUsd ?? inputCost + outputCost }
}

/**
 * Pide al modelo y guarda la respuesta ya validada en `cacheDir`, por hash de modelo + prompt + texto: el mismo texto no
 * se vuelve a pagar. `validate` corre antes de guardar (lo que se guarda es lo validado).
 */
export async function cachedLlmObject<Raw, Valid>(options: {
  cacheDir: string
  model: string
  system: string
  text: string
  schema: z.ZodType<Raw>
  validate: (raw: Raw) => Valid
  call?: LlmCall
  /** Campo del archivo con el valor (el de los beneficios guarda `benefits`, de antes de este helper: así su cache sigue valiendo). */
  field?: string
}): Promise<{ value: Valid; costUsd: number; cached: boolean }> {
  const field = options.field ?? 'value'
  const key = createHash('sha256').update(`${options.model}\n${options.system}\n${options.text}`).digest('hex').slice(0, 32)
  const file = join(options.cacheDir, `${key}.json`)
  try {
    const cached = JSON.parse(await readFile(file, 'utf8')) as Record<string, Valid>
    if (field in cached) return { value: cached[field], costUsd: 0, cached: true }
  } catch {
    // sin cache
  }
  const { output, costUsd } = await (options.call ?? gatewayLlmCall)({ model: options.model, system: options.system, prompt: options.text, schema: options.schema })
  const value = options.validate(options.schema.parse(output))
  await mkdir(options.cacheDir, { recursive: true })
  await writeFile(file, JSON.stringify({ model: options.model, text: options.text, [field]: value }, null, 2))
  return { value, costUsd, cached: false }
}
