import { describe, expect, it, vi } from 'vitest'
import type { GuideDetail, GuideInput, GuideIntro, GuideSummary } from '../../src/types/guides.ts'
import { createApp } from '../app.ts'
import { contentChanged, filterGuides } from './routes.ts'
import type { GuidesStore, PlaceRef } from './store.ts'

const ids = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-00000000000${n}`)
const PLACES: PlaceRef[] = ids.map((id, index) => ({ id, name: `Lugar ${index + 1}`, status: index === 4 ? 'review' : 'published', neighborhoodId: 'CORDON' }))

const input = (overrides: Partial<GuideInput> = {}): GuideInput => ({
  slug: 'cafes-donde-nadie-te-apura',
  city: 'montevideo',
  neighborhoodId: 'CORDON',
  group: 'cafes',
  title: 'Cafés',
  seoTitle: 'Cafés en Cordón',
  seoDescription: 'Cafés.',
  intro: 'Intro.',
  featured: false,
  color: '#FF8E00',
  places: ids.slice(0, 4).map((placeId) => ({ placeId, text: 'Texto' })),
  ...overrides,
})

/** Store en memoria con las mismas reglas que el de SQL (lo que las rutas necesitan). */
function memoryStore() {
  const guides = new Map<string, GuideDetail>()
  const intros: GuideIntro[] = []
  let next = 0
  const saves: { id?: string; touchContent: boolean }[] = []
  const store: GuidesStore = {
    list: async () => [...guides.values()].map((guide) => ({ ...guide, placeCount: guide.places.length, warnings: [] }) as unknown as GuideSummary),
    get: async (id) => guides.get(id) ?? null,
    slugTaken: async (city, slug, exceptId) => [...guides.values()].some((guide) => guide.city === city && guide.slug === slug && guide.id !== exceptId),
    places: async (wanted) => PLACES.filter((place) => wanted.includes(place.id)),
    save: async (guide, options) => {
      saves.push(options)
      const id = options.id ?? `g${++next}`
      const before = guides.get(id)
      guides.set(id, {
        ...guide,
        id,
        status: before?.status ?? 'draft',
        aiCostUsd: before?.aiCostUsd ?? 0,
        publishedAt: before?.publishedAt ?? null,
        contentUpdatedAt: options.touchContent || !before ? 'nuevo' : before.contentUpdatedAt,
        places: guide.places.map((place) => {
          const ref = PLACES.find((candidate) => candidate.id === place.placeId)!
          return { ...place, name: ref.name, slug: ref.name, neighborhoodId: ref.neighborhoodId, status: ref.status }
        }),
      })
      return id
    },
    setStatus: async (id, status) => {
      const guide = guides.get(id)
      if (!guide) return false
      guides.set(id, { ...guide, status, publishedAt: guide.publishedAt ?? (status === 'published' ? 'ahora' : null) })
      return true
    },
    setFeatured: async (id, featured) => {
      const guide = guides.get(id)
      if (!guide) return false
      guides.set(id, { ...guide, featured })
      return true
    },
    addAiCost: async (id, usd) => {
      const guide = guides.get(id)
      if (!guide) return null
      guides.set(id, { ...guide, aiCostUsd: guide.aiCostUsd + usd })
      return guide.aiCostUsd + usd
    },
    placesForPrompt: async () => [],
    candidateExtras: async () => [],
    areaData: async () => ({ guides: [], categories: [], tags: [], placeCount: 0 }),
    neighborhoodGuideCounts: async () => ({ CORDON: 2 }),
    remove: async (id) => {
      const guide = guides.get(id)
      if (!guide) return 'not_found'
      if (guide.status === 'published') return 'published'
      guides.delete(id)
      return 'deleted'
    },
    intros: async () => intros,
    saveIntro: async (city, neighborhoodId, intro) => {
      intros.splice(0, intros.length, ...intros.filter((entry) => entry.neighborhoodId !== neighborhoodId))
      if (intro) intros.push({ city, neighborhoodId, intro, updatedAt: 'ahora' })
    },
  }
  return { store, guides, saves }
}

const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const put = (body: unknown) => ({ ...json(body), method: 'PUT' })

describe('API de guías', () => {
  it('503 sin base', async () => {
    const app = createApp()
    for (const url of ['/api/guides', '/api/guides/intros', '/api/guides/x']) expect((await app.request(url)).status).toBe(503)
  })

  it('crea un borrador (201) y 404 para una guía que no existe', async () => {
    const { store } = memoryStore()
    const app = createApp({ guidesStore: store })
    const created = await app.request('/api/guides', json({ guide: input() }))
    expect(created.status).toBe(201)
    expect((await created.json()).guide).toMatchObject({ id: 'g1', status: 'draft' })
    expect((await app.request('/api/guides/nada')).status).toBe(404)
    expect((await app.request('/api/guides/nada', put({ guide: input() }))).status).toBe(404)
  })

  it('400 con un body inválido: grupo o barrio fuera del catálogo, un lugar repetido', async () => {
    const app = createApp({ guidesStore: memoryStore().store })
    expect((await app.request('/api/guides', json({ guide: { ...input(), group: 'otro' } }))).status).toBe(400)
    expect((await app.request('/api/guides', json({ guide: input({ neighborhoodId: 'NARNIA' }) }))).status).toBe(400)
    const repeated = input({ places: [{ placeId: ids[0], text: 'a' }, { placeId: ids[0], text: 'b' }] })
    expect((await app.request('/api/guides', json({ guide: repeated }))).status).toBe(400)
  })

  it('slug inválido o de barrio: 422; repetido en la ciudad (aunque sea de otro barrio): 409', async () => {
    const app = createApp({ guidesStore: memoryStore().store })
    const bad = await app.request('/api/guides', json({ guide: input({ slug: 'Cafés' }) }))
    expect(bad.status).toBe(422)
    expect((await bad.json()).issues[0].code).toBe('slug_invalid')
    const clash = await app.request('/api/guides', json({ guide: input({ slug: 'pocitos', neighborhoodId: null }) }))
    expect(clash.status).toBe(422)
    expect((await clash.json()).issues[0].code).toBe('slug_neighborhood')
    expect((await app.request('/api/guides', json({ guide: input() }))).status).toBe(201)
    const taken = await app.request('/api/guides', json({ guide: input({ neighborhoodId: 'PARQUE RODO' }) }))
    expect(taken.status).toBe(409)
    expect((await taken.json()).error.code).toBe('SLUG_TAKEN')
  })

  it('publicar pide el mínimo de lugares publicados (uno en revisión no cuenta)', async () => {
    const { store } = memoryStore()
    const app = createApp({ guidesStore: store })
    await app.request('/api/guides', json({ guide: input({ places: [ids[0], ids[1], ids[2], ids[4]].map((placeId) => ({ placeId, text: 't' })) }) }))
    const refused = await app.request('/api/guides/g1/publish', { method: 'POST' })
    expect(refused.status).toBe(422)
    expect((await refused.json()).issues.map((issue: { code: string }) => issue.code)).toEqual(['min_places'])
    await app.request('/api/guides/g1', put({ guide: input() }))
    const published = await app.request('/api/guides/g1/publish', { method: 'POST' })
    expect(published.status).toBe(200)
    expect((await published.json()).guide.status).toBe('published')
  })

  it('una guía publicada no puede quedar con menos de 4 lugares; despublicada, sí', async () => {
    const { store } = memoryStore()
    const app = createApp({ guidesStore: store })
    await app.request('/api/guides', json({ guide: input() }))
    await app.request('/api/guides/g1/publish', { method: 'POST' })
    const three = input({ places: ids.slice(0, 3).map((placeId) => ({ placeId, text: 't' })) })
    expect((await app.request('/api/guides/g1', put({ guide: three }))).status).toBe(422)
    await app.request('/api/guides/g1/unpublish', { method: 'POST' })
    expect((await app.request('/api/guides/g1', put({ guide: three }))).status).toBe(200)
  })

  it('la fecha cambia con el contenido, no con "sólo corrección", featured ni un guardado igual', async () => {
    const { store, saves } = memoryStore()
    const app = createApp({ guidesStore: store })
    await app.request('/api/guides', json({ guide: input() }))
    await app.request('/api/guides/g1', put({ guide: input() }))
    await app.request('/api/guides/g1', put({ guide: input({ featured: true }) }))
    await app.request('/api/guides/g1', put({ guide: input({ color: '#6C12DD' }) }))
    await app.request('/api/guides/g1', put({ guide: input({ title: 'Otro' }), keepDate: true }))
    await app.request('/api/guides/g1', put({ guide: input({ title: 'Otro más' }) }))
    expect(saves.map((save) => save.touchContent)).toEqual([true, false, false, false, false, true])
    expect((await app.request('/api/guides/g1/featured', { ...json({ featured: false }), method: 'PATCH' })).status).toBe(200)
    expect(saves).toHaveLength(6)
  })

  it('el color tiene que ser de la paleta', async () => {
    const { store } = memoryStore()
    const app = createApp({ guidesStore: store })
    const bad = { ...input(), color: '#123456' }
    expect((await app.request('/api/guides', json({ guide: bad }))).status).toBe(400)
    expect((await app.request('/api/guides', json({ guide: input({ color: '#A15400' }) }))).status).toBe(201)
  })

  it('vista previa: arma la URL en el servidor con la clave; sin configurar, 503', async () => {
    const { store } = memoryStore()
    await createApp({ guidesStore: store }).request('/api/guides', json({ guide: input() }))
    const off = await createApp({ guidesStore: store }).request('/api/guides/g1/preview-url')
    expect(off.status).toBe(503)
    const app = createApp({ guidesStore: store, guidesPreview: { appUrl: 'http://localhost:3000/', secret: 's3cr3t' } })
    expect(await (await app.request('/api/guides/g1/preview-url')).json()).toEqual({
      url: 'http://localhost:3000/guides/montevideo/cafes-donde-nadie-te-apura?preview=s3cr3t',
    })
  })

  it('guías por barrio para la página del barrio: con el mínimo; 503 sin base', async () => {
    const app = createApp({ guidesStore: memoryStore().store })
    expect(await (await app.request('/api/guides/neighborhood-counts')).json()).toEqual({ min: 3, counts: { CORDON: 2 } })
    expect((await createApp().request('/api/guides/neighborhood-counts')).status).toBe(503)
  })

  it('eliminar: un borrador se borra; una publicada, 409 hasta despublicarla; una que no existe, 404', async () => {
    const { store, guides } = memoryStore()
    const app = createApp({ guidesStore: store })
    await app.request('/api/guides', json({ guide: input() }))
    await app.request('/api/guides/g1/publish', { method: 'POST' })
    const refused = await app.request('/api/guides/g1', { method: 'DELETE' })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error.code).toBe('GUIDE_PUBLISHED')
    expect(guides.has('g1')).toBe(true)
    await app.request('/api/guides/g1/unpublish', { method: 'POST' })
    const deleted = await app.request('/api/guides/g1', { method: 'DELETE' })
    expect(deleted.status).toBe(200)
    expect(guides.has('g1')).toBe(false)
    expect((await app.request('/api/guides/g1')).status).toBe(404)
    expect((await app.request('/api/guides/g1', { method: 'DELETE' })).status).toBe(404)
    expect((await createApp().request('/api/guides/g1', { method: 'DELETE' })).status).toBe(503)
  })

  it('introducciones: guardar y vaciar', async () => {
    const app = createApp({ guidesStore: memoryStore().store })
    const saved = await app.request('/api/guides/intros', put({ city: 'montevideo', neighborhoodId: 'CORDON', intro: ' Cordón. ' }))
    expect((await saved.json()).intros).toEqual([expect.objectContaining({ neighborhoodId: 'CORDON', intro: 'Cordón.' })])
    expect((await app.request('/api/guides/intros', put({ city: 'montevideo', neighborhoodId: 'NARNIA', intro: 'x' }))).status).toBe(400)
    const cleared = await app.request('/api/guides/intros', put({ city: 'montevideo', neighborhoodId: 'CORDON', intro: '' }))
    expect((await cleared.json()).intros).toEqual([])
  })

  it('500 si falla la base', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store } = memoryStore()
    store.list = vi.fn().mockRejectedValue(new Error('boom'))
    expect((await createApp({ guidesStore: store }).request('/api/guides')).status).toBe(500)
    error.mockRestore()
  })
})

describe('filtros y cambios de contenido', () => {
  const summary = (overrides: Partial<GuideSummary>): GuideSummary => ({
    id: 'x', slug: 's', city: 'montevideo', neighborhoodId: 'CORDON', group: 'cafes', title: 't', status: 'draft', featured: false,
    placeCount: 4, publishedAt: null, contentUpdatedAt: '2026-11-19T00:00:00Z', warnings: [], ...overrides,
  })

  it('por estado, grupo, barrio (o toda la ciudad) y featured', () => {
    const all = [summary({ id: 'a' }), summary({ id: 'b', status: 'published', featured: true }), summary({ id: 'c', neighborhoodId: null, group: 'eat' })]
    const pick = (filters: Record<string, string>) => filterGuides(all, filters).map((guide) => guide.id)
    expect(pick({})).toEqual(['a', 'b', 'c'])
    expect(pick({ status: 'published' })).toEqual(['b'])
    expect(pick({ group: 'eat' })).toEqual(['c'])
    expect(pick({ neighborhood: 'city' })).toEqual(['c'])
    expect(pick({ neighborhood: 'CORDON', featured: '0' })).toEqual(['a'])
  })

  it('contentChanged: el orden y el texto de un lugar cuentan; featured no', () => {
    const before = { ...input(), id: 'g', status: 'draft', publishedAt: null, contentUpdatedAt: '', places: input().places.map((place) => ({ ...place, name: '', slug: '', neighborhoodId: null, status: 'published' })) } as GuideDetail
    expect(contentChanged(before, input({ featured: true }))).toBe(false)
    expect(contentChanged(before, input({ places: [...input().places].reverse() }))).toBe(true)
    expect(contentChanged(before, input({ places: input().places.map((place, index) => ({ ...place, text: index ? place.text : 'otro' })) }))).toBe(true)
  })
})
