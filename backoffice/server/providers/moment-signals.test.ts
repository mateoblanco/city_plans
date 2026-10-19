import { describe, expect, it } from 'vitest'
import { postProcess, type PlaceExtraction, type Source } from './place-extraction-service.ts'
import { MOMENT_SIGNALS, signalsIn, sufficientSignals } from './moment-signals.ts'
import { EXA_SUMMARY_URL } from './source-hosts.ts'

const target = {
  name: 'Bar de Prueba',
  address: 'Ituzaingó 1447',
  coordinates: { lat: -34.906, lng: -56.202, source: 'google' as const, fetchedAt: '2026-10-01T00:00:00.000Z' },
  neighborhoodId: 'CIUDAD VIEJA',
  city: 'Montevideo' as const,
  googlePlaceId: 'place-1',
  transit: { status: 'success' as const, lines: [] },
}

const base: PlaceExtraction = {
  facts: [], tags: [{ group: 'categories', id: 'bar', facts: [] }],
  dietary: { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'unknown' },
  price: 'unknown', reservations: 'unknown',
  hours: { raw: null, display: null, blocks: [] },
  contact: { phone: '', whatsapp: '', instagram: '', website: '', menuUrl: '', reservationUrl: '' },
  highlights: [], dishes: [], signature: [],
  description: { es: 'Un bar.', en: 'A bar.' },
  name: '', address: '', locatedIn: null, support: [], doubts: [], iconCategory: 'beer',
}

const web = (text: string): Source => ({ id: 'S1', kind: 'web', trust: 'official', url: 'https://bar.example/', text })

/** Facts F1, F2… de la fuente S1 y un tag que los cita a todos. */
function run(texts: string[], tags: PlaceExtraction['tags'], sourceText = texts.join('. ')) {
  const facts = texts.map((text, index) => ({ id: `F${index + 1}`, text, sourceId: 'S1', kind: 'other' as const, proposedTag: null }))
  return postProcess(target, { ...base, facts, tags: [...base.tags, ...tags] }, { sources: [web(sourceText)] })
}

const allFacts = (count: number) => Array.from({ length: count }, (_, index) => `F${index + 1}`)

describe('señales de momentos', () => {
  it('una fuerte alcanza; una débil sola no; dos débiles distintas sí', () => {
    const signals = MOMENT_SIGNALS.groups
    expect(sufficientSignals(signalsIn(signals, [{ id: 'F1', text: 'Tablas de fiambres para compartir' }]))?.map((match) => match.signal)).toEqual(['picada para compartir'])
    expect(sufficientSignals(signalsIn(signals, [{ id: 'F1', text: 'Tienen cerveza tirada' }]))).toBeNull()
    expect(sufficientSignals(signalsIn(signals, [{ id: 'F1', text: 'Tienen cerveza tirada' }, { id: 'F2', text: 'Ambiente animado' }]))?.map((match) => match.signal))
      .toEqual(['cerveza tirada', 'ambiente animado'])
  })

  it('dos frases de la misma señal cuentan una vez', () => {
    const matches = signalsIn(MOMENT_SIGNALS.date, [{ id: 'F1', text: 'Buena carta de vinos' }, { id: 'F2', text: 'Vinos por copa' }])
    expect(sufficientSignals(matches)).toBeNull()
  })
})

describe('postProcess: momentos', () => {
  it('acepta un momento explícito si la fuente lo nombra', () => {
    const place = run(['Ideal para ir con amigos'], [{ group: 'goodFor', id: 'groups', facts: ['F1'] }])
    expect(place.tags).toContain('groups')
    expect(place.tagEvidence).toContainEqual({ tag: 'groups', mode: 'explicit', signals: ['con amigos'], factIds: ['F1'] })
  })

  it('infiere groups con una señal fuerte', () => {
    const place = run(['Picadas para compartir'], [{ group: 'goodFor', id: 'groups', facts: ['F1'] }])
    expect(place.tags).toContain('groups')
    expect(place.tagEvidence).toContainEqual({ tag: 'groups', mode: 'inferred', signals: ['picada para compartir'], factIds: ['F1'] })
  })

  it('descarta un momento con una sola señal débil', () => {
    const place = run(['Hay tragos clásicos'], [{ group: 'goodFor', id: 'groups', facts: ['F1'] }, { group: 'goodFor', id: 'celebration', facts: ['F1'] }])
    expect(place.tags).not.toContain('groups')
    expect(place.tags).not.toContain('celebration')
  })

  it('infiere date con dos señales débiles distintas', () => {
    const place = run(['Ambiente tranquilo', 'Buena carta de vinos'], [{ group: 'goodFor', id: 'date', facts: allFacts(2) }])
    expect(place.tags).toContain('date')
    expect(place.tagEvidence).toContainEqual({ tag: 'date', mode: 'inferred', signals: ['ambiente tranquilo', 'vinos'], factIds: ['F1', 'F2'] })
  })

  it('infiere date con vinos y ambiente acogedor (caso Oriundo)', () => {
    const place = run(['Buena selección de vinos', 'Ambiente acogedor'], [{ group: 'goodFor', id: 'date', facts: allFacts(2) }])
    expect(place.tags).toContain('date')
    expect(place.tagEvidence).toContainEqual({ tag: 'date', mode: 'inferred', signals: ['vinos', 'acogedor'], factIds: ['F1', 'F2'] })
  })

  it('infiere quick por al paso y celebration por eventos privados', () => {
    const place = run(['Se come al paso', 'Hacen eventos privados'], [
      { group: 'goodFor', id: 'quick', facts: ['F1'] }, { group: 'goodFor', id: 'celebration', facts: ['F2'] },
    ])
    expect(place.tags).toEqual(expect.arrayContaining(['quick', 'celebration']))
  })

  it('no acepta como explícito lo que sólo dice la paráfrasis del fact', () => {
    // El fact dice "con amigos" pero la fuente no: no es explícito, y sin señales se descarta.
    const place = run(['Para ir con amigos'], [{ group: 'goodFor', id: 'groups', facts: ['F1'] }], 'Bar en Ciudad Vieja')
    expect(place.tags).not.toContain('groups')
  })

  it('kids_area hace al lugar apto niños', () => {
    const place = run(['Tiene espacio para niños'], [{ group: 'features', id: 'kids_area', facts: ['F1'] }])
    expect(place.tags).toEqual(expect.arrayContaining(['kids_area', 'kids_friendly']))
    expect(place.placeFacts.find((fact) => fact.id === 'F1')?.supports).toContain('goodFor.kids_friendly')
  })
})

describe('postProcess: momentos que el modelo no propuso', () => {
  it('los deduce de los facts con las mismas reglas', () => {
    const place = run(['Buena selección de vinos', 'Ambiente acogedor'], [])
    expect(place.tags).toContain('date')
    expect(place.tagEvidence).toContainEqual({ tag: 'date', mode: 'inferred', signals: ['vinos', 'acogedor'], factIds: ['F1', 'F2'] })
    expect(place.placeFacts.find((fact) => fact.id === 'F2')?.supports).toContain('goodFor.date')
    expect(run(['Picadas para compartir'], []).tags).toContain('groups')
  })

  it('una débil sola no alcanza, y reservas no cuenta para date', () => {
    expect(run(['Buena carta de vinos'], []).tags).not.toContain('date')
    expect(run(['Buena carta de vinos', 'Se puede reservar mesa'], []).tags).not.toContain('date')
    // Si el modelo propuso date, reservas sí cuenta.
    expect(run(['Buena carta de vinos', 'Se puede reservar mesa'], [{ group: 'goodFor', id: 'date', facts: allFacts(2) }]).tags).toContain('date')
  })

  it('el resumen de Exa no alcanza solo', () => {
    const facts = [{ id: 'F1', text: 'Picadas para compartir', sourceId: 'S2', kind: 'other' as const, proposedTag: null }]
    const exa: Source = { id: 'S2', kind: 'exa', trust: 'third_party', url: EXA_SUMMARY_URL, text: 'Resumen' }
    expect(postProcess(target, { ...base, facts }, { sources: [web('Bar'), exa] }).tags).not.toContain('groups')
  })

  it('uno que el modelo propuso y se descartó no vuelve', () => {
    const place = run(['Hay tragos clásicos', 'Ambiente animado'], [{ group: 'goodFor', id: 'groups', facts: ['F1'] }])
    expect(place.tags).not.toContain('groups')
  })

  it('mostrador no cuenta para deducir quick, pero sí si el modelo lo propuso', () => {
    expect(run(['Se pide en el mostrador', 'También para llevar'], []).tags).not.toContain('quick')
    expect(run(['Se pide en el mostrador', 'También para llevar'], [{ group: 'goodFor', id: 'quick', facts: allFacts(2) }]).tags).toContain('quick')
    expect(run(['Para llevar', 'Menú del día'], []).tags).toContain('quick')
  })
})

describe('postProcess: cozy', () => {
  it('sólo con acogedor en la fuente', () => {
    const tags: PlaceExtraction['tags'] = [{ group: 'atmosphere', id: 'cozy', facts: ['F1'] }]
    expect(run(['Ambiente acogedor'], tags).tags).toContain('cozy')
    expect(run(['Ambiente acogedor'], tags, 'Un bar con mesas de madera').tags).not.toContain('cozy')
  })
})

describe('postProcess: style', () => {
  it('casual con una señal', () => {
    const place = run(['Pizza por porción en el mostrador'], [{ group: 'style', id: 'casual', facts: ['F1'] }])
    expect(place.style).toBe('casual')
    expect(place.tagEvidence).toContainEqual({ tag: 'casual', mode: 'inferred', signals: ['por porción'], factIds: ['F1'] })
    expect(place.embeddingText).toContain('Estilo casual')
    expect(place.keywordText).toContain('de barrio')
  })

  it('cuidado sin señal queda null, nunca intermedio', () => {
    const place = run(['Abre de noche'], [{ group: 'style', id: 'cuidado', facts: ['F1'] }])
    expect(place.style).toBeNull()
    expect(place.placeFacts.find((fact) => fact.id === 'F1')?.supports).not.toContain('style.cuidado')
  })

  it('intermedio necesita algún fact', () => {
    expect(run(['Carta de minutas y pastas'], [{ group: 'style', id: 'intermedio', facts: ['F1'] }]).style).toBe('intermedio')
    expect(run(['Carta de minutas y pastas'], [{ group: 'style', id: 'intermedio', facts: [] }]).style).toBeNull()
  })

  it('dos styles distintos se contradicen: null', () => {
    const place = run(['Cocina de autor', 'Por porción'], [{ group: 'style', id: 'cuidado', facts: ['F1'] }, { group: 'style', id: 'casual', facts: ['F2'] }])
    expect(place.style).toBeNull()
  })

  it('sin style del modelo, lo deduce de las señales de un solo estilo', () => {
    const place = run(['Ambiente informal y a la moda'], [])
    expect(place.style).toBe('casual')
    expect(place.tagEvidence).toContainEqual({ tag: 'casual', mode: 'inferred', signals: ['informal'], factIds: ['F1'] })
    expect(place.placeFacts.find((fact) => fact.id === 'F1')?.supports).toContain('style.casual')
    expect(run(['Ambiente informal', 'Cocina de autor'], []).style).toBeNull()
    expect(run(['Abre de noche'], []).style).toBeNull()
  })

  it('toques en vivo cuentan como música para groups', () => {
    const place = run(['Tienen toques en vivo', 'Sirven cócteles'], [{ group: 'goodFor', id: 'groups', facts: allFacts(2) }])
    expect(place.tags).toContain('groups')
  })

  it('style no entra en tags', () => {
    const place = run(['Cocina de autor'], [{ group: 'style', id: 'cuidado', facts: ['F1'] }])
    expect(place.style).toBe('cuidado')
    expect(place.tags).not.toContain('cuidado')
  })
})

describe('resumen de Exa como señal débil', () => {
  const exa: Source = { id: 'S2', kind: 'exa', trust: 'third_party', url: EXA_SUMMARY_URL, text: 'Resumen' }
  /** F1 de la web y F2 del resumen de Exa, los dos citados por el tag. */
  function mixed(own: string, summary: string, tags: (facts: string[]) => PlaceExtraction['tags']) {
    const facts = [
      { id: 'F1', text: own, sourceId: 'S1', kind: 'other' as const, proposedTag: null },
      { id: 'F2', text: summary, sourceId: 'S2', kind: 'other' as const, proposedTag: null },
    ]
    return postProcess(target, { ...base, facts, tags: [...base.tags, ...tags(['F1', 'F2'])] }, { sources: [web(own), exa] })
  }

  it('suma a una débil de otra fuente', () => {
    const place = mixed('Tienen toques en vivo', 'Sirve cócteles', (facts) => [{ group: 'goodFor', id: 'groups', facts }])
    expect(place.tags).toContain('groups')
    expect(place.tagEvidence).toContainEqual({ tag: 'groups', mode: 'inferred', signals: ['música', 'tragos (resumen de Exa)'], factIds: ['F1', 'F2'] })
  })

  it('una fuerte del resumen cuenta como débil: sola no alcanza', () => {
    const place = mixed('Abre de noche', 'Picadas para compartir', (facts) => [{ group: 'goodFor', id: 'groups', facts }])
    expect(place.tags).not.toContain('groups')
  })

  it('la misma señal en las dos fuentes no cuenta dos veces', () => {
    const place = mixed('Sirve cócteles', 'Tragos clásicos', (facts) => [{ group: 'goodFor', id: 'groups', facts }])
    expect(place.tags).not.toContain('groups')
  })

  it('el style no sale sólo del resumen', () => {
    expect(mixed('Abre de noche', 'Ambiente informal', () => []).style).toBeNull()
    expect(sufficientSignals([], signalsIn(MOMENT_SIGNALS.quick, [{ id: 'F2', text: 'Se come al paso' }]))).toBeNull()
  })
})

describe('señales débiles de style', () => {
  it('reservas recomendadas sola no alcanza para cuidado', () => {
    expect(run(['Se recomienda reservar'], [{ group: 'style', id: 'cuidado', facts: ['F1'] }]).style).toBeNull()
  })

  it('casual con dos débiles distintas', () => {
    expect(run(['Hamburguesería'], [{ group: 'style', id: 'casual', facts: ['F1'] }]).style).toBeNull()
    const place = run(['Hamburguesería con combos', 'Ambiente relajado'], [{ group: 'style', id: 'casual', facts: allFacts(2) }])
    expect(place.style).toBe('casual')
    expect(place.tagEvidence).toContainEqual({ tag: 'casual', mode: 'inferred', signals: ['hamburguesería', 'combos'], factIds: ['F1'] })
  })
})
