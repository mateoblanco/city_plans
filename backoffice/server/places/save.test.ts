import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { NewPlace } from '../db/schema.ts'
import { computeProminence } from './prominence.ts'
import { EMBEDDING_MODEL, pipelineStatus, savePlaces, slugify, type ExistingPlace, type PlacesStore } from './save.ts'
import { draft } from './test-fixtures.ts'
import type { BrandRow } from './brand-key.ts'
import type { ManualOverrides } from '../../src/data/manual-overrides.ts'

const ok = (overrides: Parameters<typeof draft>[0] = {}) => ({ source: 'llm', status: 'ok', place: draft(overrides) })
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

function fakeStore(existing: ExistingPlace[] = [], slugs: string[] = [], saved: BrandRow[] = []) {
  const inserted: NewPlace[] = []
  const updated: { id: string; values: Partial<NewPlace> }[] = []
  const brandUpdates: { id: string; brandKey: string | null }[] = []
  const chainUpdates: { id: string; prominence: number }[] = []
  const store: PlacesStore = {
    findByGooglePlaceIds: vi.fn(async (ids: string[]) => existing.filter((row) => ids.includes(row.googlePlaceId))),
    slugsStartingWith: async (base) => slugs.filter((slug) => slug === base || slug.startsWith(`${base}-`)),
    insert: async (row) => {
      inserted.push(row)
      return `id-${inserted.length}`
    },
    update: async (id, values) => { updated.push({ id, values }) },
    brandRows: async (handles, brandKeys) =>
      saved.filter((row) => handles.includes(row.instagram?.toLowerCase() ?? '') || brandKeys.includes(row.brandKey ?? '')),
    setBrandKey: async (id, brandKey) => { brandUpdates.push({ id, brandKey }) },
    setChainBranch: async (id, prominence) => { chainUpdates.push({ id, prominence }) },
  }
  return { store, inserted, updated, brandUpdates, chainUpdates }
}

const vectors = (texts: string[]) => Promise.resolve(texts.map((_, index) => [index, 0.5]))

describe('slugify', () => {
  it('pasa a minúsculas, saca tildes y une con guiones', () => {
    expect(slugify('Café Brasilero & Bar')).toBe('cafe-brasilero-bar')
    expect(slugify('  Ñandú  ')).toBe('nandu')
    expect(slugify('!!!')).toBe('lugar')
  })
})

describe('pipelineStatus', () => {
  it('nuevo: review con motivos, published sin', () => {
    expect(pipelineStatus(undefined, ['not_open_yet'])).toBe('review')
    expect(pipelineStatus(undefined, [])).toBe('published')
  })

  it('al actualizar mueve published ↔ review, pero no toca draft, hidden ni un status manual', () => {
    expect(pipelineStatus({ status: 'published', manualOverrides: {} }, ['no_place_facts'])).toBe('review')
    expect(pipelineStatus({ status: 'review', manualOverrides: {} }, [])).toBe('published')
    expect(pipelineStatus({ status: 'hidden', manualOverrides: {} }, [])).toBeUndefined()
    expect(pipelineStatus({ status: 'draft', manualOverrides: {} }, ['not_open_yet'])).toBeUndefined()
    expect(pipelineStatus({ status: 'published', manualOverrides: { status: 'published' } }, ['not_open_yet'])).toBeUndefined()
  })
})

describe('savePlaces', () => {
  it('guarda en review los lugares con motivos, con los motivos, y publica los demás', async () => {
    const { store, inserted } = fakeStore()

    await savePlaces([ok({ reviewReasons: ['not_open_yet'] }), ok({ googlePlaceId: 'place-2' })], { store, embed: vectors })

    expect(inserted.map((row) => [row.googlePlaceId, row.status, row.reviewReasons])).toEqual([
      ['place-1', 'review', ['not_open_yet']],
      ['place-2', 'published', []],
    ])
  })

  it('al actualizar cambia el status según los motivos, salvo hidden o un status puesto a mano', async () => {
    const existing = (googlePlaceId: string, status: ExistingPlace['status'], manualOverrides: ManualOverrides = {}) =>
      ({ id: `uuid-${googlePlaceId}`, googlePlaceId, embeddingTextHash: hash(draft().embeddingText), manualOverrides, status })
    const { store, updated } = fakeStore([
      existing('a', 'published'), existing('b', 'review'), existing('c', 'hidden'), existing('d', 'published', { status: 'published' }),
    ])

    await savePlaces([
      ok({ googlePlaceId: 'a', reviewReasons: ['bar_without_drinks'] }),
      ok({ googlePlaceId: 'b' }),
      ok({ googlePlaceId: 'c', reviewReasons: ['not_open_yet'] }),
      ok({ googlePlaceId: 'd', reviewReasons: ['not_open_yet'] }),
    ], { store, embed: vectors })

    const statusOf = (id: string) => updated.find((entry) => entry.id === `uuid-${id}`)?.values.status
    expect(statusOf('a')).toBe('review')
    expect(statusOf('b')).toBe('published')
    expect(statusOf('c')).toBeUndefined()
    expect(statusOf('d')).toBeUndefined()
    expect(updated.find((entry) => entry.id === 'uuid-d')?.values.reviewReasons).toEqual(['not_open_yet'])
  })

  it('un motivo que no está en el catálogo invalida sólo ese lugar', async () => {
    const { store, inserted } = fakeStore()

    const results = await savePlaces([
      { source: 'llm', status: 'ok', place: { ...draft({ googlePlaceId: 'raro' }), reviewReasons: ['cuisine_unmentioned'] } },
      ok({ googlePlaceId: 'place-2' }),
    ], { store, embed: vectors })

    expect(results[0]).toMatchObject({ googlePlaceId: 'raro', action: 'skipped' })
    expect(results[0].error).toContain('reviewReasons')
    expect(inserted.map((row) => row.googlePlaceId)).toEqual(['place-2'])
  })

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
    const existing = { id: 'uuid-1', googlePlaceId: 'place-1', embeddingTextHash: hash(draft().embeddingText), manualOverrides: { instagram: 'palenque.uy', price: 'moderate' as const }, status: 'published' as const }
    const { store, inserted, updated } = fakeStore([existing])
    const embed = vi.fn(vectors)

    const results = await savePlaces([ok()], { store, embed })

    expect(results).toEqual([{ googlePlaceId: 'place-1', id: 'uuid-1', action: 'updated', embedded: false }])
    expect(embed).not.toHaveBeenCalled()
    expect(inserted).toEqual([])
    expect(updated[0].id).toBe('uuid-1')
    // Los campos editados a mano quedan con su valor; el resto, con lo del pipeline.
    expect(updated[0].values).toMatchObject({ name: 'El Palenque', dietVegetarian: 'has_options', website: 'https://elpalenque.example/', instagram: 'palenque.uy', price: 'moderate' })
    for (const key of ['manualOverrides', 'googlePlaceId', 'slug', 'status', 'embedding', 'embeddingTextHash']) {
      expect(updated[0].values).not.toHaveProperty(key)
    }
  })

  it('un Instagram cargado a mano queda como override con su valor y pisa al anterior; uno del pipeline, no', async () => {
    const manual = (handle: string | null) => ({ ...ok({ contact: { ...draft().contact, instagram: handle } }), review: { instagramManual: { handle } } })
    const fresh = fakeStore()
    await savePlaces([manual('palenque.uy')], { store: fresh.store, embed: vectors })
    expect(fresh.inserted[0]).toMatchObject({ instagram: 'palenque.uy', manualOverrides: { instagram: 'palenque.uy' } })

    const existing = (manualOverrides: ManualOverrides) => ({ id: 'uuid-1', googlePlaceId: 'place-1', embeddingTextHash: hash(draft().embeddingText), manualOverrides, status: 'published' as const })
    const unlocked = fakeStore([existing({ diet_vegan: 'no' })])
    await savePlaces([manual(null)], { store: unlocked.store, embed: vectors })
    expect(unlocked.updated[0].values).toMatchObject({ instagram: null, manualOverrides: { diet_vegan: 'no', instagram: null } })

    const locked = fakeStore([existing({ instagram: 'elpalenque' })])
    await savePlaces([manual('otro.palenque')], { store: locked.store, embed: vectors })
    expect(locked.updated[0].values).toMatchObject({ instagram: 'otro.palenque', manualOverrides: { instagram: 'otro.palenque' } })

    // El handle sale de la revisión aunque el post-proceso lo haya sacado del contacto (Instagram compartido).
    const shared = fakeStore([existing({})])
    await savePlaces([{ ...manual('miradoruy'), place: { ...draft(), contact: { ...draft().contact, instagram: null } } }], { store: shared.store, embed: vectors })
    expect(shared.updated[0].values).toMatchObject({ instagram: 'miradoruy', manualOverrides: { instagram: 'miradoruy' } })

    // El mismo handle que ya estaba: no hace falta reescribir manual_overrides.
    const same = fakeStore([existing({ instagram: 'elpalenque' })])
    await savePlaces([manual('elpalenque')], { store: same.store, embed: vectors })
    expect(same.updated[0].values).not.toHaveProperty('manualOverrides')

    // Un reproceso sin Instagram manual no lo pisa.
    const reprocess = fakeStore([existing({ instagram: 'elpalenque' })])
    await savePlaces([ok({ contact: { ...draft().contact, instagram: 'pipeline' } })], { store: reprocess.store, embed: vectors })
    expect(reprocess.updated[0].values).toMatchObject({ instagram: 'elpalenque' })
  })

  describe('campos editados a mano', () => {
    const existing = (manualOverrides: ManualOverrides) =>
      ({ id: 'uuid-1', googlePlaceId: 'place-1', embeddingTextHash: hash(draft().embeddingText), manualOverrides, status: 'published' as const })
    const manualLogo = { key: 'logos/place-1-ffffffff.webp', kind: 'logo' as const, bgColor: '#000000', color: '#ffffff', source: 'manual' as const, fetchedAt: '2026-10-20T12:00:00.000Z' }

    it('una re-extracción no pisa el nombre, el style, el ícono ni el logo subido a mano', async () => {
      const { store, updated } = fakeStore([existing({ name: 'Palenque', style: 'cuidado', icon_category: 'octopus', logo: manualLogo })])

      await savePlaces([ok()], { store, embed: vectors })

      expect(updated[0].values).toMatchObject({
        name: 'Palenque', style: 'cuidado', iconCategory: 'octopus',
        logoKey: manualLogo.key, logoSource: 'manual', logoBgColor: '#000000', logoFetchedAt: new Date(manualLogo.fetchedAt),
      })
    })

    it('un tag sacado a mano no vuelve, uno agregado queda y uno nuevo del pipeline entra; signature sin el sacado', async () => {
      const { store, updated } = fakeStore([existing({ tags: { add: ['terrace'], remove: ['seafood'] } })])

      await savePlaces([ok({ tags: ['seafood', 'classic_cocktails'], signature: ['seafood', 'classic_cocktails'] })], { store, embed: vectors })

      expect(updated[0].values.tags).toEqual(['classic_cocktails', 'terrace'])
      expect(updated[0].values.signature).toEqual(['classic_cocktails'])
    })

    it('con un override que entra en la búsqueda, arma los textos con los valores finales y re-embebe', async () => {
      const { store, updated } = fakeStore([existing({ name: 'Palenque Bodegón', tags: { add: [], remove: ['seafood'] } })])
      const embed = vi.fn(vectors)

      const [result] = await savePlaces([ok()], { store, embed })

      const values = updated[0].values
      expect(values.embeddingText).toContain('Palenque Bodegón')
      expect(values.keywordText).not.toContain('mariscos')
      expect(embed).toHaveBeenCalledWith([values.embeddingText])
      expect(values.embeddingTextHash).toBe(hash(values.embeddingText!))
      expect(result).toMatchObject({ action: 'updated', embedded: true })
    })

    it('sin overrides de búsqueda usa los textos del borrador', async () => {
      const { store, updated } = fakeStore([existing({ price: 'low', website: null })])
      await savePlaces([ok()], { store, embed: vectors })
      expect(updated[0].values).toMatchObject({ embeddingText: draft().embeddingText, price: 'low', website: null })
    })

    it('un brand_key editado a mano no lo cambia el agrupado', async () => {
      const saved: BrandRow = { id: 'uuid-a', name: 'El Palenque Pocitos', neighborhoodId: 'pocitos', instagram: 'elpalenque', chainBranch: false, brandKey: 'palenque-b' }
      const { store, updated, brandUpdates } = fakeStore([existing({ brand_key: 'palenque' })], [], [saved])
      await savePlaces([ok()], { store, embed: vectors })
      // La columna ya tiene el valor editado: no se reescribe, y la otra sucursal con el mismo Instagram lo toma.
      expect(updated[0].values).not.toHaveProperty('brandKey')
      expect(brandUpdates).toEqual([{ id: 'uuid-a', brandKey: 'palenque' }])
    })
  })

  it('actualiza los seguidores y prominence, y nunca escribe featured', async () => {
    const { store, inserted, updated } = fakeStore([{ id: 'uuid-1', googlePlaceId: 'place-1', embeddingTextHash: hash(draft().embeddingText), manualOverrides: {}, status: 'published' as const }])

    // Otro Instagram: con el mismo, los dos serían sucursales de una cadena.
    await savePlaces([ok(), ok({ googlePlaceId: 'place-2', contact: { ...draft().contact, instagram: 'otro' } })], { store, embed: vectors })

    expect(updated[0].values).toMatchObject({ igFollowers: 999 })
    expect(updated[0].values.prominence).toBeCloseTo(computeProminence(draft().signals))
    expect(updated[0].values).not.toHaveProperty('featured')
    expect(inserted[0]).not.toHaveProperty('featured')
  })

  it('una sucursal de cadena (sin seguidores) pasa a prominence neutra al actualizar', async () => {
    const existing = { id: 'uuid-1', googlePlaceId: 'place-1', embeddingTextHash: hash(draft().embeddingText), manualOverrides: {}, status: 'published' as const }
    const { store, updated } = fakeStore([existing])

    await savePlaces([ok({ signals: { igFollowers: null, chainBranch: false } })], { store, embed: vectors })

    expect(updated[0].values).toMatchObject({ igFollowers: null, prominence: 0.5 })
  })

  it('guarda la categoría de ícono al insertar y la actualiza al reprocesar; sin ella, null', async () => {
    const existing = { id: 'uuid-1', googlePlaceId: 'place-1', embeddingTextHash: hash(draft().embeddingText), manualOverrides: {}, status: 'published' as const }
    const { store, inserted, updated } = fakeStore([existing])
    const { iconCategory: _icon, ...legacy } = draft({ googlePlaceId: 'place-3' })

    await savePlaces([ok({ iconCategory: 'octopus' }), ok({ googlePlaceId: 'place-2', iconCategory: 'wine' }), { source: 'llm', status: 'ok', place: legacy }], { store, embed: vectors })

    expect(updated[0].values.iconCategory).toBe('octopus')
    expect(inserted.map((row) => row.iconCategory)).toEqual(['wine', null])
  })

  it('guarda el style y, en un resultado de antes del campo, null', async () => {
    const { store, inserted } = fakeStore()
    const { style: _style, ...legacy } = draft({ googlePlaceId: 'place-3' })

    await savePlaces([ok({ googlePlaceId: 'place-2', style: 'cuidado' }), { source: 'llm', status: 'ok', place: legacy }], { store, embed: vectors })

    expect(inserted.map((row) => row.style)).toEqual(['cuidado', null])
  })

  it('acepta un resultado sin signals (anterior a la prominencia), y con las claves editoriales viejas', async () => {
    const { store, inserted } = fakeStore()
    const { signals: _signals, ...place } = draft()

    const results = await savePlaces([{ source: 'llm', status: 'ok', place }], { store, embed: vectors })

    expect(results[0].action).toBe('created')
    expect(inserted[0]).toMatchObject({ igFollowers: null, prominence: 0.5 })

    const legacy = { ...place, googlePlaceId: 'place-2', signals: { editorialMentions: 3, listedOrAwarded: true, igFollowers: 999 } }
    await savePlaces([{ source: 'llm', status: 'ok', place: legacy }], { store, embed: vectors })
    expect(inserted[1]).toMatchObject({ igFollowers: 999, prominence: expect.closeTo(0.6) })
    expect(inserted[1]).not.toHaveProperty('editorialMentions')
  })

  it('re-embebe un existente cuyo texto cambió', async () => {
    const { store, updated } = fakeStore([{ id: 'uuid-1', googlePlaceId: 'place-1', embeddingTextHash: 'viejo', manualOverrides: {}, status: 'published' as const }])

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

  describe('brand_key', () => {
    const contact = (instagram: string | null) => ({ ...draft().contact, instagram })
    const savedRow = (overrides: Partial<BrandRow> & { id: string }): BrandRow =>
      ({ name: 'Cordón Beer', neighborhoodId: 'cordon', instagram: 'cordonbeer', chainBranch: false, brandKey: null, ...overrides })

    it('sin otro lugar con el mismo Instagram ni cadena, queda null', async () => {
      const { store, inserted } = fakeStore()
      await savePlaces([ok()], { store, embed: vectors })
      expect(inserted[0].brandKey).toBeNull()
    })

    it('un Instagram que ya tenía un lugar forma la marca y actualiza también al guardado', async () => {
      const { store, inserted, brandUpdates } = fakeStore([], [], [savedRow({ id: 'uuid-a' })])
      await savePlaces([ok({ name: 'Cordón Beer Pocitos', contact: contact('@CordonBeer') })], { store, embed: vectors })
      expect(inserted[0].brandKey).toBe('cordon-beer')
      expect(brandUpdates).toEqual([{ id: 'uuid-a', brandKey: 'cordon-beer' }])
    })

    it('reusa la key que ya tenía la marca', async () => {
      const { store, inserted, brandUpdates } = fakeStore([], [], [savedRow({ id: 'uuid-a', brandKey: 'cordon-beer-bar' }), savedRow({ id: 'uuid-b', brandKey: 'cordon-beer-bar' })])
      await savePlaces([ok({ name: 'Cordón Beer Malvín', contact: contact('cordonbeer') })], { store, embed: vectors })
      expect(inserted[0].brandKey).toBe('cordon-beer-bar')
      expect(brandUpdates).toEqual([])
    })

    it('una sucursal de cadena sin Instagram toma el slug de la marca', async () => {
      const { store, inserted } = fakeStore()
      await savePlaces([ok({ name: 'La Pasiva Shopping Tres Cruces', contact: contact(null), signals: { igFollowers: null, chainBranch: true } })], { store, embed: vectors })
      expect(inserted[0].brandKey).toBe('la-pasiva')
    })

    it('dos lugares con la misma brand_key quedan como sucursales de cadena, también el ya guardado', async () => {
      const { store, inserted, chainUpdates } = fakeStore([], [], [savedRow({ id: 'uuid-a', igFollowers: 10_000 })])
      await savePlaces([ok({ name: 'Cordón Beer Pocitos', contact: contact('cordonbeer'), signals: { igFollowers: 10_000, chainBranch: false } })], { store, embed: vectors })
      expect(inserted[0]).toMatchObject({ brandKey: 'cordon-beer', chainBranch: true, prominence: computeProminence({ igFollowers: 10_000, chainBranch: true }) })
      expect(chainUpdates).toEqual([{ id: 'uuid-a', prominence: computeProminence({ igFollowers: 10_000, chainBranch: true }) }])
    })

    it('cuenta los guardados con la misma key aunque no compartan Instagram, y no repite a los que ya son cadena', async () => {
      const { store, inserted, chainUpdates } = fakeStore([], [], [
        savedRow({ id: 'uuid-a', brandKey: 'cordon-beer', chainBranch: true, igFollowers: 5_000 }),
        savedRow({ id: 'uuid-b', instagram: 'otro', brandKey: 'cordon-beer', igFollowers: null }),
      ])
      await savePlaces([ok({ name: 'Cordón Beer Malvín', contact: contact('cordonbeer') })], { store, embed: vectors })
      expect(inserted[0]).toMatchObject({ brandKey: 'cordon-beer', chainBranch: true })
      expect(chainUpdates).toEqual([{ id: 'uuid-b', prominence: computeProminence({ igFollowers: null, chainBranch: true }) }])
    })

    it('sin otro lugar de la marca no cambia chain_branch', async () => {
      const { store, inserted, chainUpdates } = fakeStore()
      await savePlaces([ok({ signals: { igFollowers: 10_000, chainBranch: false } })], { store, embed: vectors })
      expect(inserted[0].chainBranch).toBe(false)
      expect(chainUpdates).toEqual([])
    })

    it('si no se puede leer la base, guarda igual sin tocar brand_key', async () => {
      const { store, inserted } = fakeStore()
      store.brandRows = () => Promise.reject(new Error('timeout'))
      const [result] = await savePlaces([ok()], { store, embed: vectors })
      expect(result.action).toBe('created')
      expect(inserted[0]).not.toHaveProperty('brandKey')
    })
  })
})
