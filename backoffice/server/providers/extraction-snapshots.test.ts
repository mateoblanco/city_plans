import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GooglePlaceDetailsResponse } from '../../src/types/places.ts'
import { fileSnapshotStore, readSnapshots, replaySnapshot, type ExtractionSnapshot } from './extraction-snapshots.ts'
import { PlaceExtractionService, type PlaceExtraction } from './place-extraction-service.ts'

const GOOGLE_NAME = 'Bar Google Nombre'
const GOOGLE_ADDRESS = 'Calle Google 1234'
const details = {
  getDetails: async () => ({
    source: 'google', exactMatch: true,
    anchor: { name: GOOGLE_NAME, address: GOOGLE_ADDRESS, latitude: -34.906, longitude: -56.202 },
    websiteUri: null, data: {}, attribution: 'Google Maps',
  }) as GooglePlaceDetailsResponse,
}
const exa = {
  configured: true,
  searchPlace: async () => ({
    source: 'exa' as const, query: GOOGLE_NAME,
    output: { content: { description: '', address: '', contact_info: '', open_hours_raw: '', open_hours: [], knows_before_you_go: '', menu: [] }, grounding: {} },
    results: [{ title: 'Bar Google', url: 'https://guia.example/bar', highlights: ['Bar Google Nombre: picadas para compartir y ambiente informal'] }],
    requestId: 'exa-1', attribution: 'Exa',
  }),
}
const extraction: PlaceExtraction = {
  facts: [{ id: 'F1', text: 'Picadas para compartir y ambiente informal', sourceId: 'S2', kind: 'food', proposedTag: null }],
  tags: [{ group: 'categories', id: 'bar', facts: ['F1'] }, { group: 'foods', id: 'picada', facts: ['F1'] }, { group: 'goodFor', id: 'groups', facts: ['F1'] }, { group: 'style', id: 'casual', facts: ['F1'] }],
  dietary: { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'unknown' }, price: 'unknown', reservations: 'unknown',
  hours: { raw: null, display: null, blocks: [] },
  contact: { instagram: '', website: '' },
  highlights: [], dishes: [], signature: [], description: { es: 'Un bar.', en: 'A bar.' },
  name: '', locatedIn: null, support: [], doubts: [], iconCategory: 'beer',
}

describe('snapshots de extracción', () => {
  it('guarda la salida del modelo y las fuentes sin nada de Google, y la re-corrida da el mismo borrador', async () => {
    const saved: ExtractionSnapshot[] = []
    const service = new PlaceExtractionService({ apiKey: 'test-key', details, exa, generate: async () => extraction, snapshots: { save: async (snapshot) => { saved.push(snapshot) } } })
    const result = await service.extract('place-1', { seedCategories: ['bar'] })
    expect(result.status).toBe('ok')
    expect(saved).toHaveLength(1)
    const json = JSON.stringify(saved[0])
    expect(json).not.toContain(GOOGLE_ADDRESS)
    expect(json).not.toContain('-34.906')
    expect(saved[0].llmOutput).toEqual(extraction)

    const replayed = await replaySnapshot(JSON.parse(json), details)
    if (result.status !== 'ok') throw new Error('sin resultado')
    expect(replayed.tags).toEqual(result.place.tags)
    expect(replayed.style).toBe(result.place.style)
    expect(replayed.style).toBe('casual')
    expect(replayed.tagEvidence).toEqual(result.place.tagEvidence)
  })

  it('un error al guardar no corta la extracción', async () => {
    const service = new PlaceExtractionService({ apiKey: 'test-key', details, exa, generate: async () => extraction, snapshots: { save: async () => { throw new Error('disco lleno') } } })
    expect((await service.extract('place-1', { seedCategories: ['bar'] })).status).toBe('ok')
  })

  it('escribe y lee un archivo por lugar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snapshots-'))
    try {
      const store = fileSnapshotStore(dir)
      const snapshot = { googlePlaceId: 'ChIJ/raro', savedAt: '2026-10-17T00:00:00.000Z', model: 'm', request: { seedCategories: ['bar'] }, transit: { status: 'unavailable', lines: [] }, sources: [], deterministicContact: {}, prominenceSignals: null, llmOutput: extraction } satisfies ExtractionSnapshot
      await store.save(snapshot)
      await store.save({ ...snapshot, model: 'm2' })
      expect((await readSnapshots(dir)).map((item) => item.model)).toEqual(['m2'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
