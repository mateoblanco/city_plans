import { describe, expect, it, vi } from 'vitest'
import type { DiscountBenefit } from '../../src/types/discounts.ts'
import type { DiscountProvider } from './providers.ts'
import { DiscountSourceError } from './errors.ts'
import type { MatchablePlace } from './match.ts'
import { memoryDiscountStore } from './memory-store.ts'
import { planDiscountWrites } from './persist.ts'
import { benefitId, type ProviderReader, type ReaderResult, type ReadPlace } from './reader.ts'
import { DiscountRunner, runDiscounts, type RunDependencies } from './run.ts'

const providers: DiscountProvider[] = [
  { id: 'bank-a', name: 'A', kind: 'bank', sourceUrl: 'https://a.test/' },
  { id: 'bank-b', name: 'B', kind: 'bank', sourceUrl: 'https://b.test/' },
]

const benefit = (placeId: string, patch: Partial<DiscountBenefit> = {}): DiscountBenefit => {
  const base: DiscountBenefit = {
    id: '', percent: 20, cardType: 'debit', cardTiers: [], cardProgram: null, days: 'all', daysText: null, mode: 'mixed', instantPercent: 10, refundPercent: 10,
    cap: { text: '4000 pesos uruguayos por cierre de estado de cuenta', amount: 4000, currency: 'UYU', period: 'statement' },
    validFrom: '2026-11-01', validTo: '2027-10-31', conditions: null, sourceText: '20% Off con Tarjetas de Débito', sourceUrl: null, parsedBy: 'html', ...patch,
  }
  return { ...base, id: patch.id ?? benefitId(placeId, base.cardType, base.cardTiers, base.cardProgram) }
}

const place = (id: string, patch: Partial<ReadPlace> = {}): ReadPlace => ({
  id, providerId: 'bank-a', sourceName: 'Es Mercat', category: null, city: 'Ciudad Vieja, Montevideo', departments: ['Montevideo'], montevideo: true,
  locations: [], website: null, instagram: null, sourceUrl: `https://a.test/${id}`, logoUrl: null, description: null, sourceTags: [],
  campaign: { validFrom: '2026-11-01', validTo: '2027-10-31', text: null }, benefits: [benefit(id)], ...patch,
})

const result = (places: ReadPlace[], patch: Partial<ReaderResult> = {}): ReaderResult => ({ places, unread: [], errors: [], warnings: [], llm: { calls: 0, costUsd: 0 }, ...patch })

const ours: MatchablePlace[] = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Es Mercat', neighborhoodId: 'CIUDAD VIEJA', brandKey: null, instagram: null },
  { id: '00000000-0000-4000-8000-000000000002', name: 'La Pasiva', neighborhoodId: 'POCITOS', brandKey: 'la-pasiva', instagram: 'lapasiva' },
  { id: '00000000-0000-4000-8000-000000000003', name: 'La Pasiva', neighborhoodId: 'CENTRO', brandKey: 'la-pasiva', instagram: 'lapasiva' },
]
const [esMercat, pasivaPocitos, pasivaCentro] = ours.map((item) => item.id)

/** Una corrida con el lector de bank-a que se pase (bank-b no trae nada), contra el store en memoria. */
function setup(today = '2026-11-05') {
  const store = memoryDiscountStore(ours, { today: () => today })
  let clock = new Date('2026-11-05T12:00:00Z')
  const candidates = vi.fn(async () => store.places)
  const deps = (readerA: ProviderReader, readerB: ProviderReader = async () => result([place('b:1', { providerId: 'bank-b', sourceName: 'Otro' })])): RunDependencies => ({
    providers,
    readers: { 'bank-a': readerA, 'bank-b': readerB },
    fetcherFor: async () => ({ get: async () => '', requests: 3 }),
    candidates,
    store,
    now: () => clock,
  })
  const run = async (readerA: ProviderReader, readerB?: ProviderReader) => {
    const summary = await runDiscounts(deps(readerA, readerB))
    clock = new Date(clock.getTime() + 24 * 60 * 60 * 1000)
    return summary
  }
  const get = async (id: string) => (await store.get(id))!
  return { store, run, get, deps }
}

describe('corridas en la base', () => {
  it('upsert: la segunda corrida actualiza, conserva first_seen y guarda la corrida', async () => {
    const { run, get, store } = setup()
    await run(async () => result([place('a:1')]))
    await run(async () => result([place('a:1', { sourceName: 'Es Mercat (nuevo nombre)' })]))
    const saved = await get('a:1')
    expect(saved).toMatchObject({ sourceName: 'Es Mercat (nuevo nombre)', firstSeenAt: '2026-11-05T12:00:00.000Z', lastSeenAt: '2026-11-06T12:00:00.000Z', active: true })
    expect(saved.benefits[0]).toMatchObject({ firstSeenAt: '2026-11-05T12:00:00.000Z', lastSeenAt: '2026-11-06T12:00:00.000Z', active: true })
    expect(store.runs.map((item) => item.id)).toEqual(['20261105T120000Z', '20261106T120000Z'])
  })

  it('lo que no aparece queda inactivo (no se borra) y se reactiva si vuelve', async () => {
    const { run, get } = setup()
    await run(async () => result([place('a:1'), place('a:2', { sourceName: 'Otro lugar' })]))
    await run(async () => result([place('a:1')]))
    expect((await get('a:2')).active).toBe(false)
    expect((await get('a:2')).benefits).toHaveLength(1)
    await run(async () => result([place('a:1'), place('a:2', { sourceName: 'Otro lugar' })]))
    expect((await get('a:2')).active).toBe(true)
  })

  it('un beneficio que desaparece del detalle queda inactivo; si cambia el porcentaje es el mismo beneficio', async () => {
    const { run, get } = setup()
    const credit = benefit('a:1', { cardType: 'credit', cardTiers: ['Platinum'], percent: 30 })
    await run(async () => result([place('a:1', { benefits: [benefit('a:1'), credit] })]))
    await run(async () => result([place('a:1', { benefits: [benefit('a:1', { percent: 25 })] })]))
    const benefits = (await get('a:1')).benefits
    expect(benefits).toHaveLength(2)
    expect(benefits.find((item) => item.cardType === 'debit')).toMatchObject({ percent: 25, active: true, firstSeenAt: '2026-11-05T12:00:00.000Z' })
    expect(benefits.find((item) => item.cardType === 'credit')?.active).toBe(false)
  })

  it('fecha vencida pero publicado en la fuente: activo (vigencia desactualizada); si deja de aparecer, inactivo', async () => {
    const { run, get } = setup('2026-12-15')
    // La corrida es del 5/11 y "hoy" (al leer) es el 15/12.
    await run(async () => result([place('a:1', { benefits: [
      benefit('a:1', { validTo: '2026-09-30' }),
      benefit('a:1', { cardType: 'credit', validTo: '2027-10-31' }),
    ] })]))
    let benefits = (await get('a:1')).benefits
    // La fecha ya pasó en la corrida, pero sigue publicado: activo, con la fecha tal cual.
    expect(benefits.find((item) => item.cardType === 'debit')).toMatchObject({ active: true, expired: true, validTo: '2026-09-30' })
    expect(benefits.find((item) => item.cardType === 'credit')).toMatchObject({ active: true, expired: false })
    // Deja de aparecer el de débito: ahora sí, vencido e inactivo.
    await run(async () => result([place('a:1', { benefits: [benefit('a:1', { cardType: 'credit', validTo: '2027-10-31' })] })]))
    benefits = (await get('a:1')).benefits
    expect(benefits.find((item) => item.cardType === 'debit')).toMatchObject({ active: false, expired: true })
  })

  it('un error total del proveedor no marca nada como inactivo', async () => {
    const { run, get, store } = setup()
    await run(async () => result([place('a:1')]))
    const failed = await run(async () => { throw new DiscountSourceError('bank-a', 'El listado no tiene cards') })
    expect(failed.providers[0]).toMatchObject({ status: 'error', error: 'El listado no tiene cards' })
    expect(await get('a:1')).toMatchObject({ active: true, lastSeenAt: '2026-11-05T12:00:00.000Z' })
    expect((await get('a:1')).benefits[0].active).toBe(true)
    // El otro proveedor sí se guardó.
    expect(await store.get('b:1')).not.toBeNull()
  })

  it('un detalle que no se pudo leer no inactiva sus beneficios', async () => {
    const { run, get } = setup()
    await run(async () => result([place('a:1')]))
    await run(async () => result([place('a:1', { benefits: [] })], { unread: ['a:1'], errors: [{ providerId: 'bank-a', url: 'https://a.test/a:1', message: '404' }] }))
    const saved = await get('a:1')
    expect(saved.active).toBe(true)
    expect(saved.benefits[0].active).toBe(true)
  })

  it('cruza lo nuevo y vuelve a cruzar lo automático: un "no está" pasa a encontrado cuando el lugar aparece en la base', async () => {
    const { run, get, store } = setup()
    await run(async () => result([place('a:1', { sourceName: 'Porterhouse', city: 'Pocitos, Montevideo' })]))
    expect((await get('a:1')).match).toMatchObject({ status: 'missing', origin: 'auto', links: [] })
    store.places.push({ id: '00000000-0000-4000-8000-000000000009', name: 'Porterhouse', neighborhoodId: 'POCITOS', brandKey: null, instagram: null })
    await run(async () => result([place('a:1', { sourceName: 'Porterhouse', city: 'Pocitos, Montevideo' })]))
    expect((await get('a:1')).match).toMatchObject({ status: 'found', origin: 'auto', links: [expect.objectContaining({ name: 'Porterhouse', origin: 'auto' })] })
  })

  it('lo manual sobrevive a una corrida nueva', async () => {
    const { run, get, store } = setup()
    await run(async () => result([place('a:1')]))
    expect((await get('a:1')).match.links.map((link) => link.placeId)).toEqual([esMercat])
    // Se corrige a mano a otro lugar.
    expect(await store.setLinks('a:1', [{ placeId: pasivaPocitos, wholeBrand: false }])).toBe('ok')
    await run(async () => result([place('a:1')]))
    expect((await get('a:1')).match).toMatchObject({ status: 'found', origin: 'manual', links: [expect.objectContaining({ placeId: pasivaPocitos, origin: 'manual' })] })
  })

  it('confirmar pasa los vínculos a manuales; desvincular todo deja "no está" manual', async () => {
    const { run, get, store } = setup()
    await run(async () => result([place('a:1')]))
    expect(await store.confirm('a:1')).toBe('ok')
    expect((await get('a:1')).match).toMatchObject({ origin: 'manual', links: [expect.objectContaining({ origin: 'manual' })] })
    await store.setLinks('a:1', [])
    await run(async () => result([place('a:1')]))
    expect((await get('a:1')).match).toMatchObject({ status: 'missing', origin: 'manual', links: [] })
    expect(await store.confirm('a:1')).toBe('no_links')
  })

  it('lo ignorado no se vuelve a cruzar', async () => {
    const { run, get, store } = setup()
    await run(async () => result([place('a:1', { sourceName: 'Porterhouse' })]))
    const before = (await get('a:1')).match
    expect(before.links).toEqual([])
    await store.setIgnored('a:1', true)
    store.places.push({ id: '00000000-0000-4000-8000-000000000009', name: 'Porterhouse', neighborhoodId: 'CIUDAD VIEJA', brandKey: null, instagram: null })
    await run(async () => result([place('a:1', { sourceName: 'Porterhouse' })]))
    expect(await get('a:1')).toMatchObject({ ignored: true, match: before })
  })

  it('cadenas: sin direcciones, toda la marca; con direcciones, sólo las que cruzan (y faltan las otras)', async () => {
    const { run, get } = setup()
    await run(async () => result([
      place('a:brand', { sourceName: 'La Pasiva', city: 'Montevideo', instagram: 'lapasiva' }),
      place('a:branch', { sourceName: 'La Pasiva', city: 'Montevideo', locations: [{ address: 'J. B. Blanco 920, Pocitos', area: 'Pocitos', department: null, mapsUrl: null }, { address: 'Av. Brasil 1, Punta Carretas', area: 'Punta Carretas', department: null, mapsUrl: null }] }),
    ]))
    const brand = await get('a:brand')
    expect(brand.match.status).toBe('found')
    expect(brand.match.links.map((link) => [link.placeId, link.wholeBrand]).sort()).toEqual([[pasivaPocitos, true], [pasivaCentro, true]].sort())
    // La de Punta Carretas no tiene sucursal nuestra en su barrio: encontrado, con "faltan sucursales en la base".
    const branch = await get('a:branch')
    expect(branch.match).toMatchObject({ status: 'found', missingBranches: 1, candidates: [], links: [expect.objectContaining({ placeId: pasivaPocitos, wholeBrand: false, locationIndex: 0 })] })
  })

  it('volver a automático vuelve a cruzar', async () => {
    const { run, get, store } = setup()
    await run(async () => result([place('a:1')]))
    await store.setLinks('a:1', [{ placeId: pasivaCentro, wholeBrand: false }])
    const { matchPlace } = await import('./match.ts')
    await store.setAutoMatch('a:1', matchPlace(await get('a:1'), store.places), new Date())
    expect((await get('a:1')).match).toMatchObject({ origin: 'auto', status: 'found', links: [expect.objectContaining({ placeId: esMercat })] })
  })
})

describe('BBVA y Santander', () => {
  it('cada uno se guarda e inactiva por separado: si Santander falla, no se toca nada suyo ni de BBVA', async () => {
    const { discountProviders } = await import('./providers.ts')
    const store = memoryDiscountStore(ours)
    let clock = new Date('2026-11-05T12:00:00Z')
    const reader = (providerId: string, ids: string[]): ProviderReader => async () => result(ids.map((id) => place(id, { providerId })))
    const run = (readers: Record<string, ProviderReader>) => {
      const summary = runDiscounts({ providers: discountProviders().filter((provider) => provider.id === 'bbva' || provider.id === 'santander'), readers, fetcherFor: async () => ({ get: async () => '', requests: 0 }), candidates: async () => ours, store, now: () => clock })
      clock = new Date(clock.getTime() + 86_400_000)
      return summary
    }
    await run({ bbva: reader('bbva', ['bbva:1', 'bbva:2']), santander: reader('santander', ['santander:1']) })
    const second = await run({ bbva: reader('bbva', ['bbva:1']), santander: async () => { throw new Error('Error 503') } })
    expect(second.providers.map((provider) => [provider.providerId, provider.status])).toEqual([['bbva', 'ok'], ['santander', 'error']])
    expect((await store.get('bbva:2'))?.active).toBe(false)
    expect(await store.get('santander:1')).toMatchObject({ active: true, lastSeenAt: '2026-11-05T12:00:00.000Z' })
  })
})

describe('planDiscountWrites', () => {
  it('no recalcula el cruce de lo manual ni de lo ignorado', () => {
    const writes = planDiscountWrites({
      providerId: 'bank-a', runId: 'r', now: new Date('2026-11-05T12:00:00Z'),
      result: { places: [place('a:1'), place('a:2'), place('a:3'), place('a:4')], unread: ['a:4'] },
      existing: [{ id: 'a:1', ignored: false, matchOrigin: 'manual' }, { id: 'a:2', ignored: true, matchOrigin: 'auto' }, { id: 'a:3', ignored: false, matchOrigin: 'auto' }],
      candidates: ours,
    })
    // a:4 es nuevo (auto); a:3 es auto.
    expect(writes.matches.map((match) => match.discountPlaceId)).toEqual(['a:3', 'a:4'])
    expect(writes.readPlaceIds).toEqual(['a:1', 'a:2', 'a:3'])
    expect(writes.seenPlaceIds).toEqual(['a:1', 'a:2', 'a:3', 'a:4'])
  })
})

describe('DiscountRunner', () => {
  it('una corrida a la vez, con progreso y estado final', async () => {
    const { deps } = setup()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const reader: ProviderReader = async ({ onProgress }) => {
      onProgress?.({ phase: 'details', done: 1, total: 2 })
      await gate
      return result([place('a:1')])
    }
    const runner = new DiscountRunner(deps(reader))
    expect(runner.status()).toEqual({ status: 'idle' })
    const runId = runner.start()
    expect(runId).toBe('20261105T120000Z')
    expect(runner.start()).toBeNull()
    await vi.waitFor(() => expect(runner.status()).toMatchObject({ status: 'running', phase: 'details', done: 1, total: 2 }))
    release()
    await runner.settled()
    expect(runner.status()).toMatchObject({ status: 'done', runId })
  })

  it('si fallan todos, el estado es error con el mensaje', async () => {
    const { deps } = setup()
    const runner = new DiscountRunner(deps(async () => { throw new Error('robots.txt no permite') }, async () => { throw new Error('timeout') }))
    runner.start()
    await runner.settled()
    expect(runner.status()).toMatchObject({ status: 'error', message: 'robots.txt no permite · timeout' })
  })

  it('si no se puede leer la base para cruzar, el proveedor queda en error y no escribe', async () => {
    const { store } = setup()
    const run = await runDiscounts({
      providers: [providers[0]], readers: { 'bank-a': async () => result([place('a:1')]) }, fetcherFor: async () => ({ get: async () => '', requests: 0 }),
      candidates: async () => { throw new Error('Neon caído') }, store,
    })
    expect(run.providers[0]).toMatchObject({ status: 'error', error: 'Neon caído' })
    expect(await store.list()).toEqual([])
  })
})

describe('cruces manuales heredados de otro proveedor (Itaú ← Itaú Personal Bank)', () => {
  const heirProviders: DiscountProvider[] = [
    { id: 'src', name: 'Fuente', kind: 'bank', sourceUrl: 'https://src.test/' },
    { id: 'heir', name: 'Heredero', kind: 'bank', sourceUrl: 'https://heir.test/', pages: [
      { url: 'https://heir.test/', label: 'Propia' },
      { url: 'https://src.test/', label: 'PB', manualMatchFrom: 'src' },
    ] },
  ]
  const at = (providerId: string, slug: string, tags: string[]) => place(`${providerId}:montevideo:${slug}`, { providerId, sourceName: `Lugar ${slug}`, sourceTags: tags })

  it('copia lo vinculado, confirmado o ignorado a un lugar nuevo o automático del mismo logo; no pisa lo manual propio', async () => {
    const store = memoryDiscountStore(ours)
    const run = (only: string[], readers: Record<string, ProviderReader>) => runDiscounts({
      providers: heirProviders.filter((provider) => only.includes(provider.id)),
      readers,
      fetcherFor: async () => ({ get: async () => '', requests: 0 }),
      candidates: async () => store.places,
      store,
    })
    const sources = ['x', 'y', 'z', 'w', 'v'].map((slug) => at('src', slug, ['PB']))
    await run(['src'], { src: async () => result(sources) })
    await store.setLinks('src:montevideo:x', [{ placeId: esMercat, wholeBrand: false }])
    await store.setIgnored('src:montevideo:y', true)
    await store.setLinks('src:montevideo:z', [{ placeId: pasivaPocitos, wholeBrand: false }])
    await store.setLinks('src:montevideo:w', [{ placeId: pasivaPocitos, wholeBrand: true }])
    await store.setLinks('src:montevideo:v', [{ placeId: esMercat, wholeBrand: false }])

    // Antes: z ya tiene cruce manual propio en el heredero y w existe con cruce automático (sólo en la página propia).
    await run(['heir'], { heir: async () => result([at('heir', 'z', ['Propia']), at('heir', 'w', ['Propia'])]) })
    await store.setLinks('heir:montevideo:z', [{ placeId: pasivaCentro, wholeBrand: false }])
    expect((await store.get('heir:montevideo:w'))!.match.origin).toBe('auto')

    // v no está en la página que hereda (sólo en la propia): no se copia.
    const heirPlaces = [...['x', 'y', 'z', 'w'].map((slug) => at('heir', slug, ['PB'])), at('heir', 'v', ['Propia'])]
    const summary = await run(['heir'], { heir: async () => result(heirPlaces) })
    expect(summary.providers[0].notes).toContain('3 cruces manuales copiados de src (PB).')

    const x = (await store.get('heir:montevideo:x'))!
    expect(x.match).toMatchObject({ status: 'found', origin: 'manual' })
    expect(x.match.links.map((link) => [link.placeId, link.origin])).toEqual([[esMercat, 'manual']])
    expect(await store.get('heir:montevideo:y')).toMatchObject({ ignored: true, match: { origin: 'manual' } })
    expect((await store.get('heir:montevideo:z'))!.match.links.map((link) => link.placeId)).toEqual([pasivaCentro])
    const w = (await store.get('heir:montevideo:w'))!
    expect(w.match.origin).toBe('manual')
    expect(w.match.links.map((link) => [link.placeId, link.wholeBrand])).toEqual([[pasivaPocitos, true]])
    expect((await store.get('heir:montevideo:v'))!.match.origin).toBe('auto')

    // Ya son manuales: la corrida siguiente no copia de nuevo ni los toca.
    const again = await run(['heir'], { heir: async () => result(heirPlaces) })
    expect(again.providers[0].notes).toContain('0 cruces manuales copiados de src (PB).')
    expect((await store.get('heir:montevideo:x'))!.match.links.map((link) => link.placeId)).toEqual([esMercat])
  })

  it('el planificador no calcula cruce automático para lo copiado', () => {
    const writes = planDiscountWrites({
      providerId: 'heir', runId: 'r', now: new Date('2026-11-05T12:00:00Z'),
      result: result([at('heir', 'x', ['PB']), at('heir', 'n', ['PB'])]),
      existing: [], candidates: ours,
      inherited: [{ fromProviderId: 'src', label: 'PB', sources: [{ id: 'src:montevideo:x', status: 'found', ignored: false, links: [{ placeId: esMercat, wholeBrand: false, locationIndex: null }] }] }],
    })
    expect(writes.copies.map((copy) => [copy.discountPlaceId, copy.fromId])).toEqual([['heir:montevideo:x', 'src:montevideo:x']])
    expect(writes.matches.map((match) => match.discountPlaceId)).toEqual(['heir:montevideo:n'])
  })
})
