import * as cheerio from 'cheerio'
import JSON5 from 'json5'
import { z } from 'zod'

/** Un ítem de `descuentos`: el porcentaje ("25% de ahorro") y el texto de las tarjetas. Cualquiera puede faltar. */
const Discount = z.object({ pct: z.string().nullish(), texto: z.string().nullish() }).passthrough()

/** Promo por fechas: mientras está vigente, la página la muestra en lugar de los descuentos y el legal del beneficio. */
const Promo = z.object({
  desde: z.string().nullish(),
  hasta: z.string().nullish(),
  titulo: z.string().nullish(),
  etiqueta: z.string().nullish(),
  descuentos: z.array(Discount).nullish(),
  legal: z.string().nullish(),
}).passthrough()

const Benefit = z.object({
  titulo: z.string(),
  categoria: z.string().nullish(),
  departamento: z.string().nullish(),
  dias: z.string().nullish(),
  desde: z.string().nullish(),
  hasta: z.string().nullish(),
  imagen: z.string().nullish(),
  logo: z.string().nullish(),
  link: z.string().nullish(),
  descuentos: z.array(Discount).nullish(),
  legal: z.string().nullish(),
  promo: Promo.nullish(),
}).passthrough()

export type ScotiaDiscount = z.infer<typeof Discount>
export type ScotiaPromo = z.infer<typeof Promo>
export type ScotiaBenefit = z.infer<typeof Benefit>

/**
 * El literal `{…}` que empieza en `start` (un "{"), hasta su "}" de cierre: respeta strings ('…', "…", `…`) y comentarios,
 * así una llave dentro de un texto no corta. null si no cierra.
 */
export function balancedObject(source: string, start: number): string | null {
  let depth = 0
  let quote: string | null = null
  for (let index = start; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index)
      if (end < 0) return null
      index = end
    } else if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      if (end < 0) return null
      index = end + 1
    } else if (char === "'" || char === '"' || char === '`') quote = char
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

export type ExtractResult = { benefits: ScotiaBenefit[]; calls: number; issues: string[] }

/**
 * Los objetos de cada `pushBenefit({...})` de los <script> inline, leídos como datos con JSON5 (literales de objeto:
 * claves sin comillas, comillas simples, comas al final). Nunca se ejecuta el JavaScript de la página: un objeto con algo
 * que no sea un literal (una llamada, una variable) no se puede leer y queda en `issues`.
 */
export function extractPushBenefits(html: string): ExtractResult {
  const $ = cheerio.load(html)
  const benefits: ScotiaBenefit[] = []
  const issues: string[] = []
  let calls = 0
  $('script:not([src])').each((_, element) => {
    const code = $(element).text()
    // "function pushBenefit(data)" es la definición, no un beneficio.
    for (const match of code.matchAll(/(?<!function\s+)\bpushBenefit\s*\(\s*\{/g)) {
      calls += 1
      const literal = balancedObject(code, match.index + match[0].length - 1)
      if (!literal) {
        issues.push(`pushBenefit #${calls}: el objeto no cierra.`)
        continue
      }
      let raw: unknown
      try {
        raw = JSON5.parse(literal)
      } catch (error) {
        issues.push(`pushBenefit #${calls}: no es un literal de datos (${error instanceof Error ? error.message : String(error)}).`)
        continue
      }
      const parsed = Benefit.safeParse(raw)
      if (!parsed.success) {
        issues.push(`pushBenefit #${calls}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}.`)
        continue
      }
      benefits.push(parsed.data)
    }
  })
  return { benefits, calls, issues }
}
