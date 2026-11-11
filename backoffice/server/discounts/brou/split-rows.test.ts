import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmCall } from '../llm-cache.ts'
import { departmentBlocks, pdfFragments, type DepartmentBlock } from './extract-pdf.ts'
import { listadoPdf, recordedSplit } from './fixtures.ts'
import { brouRowSplitter, cellRows, llmRowSplitter, validateRows, type BrouRow, type RowSplitter } from './split-rows.ts'

const blocks = async () => departmentBlocks(await pdfFragments(listadoPdf())).blocks

describe('separación de nombre y dirección', () => {
  it('la separación grabada de Haiku del PDF real pasa la validación en todos los departamentos', async () => {
    const recorded = recordedSplit()
    for (const block of await blocks()) {
      const split = validateRows(block, recorded[block.department])
      expect(split.aligned).toBe(true)
    }
    const montevideo = recorded.Montevideo
    const find = (name: string) => montevideo.filter((row) => row.name === name).map((row) => row.address)
    expect(montevideo).toHaveLength(43)
    expect(find('BURGER HOUSE 284')).toEqual(['PIEDRAS 284'])
    expect(find('BAR 36')).toEqual(['CONVENCIÓN 1152'])
    expect(find('REST FANS')).toEqual(['26 DE MARZO 3353', 'CONSTITUYENTE 1515', 'JUAN BENITO BLANCO 866'])
    expect(find('TOSCO - PATIO CERVECERO & RESTOBAR')).toEqual(['RIVERA 3040'])
    expect(recorded.Maldonado.find((row) => row.name.startsWith('ESCUELA'))).toEqual({ name: 'ESCUELA ALTA GASTRONOMÍA PEDRO FIGARI', address: 'RAMBLA WILLIMAN Y PDA 12 SN', city: 'MALDONADO' })
  })

  const block: DepartmentBlock = { department: 'Montevideo', pages: [6], fragments: ['BURGER HOUSE 284', 'PIEDRAS 284', 'MONTEVIDEO', 'BAR 36', 'CONVENCIÓN 1152', 'MONTEVIDEO'] }
  const good: BrouRow[] = [{ name: 'BURGER HOUSE 284', address: 'PIEDRAS 284', city: 'MONTEVIDEO' }, { name: 'BAR 36', address: 'CONVENCIÓN 1152', city: 'MONTEVIDEO' }]

  it('rechaza lo que no rearma el texto del PDF: palabras inventadas, corregidas, de menos o campos vacíos', () => {
    expect(validateRows(block, good)).toEqual({ rows: good, aligned: true })
    expect(() => validateRows(block, [good[0], { ...good[1], address: 'CONVENCION 1152 ESQ. CANELONES' }])).toThrow(/no rearman el texto/)
    expect(() => validateRows(block, [{ ...good[0], name: 'BURGUER HOUSE 284' }, good[1]])).toThrow(/no rearman el texto/)
    expect(() => validateRows(block, [good[0]])).toThrow(/no rearman el texto/)
    expect(() => validateRows(block, [good[0], { ...good[1], address: '' }])).toThrow(/campo vacío/)
    expect(() => validateRows(block, [])).toThrow(/no devolvió filas/)
  })

  it('con la tabla limpia, el corte tiene que respetar las celdas ("BURGER HOUSE" | "284 PIEDRAS 284" no pasa)', () => {
    expect(() => validateRows(block, [{ name: 'BURGER HOUSE', address: '284 PIEDRAS 284', city: 'MONTEVIDEO' }, good[1]])).toThrow(/no respeta las celdas/)
    // Con celdas pegadas en el PDF no se puede comparar por celda: sólo el texto (y queda avisado con aligned = false).
    const glued: DepartmentBlock = { ...block, fragments: ['BURGER HOUSE 284 PIEDRAS 284', 'MONTEVIDEO', 'BAR 36', 'CONVENCIÓN 1152', 'MONTEVIDEO'] }
    expect(validateRows(glued, good)).toEqual({ rows: good, aligned: false })
  })

  it('en Montevideo la ciudad es Montevideo', () => {
    const shifted: DepartmentBlock = { ...block, fragments: ['BAR 36', 'CONVENCIÓN', '1152 MONTEVIDEO'] }
    expect(() => validateRows(shifted, [{ name: 'BAR 36', address: 'CONVENCIÓN', city: '1152 MONTEVIDEO' }])).toThrow(/la ciudad de «BAR 36» quedó «1152 MONTEVIDEO»/)
  })

  it('por celdas: el PDF real se separa entero sin modelo, igual que la separación grabada de Haiku', async () => {
    const recorded = recordedSplit()
    for (const block of await blocks()) expect(cellRows(block)).toEqual(recorded[block.department])
  })

  it('por celdas no: si las celdas no forman filas de tres o una ciudad tiene números (columnas corridas)', () => {
    expect(cellRows({ ...block, fragments: ['BURGER HOUSE 284 PIEDRAS 284', 'MONTEVIDEO', 'BAR 36', 'CONVENCIÓN 1152', 'MONTEVIDEO'] })).toBeNull()
    expect(cellRows({ ...block, department: 'Canelones', fragments: ['BURGER HOUSE', '284', 'PIEDRAS 284', 'BAR 36', 'CONVENCIÓN 1152', 'MONTEVIDEO'] })).toBeNull()
    // En Montevideo, una ciudad que no es Montevideo también corta.
    expect(cellRows({ ...block, fragments: ['BURGER HOUSE', '284 PIEDRAS', '284', 'MONTEVIDEO', 'BAR 36', 'CONVENCIÓN 1152'] })).toBeNull()
  })

  it('el modelo sólo para el departamento que no se separa por celdas, con un reintento; sin modelo, error', async () => {
    const glued: DepartmentBlock = { ...block, fragments: ['BURGER HOUSE 284 PIEDRAS 284', 'MONTEVIDEO', 'BAR 36', 'CONVENCIÓN 1152', 'MONTEVIDEO'] }
    let calls = 0
    const fallback = vi.fn<RowSplitter>(async (input) => {
      calls += 1
      if (calls === 1) throw new Error('no rearman el texto')
      return { ...validateRows(input, good), costUsd: 0.001, cached: false, method: 'model', modelCalls: 1 }
    })
    const split = brouRowSplitter({ fallback })
    expect(await split(block)).toEqual({ rows: good, aligned: true, costUsd: 0, cached: false, method: 'cells', modelCalls: 0 })
    expect(fallback).not.toHaveBeenCalled()
    expect(await split(glued)).toMatchObject({ rows: good, aligned: false, method: 'model', modelCalls: 2, costUsd: 0.001 })
    expect(fallback).toHaveBeenCalledTimes(2)
    await expect(brouRowSplitter()(glued)).rejects.toThrow(/no hay modelo configurado/)
  })

  describe('con el modelo (falso), cacheado por hash', () => {
    let dir: string
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'brou-split-'))
    })
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    it('la segunda vez sale del cache sin pagar; una respuesta inválida no se guarda', async () => {
      const call = vi.fn<LlmCall>(async () => ({ output: { rows: good }, costUsd: 0.0015 }))
      const split = llmRowSplitter({ cacheDir: dir, model: 'anthropic/claude-haiku-5.5', call })
      expect(await split(block)).toEqual({ rows: good, aligned: true, costUsd: 0.0015, cached: false, method: 'model', modelCalls: 1 })
      expect(await split(block)).toEqual({ rows: good, aligned: true, costUsd: 0, cached: true, method: 'model', modelCalls: 0 })
      expect(call).toHaveBeenCalledTimes(1)

      const bad = vi.fn<LlmCall>(async () => ({ output: { rows: [good[0]] }, costUsd: 0.001 }))
      const other: DepartmentBlock = { ...block, department: 'Canelones', fragments: [...block.fragments, 'X', 'Y', 'Z'] }
      const badSplit = llmRowSplitter({ cacheDir: dir, model: 'anthropic/claude-haiku-5.5', call: bad })
      await expect(badSplit(other)).rejects.toThrow(/no rearman/)
      await expect(badSplit(other)).rejects.toThrow(/no rearman/)
      expect(bad).toHaveBeenCalledTimes(2)
    })
  })
})
