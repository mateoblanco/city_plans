import { z } from 'zod'
import { cachedLlmObject, discountsModel, type LlmCall } from '../llm-cache.ts'
import { cleanText, fold } from '../text.ts'
import type { DepartmentBlock } from './extract-pdf.ts'

/** Un local del listado, con el nombre comercial, la dirección y la ciudad separados. */
export type BrouRow = { name: string; address: string; city: string }

/** `aligned`: cada campo es exactamente una celda del PDF (la tabla vino limpia); si no, sólo se pudo validar el texto. */
export type RowSplit = { rows: BrouRow[]; aligned: boolean }

/** `method`: por las celdas del PDF (sin costo) o con el modelo (respaldo); `modelCalls`: llamadas pagas, sin las del cache. */
export type RowSplitter = (block: DepartmentBlock) => Promise<RowSplit & { costUsd: number; cached: boolean; method: 'cells' | 'model'; modelCalls: number }>

const Schema = z.object({ rows: z.array(z.object({ name: z.string(), address: z.string(), city: z.string() })) })

const PROMPT = `Recibís fragmentos de texto de una tabla en PDF con los comercios adheridos a un descuento de un banco de Uruguay, de un solo departamento.
La tabla tiene tres columnas: NOMBRE COMERCIAL, DIRECCIÓN y CIUDAD. Los fragmentos vienen en orden, fila por fila: nombre, dirección, ciudad. Normalmente cada línea es una celda, pero a veces una línea tiene dos celdas pegadas (nombre y dirección) o una celda quedó partida en dos líneas.
Devolvé una fila por comercio, en el mismo orden, con:
- name: el nombre comercial (puede tener números: "BURGER HOUSE 284", "BAR 36", "22 BAR").
- address: la dirección (calle y número, esquinas, rutas, "SN").
- city: la ciudad o localidad.
Copiá el texto exactamente como está, sin corregir, traducir, agregar ni sacar palabras: juntando name, address y city de todas las filas tiene que quedar el mismo texto, en el mismo orden.`

const tokens = (text: string) => fold(cleanText(text)).split(' ').filter(Boolean)

/** El texto que recibe el modelo: un fragmento por línea, como sale del PDF. */
export const blockText = (block: DepartmentBlock) => `Departamento: ${block.department.toUpperCase()}\n${block.fragments.join('\n')}`

/**
 * Validado en código: las filas tienen que rearmar exactamente el texto del bloque (las mismas palabras, en el mismo
 * orden, ni una de más ni de menos), sin campos vacíos, y en Montevideo la ciudad es Montevideo. Si el bloque tiene
 * justo tres celdas por fila (la tabla vino limpia), además cada campo tiene que ser su celda: así el modelo no puede
 * correr el corte entre nombre y dirección ("ESCUELA ALTA GASTRONOMÍA | PEDRO FIGARI RAMBLA…"). Si no, error: el
 * bloque no se guarda (nunca un local con nombre o dirección inventados).
 */
export function validateRows(block: DepartmentBlock, rows: BrouRow[]): RowSplit {
  const clean = rows.map((row) => ({ name: cleanText(row.name), address: cleanText(row.address), city: cleanText(row.city) }))
  if (clean.length === 0) throw new Error(`${block.department}: el modelo no devolvió filas.`)
  const empty = clean.find((row) => !row.name || !row.address || !row.city)
  if (empty) throw new Error(`${block.department}: una fila quedó con un campo vacío (${JSON.stringify(empty)}).`)
  const expected = tokens(block.fragments.join(' '))
  const got = tokens(clean.flatMap((row) => [row.name, row.address, row.city]).join(' '))
  const differs = expected.findIndex((token, index) => got[index] !== token)
  if (differs >= 0 || got.length !== expected.length) {
    const at = differs >= 0 ? differs : Math.min(expected.length, got.length)
    throw new Error(`${block.department}: las filas del modelo no rearman el texto del PDF (desde «${expected.slice(at, at + 4).join(' ')}», el modelo puso «${got.slice(at, at + 4).join(' ')}»).`)
  }
  if (block.department === 'Montevideo') {
    const other = clean.find((row) => fold(row.city) !== 'montevideo')
    if (other) throw new Error(`Montevideo: la ciudad de «${other.name}» quedó «${other.city}».`)
  }
  const aligned = block.fragments.length === clean.length * 3
  if (aligned) {
    const same = (a: string, b: string) => tokens(a).join(' ') === tokens(b).join(' ')
    clean.forEach((row, index) => {
      const [name, address, city] = block.fragments.slice(index * 3, index * 3 + 3)
      if (!same(row.name, name) || !same(row.address, address) || !same(row.city, city)) {
        throw new Error(`${block.department}: la fila «${row.name} | ${row.address} | ${row.city}» no respeta las celdas del PDF («${name} | ${address} | ${city}»).`)
      }
    })
  }
  return { rows: clean, aligned }
}

/**
 * Separación por celdas, sin modelo: el PDF marca cada celda (las de varias líneas ya vienen juntas, ver extract-pdf.ts),
 * así que si el bloque tiene justo tres celdas por fila, cada fila es nombre, dirección y ciudad. Para confiar en eso,
 * además: ninguna ciudad tiene números (una celda pegada o partida corre las columnas y una dirección cae en la ciudad),
 * y pasa la misma validación que la del modelo (en Montevideo, la ciudad es Montevideo). Si no, null: va al modelo.
 */
export function cellRows(block: DepartmentBlock): BrouRow[] | null {
  if (block.fragments.length === 0 || block.fragments.length % 3 !== 0) return null
  const rows: BrouRow[] = []
  for (let index = 0; index < block.fragments.length; index += 3) {
    const [name, address, city] = block.fragments.slice(index, index + 3)
    if (/\d/.test(city) || city.split(' ').length > 5) return null
    rows.push({ name, address, city })
  }
  try {
    return validateRows(block, rows).rows
  } catch {
    return null
  }
}

/**
 * Nombre, dirección y ciudad de cada fila: por las celdas del PDF; si un departamento no se puede separar así, con el
 * modelo de respaldo (validado, con un reintento). Sin respaldo, error (nunca un local con nombre o dirección dudosos).
 */
export function brouRowSplitter(options: { fallback?: RowSplitter } = {}): RowSplitter {
  return async (block) => {
    const rows = cellRows(block)
    if (rows) return { rows, aligned: true, costUsd: 0, cached: false, method: 'cells', modelCalls: 0 }
    if (!options.fallback) throw new Error(`${block.department}: las celdas del PDF no forman filas de nombre, dirección y ciudad, y no hay modelo configurado (AI_GATEWAY_API_KEY) para separarlas.`)
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await options.fallback(block)
        return { ...result, method: 'model', modelCalls: result.modelCalls + attempt }
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }
}

/** Separa nombre, dirección y ciudad de cada fila con el modelo barato (AI Gateway), cacheado por hash del bloque. */
export function llmRowSplitter(options: { cacheDir: string; model?: string; call?: LlmCall }): RowSplitter {
  const model = options.model ?? discountsModel()
  return async (block) => {
    const result = await cachedLlmObject({
      cacheDir: options.cacheDir,
      model,
      system: PROMPT,
      text: blockText(block),
      schema: Schema,
      validate: (output) => validateRows(block, output.rows),
      call: options.call,
      field: 'split',
    })
    return { ...result.value, costUsd: result.costUsd, cached: result.cached, method: 'model', modelCalls: result.cached ? 0 : 1 }
  }
}
