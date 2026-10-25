import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { NewPlace } from '../db/schema.ts'
import type { BrandRow } from './brand-key.ts'
import { applyEdit, deletePlace, EditError, planEdit, toDetail, type EditDeps, type EditRow, type EditStore } from './edit.ts'
import { placeSearchTexts } from './manual-overrides.ts'
import { parseManualOverrides } from '../../src/data/manual-overrides.ts'
import { computeProminence } from './prominence.ts'

function row(overrides: Partial<EditRow> = {}): EditRow {
  const base: EditRow = {
    id: 'uuid-1', googlePlaceId: 'place-1', name: 'El Palenque', address: 'Sarandí 675', neighborhoodId: 'ciudad_vieja', status: 'published',
    descriptionEs: 'Parrilla clásica.', descriptionEn: 'Classic grill.', locatedIn: 'Mercado del Puerto', categories: ['grill'],
    tags: ['seafood', 'terrace'], signature: ['seafood'], dishes: ['pulpo a la gallega'], highlights: [],
    dietVegan: 'unknown', dietVegetarian: 'has_options', dietGlutenFree: 'no', price: 'high', style: 'casual', iconCategory: 'grill',
    instagram: 'elpalenque', website: null, brandKey: null, featured: false, logoKey: 'logos/place-1-0a1b2c3d.webp', logoKind: 'logo',
    logoBgColor: '#ffffff', logoColor: '#c0392b', logoSource: 'instagram', igFollowers: 999, chainBranch: false, prominence: 0.6,
    embeddingTextHash: null, manualOverrides: {},
  }
  const merged = { ...base, ...overrides }
  // El hash guardado es el de los textos actuales: una edición que no toca la búsqueda no re-embebe.
  return { ...merged, embeddingTextHash: overrides.embeddingTextHash ?? createHash('sha256').update(placeSearchTexts(merged).embeddingText).digest('hex') }
}

function fakeStore(rows: EditRow[], brandRows: BrandRow[] = []) {
  const byId = new Map(rows.map((item) => [item.id, item]))
  const updates: { id: string; values: Partial<NewPlace>; touch: boolean }[] = []
  const brandUpdates: { id: string; brandKey: string | null }[] = []
  const chainUpdates: { id: string; prominence: number }[] = []
  const store: EditStore = {
    get: vi.fn(async (id: string) => byId.get(id) ?? null),
    brandKeys: async () => ['cordon-beer'],
    instagramOwners: vi.fn(async (handle: string, exceptId: string) => rows
      .filter((item) => item.id !== exceptId && item.instagram === handle)
      .map(({ id, name, neighborhoodId, brandKey }) => ({ id, name, neighborhoodId, brandKey }))),
    brandRows: vi.fn(async (handles: string[], keys: string[]) => brandRows.filter((item) => handles.includes(item.instagram ?? '') || keys.includes(item.brandKey ?? ''))),
    update: vi.fn(async (id: string, values: Partial<NewPlace>, { touch }: { touch: boolean }) => {
      updates.push({ id, values, touch })
      byId.set(id, { ...byId.get(id)!, ...values } as EditRow)
    }),
    setBrandKey: vi.fn(async (id: string, brandKey: string | null) => { brandUpdates.push({ id, brandKey }) }),
    setChainBranch: vi.fn(async (id: string, prominence: number) => { chainUpdates.push({ id, prominence }) }),
    delete: vi.fn(async (id: string) => byId.delete(id)),
  }
  return { store, updates, brandUpdates, chainUpdates }
}

function deps(store: EditStore, overrides: Partial<EditDeps> = {}): EditDeps {
  return {
    store,
    embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
    scrapeInstagram: vi.fn(async () => ({ url: 'https://www.instagram.com/palenque.uy/', name: 'Palenque', bio: '', links: [], followers: 9999 })),
    logo: { storage: { configured: true, put: vi.fn(async () => {}) }, classify: vi.fn(), model: 'anthropic/claude-haiku-5.5' },
    instagramRunUsd: 0.0026,
    archiveSnapshot: vi.fn(async (googlePlaceId: string) => `cache/extractions/deleted/${googlePlaceId}.json`),
    forget: vi.fn(),
    ...overrides,
  }
}

describe('toDetail', () => {
  it('un override de Instagram migrado del text[] viejo muestra el handle de la columna y cuenta como editado', () => {
    // La migración 0015 copió la columna sin @ ni mayúsculas; la columna puede seguir con el formato viejo.
    const place = toDetail(row({ instagram: '@ElPalenque', manualOverrides: parseManualOverrides({ instagram: 'elpalenque' }) }))
    expect(place.instagram).toBe('elpalenque')
    expect(place.editedFields).toEqual(['instagram'])
  })
})

describe('planEdit', () => {
  it('nombre o tags: textos de búsqueda y embedding, con costo', async () => {
    const { store } = fakeStore([row()])
    const plan = await planEdit(row(), { name: 'Palenque', tags: ['terrace'] }, deps(store))
    expect(plan.changed).toEqual(['name', 'tags'])
    expect(plan.steps.map((step) => step.id)).toEqual(['search_texts', 'embedding'])
    expect(plan.totalUsd).toBeGreaterThan(0)
    expect(plan.totalUsd).toBeLessThan(0.0001)
  })

  it('el precio, el ícono, la web y el destacado sólo escriben la columna, sin costo', async () => {
    const { store } = fakeStore([row()])
    const plan = await planEdit(row(), { price: 'low', iconCategory: 'octopus', website: 'https://palenque.uy/', featured: true }, deps(store))
    expect(plan).toMatchObject({ changed: ['price', 'iconCategory', 'website', 'featured'], totalUsd: 0, steps: [{ id: 'column_only' }] })
  })

  it('el Instagram: Apify, el logo, la prominencia y la marca; avisa si otro lugar ya lo tiene', async () => {
    const other = row({ id: 'uuid-2', name: 'El Palenque Pocitos', instagram: 'palenque.uy', neighborhoodId: 'pocitos' })
    const { store } = fakeStore([row(), other])
    const plan = await planEdit(row(), { instagram: 'palenque.uy' }, deps(store))
    expect(plan.steps.map((step) => step.id)).toEqual(['instagram_profile', 'logo_classification', 'prominence', 'brand_keys'])
    expect(plan.steps[0].costUsd).toBe(0.0026)
    expect(plan.instagramOwners).toEqual([{ id: 'uuid-2', name: 'El Palenque Pocitos', neighborhoodId: 'pocitos', brandKey: null }])
  })

  it('con un logo subido a mano no clasifica la foto de Instagram', async () => {
    const logo = { key: 'logos/place-1-ffffffff.webp', kind: 'logo' as const, bgColor: null, color: null, source: 'manual' as const, fetchedAt: '2026-10-20T12:00:00.000Z' }
    const edited = row({ manualOverrides: { logo } })
    const { store } = fakeStore([edited])
    const plan = await planEdit(edited, { instagram: 'palenque.uy' }, deps(store))
    expect(plan.steps.map((step) => step.id)).not.toContain('logo_classification')
  })
})

describe('applyEdit', () => {
  it('sacar un tag: guarda la diferencia, lo saca de signature, regenera textos y embedding', async () => {
    const { store, updates } = fakeStore([row()])
    const d = deps(store)

    const { place, warnings } = await applyEdit('uuid-1', { tags: ['terrace', 'italian'] }, d)

    expect(warnings).toEqual([])
    const values = updates[0].values
    expect(values).toMatchObject({ tags: ['terrace', 'italian'], signature: [], manualOverrides: { tags: { add: ['italian'], remove: ['seafood'] } } })
    expect(values.keywordText).toContain('Italiana')
    expect(values.keywordText).not.toContain('mariscos')
    expect(d.embed).toHaveBeenCalledWith([values.embeddingText])
    expect(values).toMatchObject({ embedding: [0.1, 0.2], embeddingTextHash: createHash('sha256').update(values.embeddingText!).digest('hex') })
    expect(updates[0].touch).toBe(true)
    expect(place.editedFields).toEqual(['tags'])
  })

  it('el precio no paga embedding ni toca los textos', async () => {
    const { store, updates } = fakeStore([row()])
    const d = deps(store)
    await applyEdit('uuid-1', { price: 'low' }, d)
    expect(d.embed).not.toHaveBeenCalled()
    expect(updates[0].values).toEqual({ price: 'low', manualOverrides: { price: 'low' } })
  })

  it('sólo el destacado no cambia updatedAt ni suma un override', async () => {
    const { store, updates } = fakeStore([row()])
    await applyEdit('uuid-1', { featured: true }, deps(store))
    expect(updates[0]).toMatchObject({ values: { featured: true, manualOverrides: {} }, touch: false })
  })

  it('si falla el embedding guarda igual y avisa', async () => {
    const { store, updates } = fakeStore([row()])
    const { warnings } = await applyEdit('uuid-1', { name: 'Palenque' }, deps(store, { embed: vi.fn().mockRejectedValue(new Error('gateway')) }))
    expect(updates[0].values).toMatchObject({ name: 'Palenque', manualOverrides: { name: 'Palenque' } })
    expect(updates[0].values).not.toHaveProperty('embedding')
    expect(warnings[0]).toContain('no se pudo generar el embedding: gateway')
  })

  it('un Instagram que ya tiene otro lugar pide confirmación; confirmado, agrupa las dos sucursales', async () => {
    const other = row({ id: 'uuid-2', name: 'El Palenque Pocitos', instagram: 'palenque.uy' })
    const { store, updates, brandUpdates } = fakeStore([row(), other], [
      { id: 'uuid-2', name: 'El Palenque Pocitos', neighborhoodId: 'pocitos', instagram: 'palenque.uy', chainBranch: false, brandKey: null },
    ])
    const d = deps(store)

    const refused = await applyEdit('uuid-1', { instagram: 'palenque.uy' }, d).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(EditError)
    expect(refused).toMatchObject({ code: 'INSTAGRAM_IN_USE', status: 409, owners: [{ id: 'uuid-2', name: 'El Palenque Pocitos' }] })
    expect(d.scrapeInstagram).not.toHaveBeenCalled()
    expect(updates).toEqual([])

    await applyEdit('uuid-1', { instagram: 'palenque.uy' }, d, { confirmSharedInstagram: true })
    expect(d.scrapeInstagram).toHaveBeenCalledWith('https://www.instagram.com/palenque.uy/')
    expect(updates[0].values).toMatchObject({
      instagram: 'palenque.uy', igFollowers: 9999, prominence: computeProminence({ igFollowers: 9999 }),
      brandKey: 'el-palenque', manualOverrides: { instagram: 'palenque.uy' },
    })
    expect(brandUpdates).toEqual([{ id: 'uuid-2', brandKey: 'el-palenque' }])
  })

  it('cambiar el Instagram no pisa un logo subido a mano y no re-extrae', async () => {
    const logo = { key: 'logos/place-1-ffffffff.webp', kind: 'logo' as const, bgColor: null, color: null, source: 'manual' as const, fetchedAt: '2026-10-20T12:00:00.000Z' }
    const { store, updates } = fakeStore([row({ manualOverrides: { logo }, logoKey: logo.key, logoSource: 'manual' })])
    const d = deps(store, { scrapeInstagram: vi.fn(async () => ({ url: '', name: '', bio: '', links: [], followers: 10, profilePicUrl: 'https://cdn.example/x.jpg' })) })
    await applyEdit('uuid-1', { instagram: 'palenque.uy' }, d)
    expect(updates[0].values).not.toHaveProperty('logoKey')
    expect(d.logo.classify).not.toHaveBeenCalled()
  })

  it('sin foto de perfil, deja el logo anterior y avisa', async () => {
    const { store, updates } = fakeStore([row()])
    const { warnings } = await applyEdit('uuid-1', { instagram: 'palenque.uy' }, deps(store))
    expect(updates[0].values).not.toHaveProperty('logoKey')
    expect(warnings).toContain('Logo: el perfil no tiene foto; queda el anterior.')
  })

  it('un perfil que no existe o un error de Apify no guardan nada', async () => {
    const { store, updates } = fakeStore([row()])
    await expect(applyEdit('uuid-1', { instagram: 'noexiste', name: 'Otro' }, deps(store, { scrapeInstagram: vi.fn(async () => null) })))
      .rejects.toMatchObject({ code: 'INSTAGRAM_NOT_FOUND', status: 422 })
    await expect(applyEdit('uuid-1', { instagram: 'palenque.uy' }, deps(store, { scrapeInstagram: vi.fn().mockRejectedValue(new Error('timeout')) })))
      .rejects.toMatchObject({ code: 'INSTAGRAM_PROVIDER_ERROR', status: 502 })
    expect(updates).toEqual([])
  })

  it('"No tiene Instagram": sin seguidores, prominencia neutra y el override en null', async () => {
    const { store, updates } = fakeStore([row()])
    const d = deps(store)
    await applyEdit('uuid-1', { instagram: null }, d)
    expect(d.scrapeInstagram).not.toHaveBeenCalled()
    expect(updates[0].values).toMatchObject({ instagram: null, igFollowers: null, prominence: 0.5, manualOverrides: { instagram: null } })
  })

  it('brand_key: se escribe y queda bloqueado, sin recalcular las otras sucursales', async () => {
    const { store, updates, brandUpdates } = fakeStore([row()])
    await applyEdit('uuid-1', { brandKey: 'palenque' }, deps(store))
    expect(updates[0].values).toEqual({ brandKey: 'palenque', manualOverrides: { brand_key: 'palenque' } })
    expect(brandUpdates).toEqual([])
  })

  it('brand_key compartida con otro lugar: los dos quedan como sucursales de cadena', async () => {
    const other: BrandRow = { id: 'uuid-2', name: 'Plaza de Chueca', neighborhoodId: 'pocitos', instagram: 'plazadechueca', chainBranch: false, brandKey: 'plaza-de-chueca', igFollowers: 20_000 }
    const { store, updates, chainUpdates } = fakeStore([row({ chainBranch: false })], [other])
    await applyEdit('uuid-1', { brandKey: 'plaza-de-chueca' }, deps(store))
    expect(updates[0].values).toMatchObject({ brandKey: 'plaza-de-chueca', chainBranch: true, prominence: computeProminence({ igFollowers: row().igFollowers, chainBranch: true }) })
    expect(chainUpdates).toEqual([{ id: 'uuid-2', prominence: computeProminence({ igFollowers: 20_000, chainBranch: true }) }])
  })

  it('un lugar que no existe es 404', async () => {
    const { store } = fakeStore([])
    await expect(applyEdit('uuid-9', { price: 'low' }, deps(store))).rejects.toMatchObject({ code: 'NOT_FOUND_ERROR', status: 404 })
  })
})

describe('deletePlace', () => {
  it('borra, mueve el snapshot, olvida la memoria del server y reagrupa la otra sucursal', async () => {
    const group: BrandRow[] = [
      { id: 'uuid-1', name: 'Cordón Beer', neighborhoodId: 'cordon', instagram: 'cordonbeer', chainBranch: false, brandKey: 'cordon-beer' },
      { id: 'uuid-2', name: 'Cordón Beer Pocitos', neighborhoodId: 'pocitos', instagram: 'cordonbeer', chainBranch: false, brandKey: 'cordon-beer' },
    ]
    const { store, brandUpdates } = fakeStore([row({ instagram: 'cordonbeer', brandKey: 'cordon-beer' })], group)
    const d = deps(store)

    const result = await deletePlace('uuid-1', d)

    expect(store.delete).toHaveBeenCalledWith('uuid-1')
    expect(d.archiveSnapshot).toHaveBeenCalledWith('place-1')
    expect(d.forget).toHaveBeenCalledWith('place-1')
    // Sola y sin chain_branch, ya no es una marca con sucursales.
    expect(brandUpdates).toEqual([{ id: 'uuid-2', brandKey: null }])
    // chain_branch no se toca al borrar: si estaba marcada, queda.
    expect(store.update).not.toHaveBeenCalled()
    expect(store.setChainBranch).not.toHaveBeenCalled()
    expect(result).toEqual({
      id: 'uuid-1', snapshot: 'cache/extractions/deleted/place-1.json', logoKey: 'logos/place-1-0a1b2c3d.webp',
      brandKeys: [{ id: 'uuid-2', name: 'Cordón Beer Pocitos', brandKey: null }], warnings: [],
    })
  })

  it('no toca una marca editada a mano; si no puede mover el snapshot, borra igual y avisa', async () => {
    const group: BrandRow[] = [
      { id: 'uuid-1', name: 'Cordón Beer', neighborhoodId: 'cordon', instagram: 'cordonbeer', chainBranch: false, brandKey: 'cordon-beer' },
      { id: 'uuid-2', name: 'Cordón Beer Pocitos', neighborhoodId: 'pocitos', instagram: 'cordonbeer', chainBranch: false, brandKey: 'cordon-beer', locked: true },
    ]
    const { store, brandUpdates } = fakeStore([row({ instagram: 'cordonbeer', brandKey: 'cordon-beer' })], group)
    const result = await deletePlace('uuid-1', deps(store, { archiveSnapshot: vi.fn().mockRejectedValue(new Error('EACCES')) }))
    expect(brandUpdates).toEqual([])
    expect(result).toMatchObject({ snapshot: null, warnings: ['No se pudo mover el snapshot de cache/extractions: EACCES'] })
  })
})
