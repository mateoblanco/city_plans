import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { NewPlace } from '../db/schema.ts'
import { computeProminence } from './prominence.ts'
import { EMBEDDING_MODEL, savePlaces, slugify, type ExistingPlace, type PlacesStore } from './save.ts'
import { draft } from './test-fixtures.ts'

const ok = (overrides: Parameters<typeof draft>[0] = {}) => ({ source: 'llm', status: 'ok', place: draft(overrides) })
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

function fakeStore(existing: ExistingPlace[] = [], slugs: string[] = []) {
  const inserted: NewPlace[] = []
  const updated: { id: string; values: Partial<NewPlace> }[] = []
  const store: PlacesStore = {
    findByGooglePlaceIds: vi.fn(async (ids: string[]) => existing.filter((row) => ids.includes(row.googlePlaceId))),
    slugsStartingWith: async (base) => slugs.filter((slug) => slug === base || slug.startsWith(`${base}-`)),
    insert: async (row) => {
      inserted.push(row)
      return `id-${inserted.length}`
    },
    update: async (id, values) => { updated.push({ id, values }) },
  }
  return { store, inserted, updated }
}

const vectors = (texts: string[]) => Promise.resolve(texts.map((_, index) => [index, 0.5]))

describe('slugify', () => {
  it('pasa a minúsculas, saca tildes y une con guiones', () => {
    expect(slugify('Café Brasilero & Bar')).toBe('cafe-brasilero-bar')
    expect(slugify('  Ñandú  ')).toBe('nandu')
    expect(slugify('!!!')).toBe('lugar')
  })
})

describe('savePlaces', () => {
  it('inserta un lugar nuevo publicado, con slug y embedding', async () => {
    const { store, inserted } = fakeStore()
    const embed = vi.fn(vectors)

    const results = await savePlaces([ok()], { store, embed })

    expect(results).toEqual([{ googlePlaceId: 'place-1', id: 'id-1', action: 'created', embedded: true }])
    expect(embed).toHaveBeenCalledWith([draft().embeddingText])
    expect(inserted[0]).toMatchObject({
      googlePlaceId: 'place-1', slug: 'el-palenque', status: 'published', locatedIn: 'Mercado del Puerto',
      embedding: [0, 0.5], embeddingModel: EMBEDDING_MODEL, embeddingTextHash: hash(draft().embeddingText),
    })
    expect(inserted[0].embeddedAt).toBeInstanceOf(Date)
    expect(inserted[0]).not.toHaveProperty('placeFacts')
  })

  it('agrega -2, -3… si el slug ya está en la base o en el mismo lote', async () => {
    const { store, inserted } = fakeStore([], ['el-palenque'])

    await savePlaces([ok(), ok({ googlePlaceId: 'place-2' })], { store, embed: vectors })

    expect(inserted.map((row) => row.slug)).toEqual(['el-palenque-2', 'el-palenque-3'])
  })

  it('actualiza un existente sin pisar manualOverrides ni la identidad, y no re-embebe si el texto no cambió', async () => {
    const existing = { id: 'uuid-1', googlePlaceId: 'place-1', embeddingTextHash: hash(draft().embeddingText), manualOverrides: ['instagram', 'diet_vegan'], editorialMentions: 0, listedOrAwarded: false }
    const { store, inserted, updated } = fakeStore([existing])
    const embed = vi.fn(vectors)

    const results = await savePlaces([ok()], { store, embed })

    expect(results).toEqual([{ googlePlaceId: 'place-1', id: 'uuid-1', action: 'updated', embedded: false }])
    expect(embed).not.toHaveBeenCalled()
    expect(inserted).toEqual([])
    expect(updated[0].id).toBe('uuid-1')
    expect(updated[0].values).toMatchObject({ name: 'El Palenque', dietVegetarian: 'has_options', website: 'https://elpalenque.example/' })
    for (const key of ['instagram', 'dietVegan', 'googlePlaceId', 'slug', 'status', 'embedding', 'embeddingTextHash']) {
      expect(updated[0].values).not.toHaveProperty(key)
    }
  })

  it('actualiza las señales y prominence, y nunca escribe featured', async () => {
    const { store, inserted, updated } = fakeStore([{ id: 'uuid-1', googlePlaceId: 'place-1', embeddingTextHash: hash(draft().embeddingText), manualOverrides: [], editorialMentions: 0, listedOrAwarded: false }])

    await savePlaces([ok(), ok({ googlePlaceId: 'place-2' })], { store, embed: vectors })

    expect(updated[0].values).toMatchObject({ editorialMentions: 2, listedOrAwarded: true, igFollowers: 999 })
    expect(updated[0].values.prominence).toBeCloseTo(computeProminence(draft().signals))
    expect(updated[0].values).not.toHaveProperty('featured')
    expect(inserted[0]).not.toHaveProperty('featured')
  })

  it('no baja editorialMentions ni apaga listedOrAwarded al actualizar; igFollowers sí cambia', async () => {
    const existing = { id: 'uuid-1', googlePlaceId: 'place-1', embeddingTextHash: hash(draft().embeddingText), manualOverrides: [], editorialMentions: 3, listedOrAwarded: true }
    const { store, updated } = fakeStore([existing])

    await savePlaces([ok({ signals: { editorialMentions: 1, listedOrAwarded: false, igFollowers: 50 } })], { store, embed: vectors })

    expect(updated[0].values).toMatchObject({ editorialMentions: 3, listedOrAwarded: true, igFollowers: 50 })
    expect(updated[0].values.prominence).toBeCloseTo(computeProminence({ editorialMentions: 3, listedOrAwarded: true, igFollowers: 50 }))
  })

  it('acepta un resultado sin signals (anterior a la prominencia) con señales vacías', async () => {
    const { store, inserted } = fakeStore()
    const { signals: _signals, ...place } = draft()

    const results = await savePlaces([{ source: 'llm', status: 'ok', place }], { store, embed: vectors })

    expect(results[0].action).toBe('created')
    expect(inserted[0]).toMatchObject({ editorialMentions: 0, listedOrAwarded: false, igFollowers: null })
    expect(inserted[0].prominence).toBeCloseTo(computeProminence({ editorialMentions: 0, listedOrAwarded: false, igFollowers: null }))
  })

  it('re-embebe un existente cuyo texto cambió', async () => {
    const { store, updated } = fakeStore([{ id: 'uuid-1', googlePlaceId: 'place-1', embeddingTextHash: 'viejo', manualOverrides: [], editorialMentions: 0, listedOrAwarded: false }])

    const results = await savePlaces([ok()], { store, embed: vectors })

    expect(results[0]).toMatchObject({ action: 'updated', embedded: true })
    expect(updated[0].values).toMatchObject({ embedding: [0, 0.5], embeddingTextHash: hash(draft().embeddingText) })
  })

  it('si los embeddings fallan, guarda igual sin embedding y devuelve el error', async () => {
    const { store, inserted } = fakeStore()
    const embed = vi.fn().mockRejectedValue(new Error('insufficient_funds'))

    const results = await savePlaces([ok()], { store, embed })

    expect(results).toEqual([{
      googlePlaceId: 'place-1', id: 'id-1', action: 'created', embedded: false,
      error: 'No se pudieron generar los embeddings: insufficient_funds',
    }])
    expect(inserted[0]).not.toHaveProperty('embedding')
    expect(inserted[0]).not.toHaveProperty('embeddingTextHash')
  })

  it('saltea sin fuentes, sin barrio, sin nombre, inválidos y fallas de escritura; ignora status error', async () => {
    const { store } = fakeStore()
    store.insert = vi.fn(async (row: NewPlace) => {
      if (row.googlePlaceId === 'place-falla') throw new Error('duplicate key')
      return 'id-ok'
    })

    const results = await savePlaces([
      { status: 'error', error: 'No se pudo procesar el lugar.' },
      { source: 'llm', status: 'no_sources', target: { googlePlaceId: 'place-sin-fuentes' } },
      ok({ googlePlaceId: 'place-sin-barrio', neighborhoodId: null }),
      ok({ googlePlaceId: 'place-sin-nombre', name: '  ' }),
      { source: 'llm', status: 'ok', place: { ...draft({ googlePlaceId: 'place-invalido' }), tags: ['no_existe'] } },
      ok({ googlePlaceId: 'place-falla', name: 'Otro' }),
      ok(),
    ], { store, embed: vectors })

    expect(results).toEqual([
      { googlePlaceId: 'place-sin-fuentes', id: null, action: 'skipped', embedded: false, error: 'Sin fuentes: no hay datos para guardar' },
      { googlePlaceId: 'place-sin-barrio', id: null, action: 'skipped', embedded: false, error: 'Sin barrio' },
      { googlePlaceId: 'place-sin-nombre', id: null, action: 'skipped', embedded: false, error: 'Sin nombre: ninguna fuente confirma el nombre' },
      { googlePlaceId: 'place-invalido', id: null, action: 'skipped', embedded: false, error: 'Datos inválidos: tags.0' },
      { googlePlaceId: 'place-falla', id: null, action: 'skipped', embedded: false, error: 'No se pudo guardar: duplicate key' },
      { googlePlaceId: 'place-1', id: 'id-ok', action: 'created', embedded: true },
    ])
  })

  it('si un googlePlaceId se repite, guarda sólo el último', async () => {
    const { store, inserted } = fakeStore()

    const results = await savePlaces([ok({ name: 'Primero' }), ok({ name: 'Último' })], { store, embed: vectors })

    expect(results).toHaveLength(1)
    expect(inserted.map((row) => row.name)).toEqual(['Último'])
  })
})
