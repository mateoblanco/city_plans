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
  contact: { instagram: '', website: '' },
  highlights: [], dishes: [], signature: [],
  description: { es: 'Un bar.', en: 'A bar.' },
  name: '', locatedIn: null, support: [], doubts: [], iconCategory: 'beer',
}

const web = (text: string): Source => ({ id: 'S1', kind: 'web', trust: 'official', url: 'https://bar.example/', text })

/** El style y de dónde salió. Sin señales, base (ícono beer, sin precio) cae a intermedio por ícono. */
const styleOf = (place: ReturnType<typeof run>) => [place.style, place.tagEvidence?.find((item) => item.tag === place.style)?.basis]
const BY_ICON = ['intermedio', 'icon']

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

describe('postProcess: de barrio (neighborhood_spot)', () => {
  const spot = (place: ReturnType<typeof run>) => place.tags.includes('neighborhood_spot')

  it('una fuente real con la frase lo da aunque el modelo no lo proponga, con la línea como respaldo', () => {
    const place = run(['Abre de lunes a sábado'], [], 'Abre de lunes a sábado. Un clásico del barrio desde 1960.')
    expect(spot(place)).toBe(true)
    const evidence = place.tagEvidence?.find((item) => item.tag === 'neighborhood_spot')
    expect(evidence).toMatchObject({ mode: 'explicit', signals: ['clásico del barrio'] })
    expect(place.placeFacts.find((fact) => fact.id === evidence?.factIds[0])?.text).toContain('Un clásico del barrio')
    expect(spot(run([], [], 'Bodegón con platos abundantes'))).toBe(true)
  })

  it('la frase sólo en el resumen de Exa no alcanza', () => {
    const facts = [{ id: 'F1', text: 'Un bar de barrio', sourceId: 'S2', kind: 'other' as const, proposedTag: null }]
    const exa: Source = { id: 'S2', kind: 'exa', trust: 'third_party', url: EXA_SUMMARY_URL, text: 'Un bar de barrio' }
    const tags: PlaceExtraction['tags'] = [{ group: 'atmosphere', id: 'neighborhood_spot', facts: ['F1'] }]
    expect(postProcess(target, { ...base, facts, tags: [...base.tags, ...tags] }, { sources: [web('Bar'), exa] }).tags).not.toContain('neighborhood_spot')
  })

  it('no se deduce: precio, comida casera, "de toda la vida" o "de barrio" suelto no lo dan', () => {
    for (const text of ['Precios accesibles y comida casera', 'Amigos de toda la vida', 'Una pizzería de barrio', 'De los de antes', 'Un bolichito']) {
      expect(spot(run([text], [])), text).toBe(false)
    }
  })

  it('propuesto por el modelo con un fact sin la frase, se descarta', () => {
    const tags: PlaceExtraction['tags'] = [{ group: 'atmosphere', id: 'neighborhood_spot', facts: ['F1'] }]
    expect(spot(run(['Ambiente sencillo y precios bajos'], tags))).toBe(false)
    expect(spot(run(['Un bar de barrio con mesas de fórmica'], tags))).toBe(true)
  })
})

describe('postProcess: style', () => {
  it('casual con una señal', () => {
    const place = run(['Pizza por porción en el mostrador'], [{ group: 'style', id: 'casual', facts: ['F1'] }])
    expect(place.style).toBe('casual')
    expect(place.tagEvidence).toContainEqual({ tag: 'casual', mode: 'inferred', basis: 'signals', signals: ['por porción'], factIds: ['F1'] })
    expect(place.embeddingText).toContain('Estilo casual')
    expect(place.keywordText).toContain('descontracturado')
  })

  it('cuidado sin señal no queda: sale del ícono', () => {
    const place = run(['Abre de noche'], [{ group: 'style', id: 'cuidado', facts: ['F1'] }])
    expect(styleOf(place)).toEqual(BY_ICON)
    expect(place.placeFacts.find((fact) => fact.id === 'F1')?.supports).not.toContain('style.cuidado')
  })

  it('intermedio necesita algún fact', () => {
    expect(styleOf(run(['Carta de minutas y pastas'], [{ group: 'style', id: 'intermedio', facts: ['F1'] }]))).toEqual(['intermedio', 'signals'])
    expect(styleOf(run(['Carta de minutas y pastas'], [{ group: 'style', id: 'intermedio', facts: [] }]))).toEqual(BY_ICON)
  })

  it('dos styles distintos se contradicen: sale del ícono', () => {
    const place = run(['Cocina de autor', 'Por porción'], [{ group: 'style', id: 'cuidado', facts: ['F1'] }, { group: 'style', id: 'casual', facts: ['F2'] }])
    expect(styleOf(place)).toEqual(BY_ICON)
  })

  it('sin style del modelo, lo deduce de las señales de un solo estilo', () => {
    const place = run(['Ambiente informal y a la moda'], [])
    expect(place.style).toBe('casual')
    expect(place.tagEvidence).toContainEqual({ tag: 'casual', mode: 'inferred', basis: 'signals', signals: ['informal'], factIds: ['F1'] })
    expect(place.placeFacts.find((fact) => fact.id === 'F1')?.supports).toContain('style.casual')
    expect(styleOf(run(['Ambiente informal', 'Cocina de autor'], []))).toEqual(BY_ICON)
    expect(styleOf(run(['Abre de noche'], []))).toEqual(BY_ICON)
  })

  it('toques en vivo cuentan como música para groups', () => {
    const place = run(['Tienen toques en vivo', 'Sirven cócteles'], [{ group: 'goodFor', id: 'groups', facts: allFacts(2) }])
    expect(place.tags).toContain('groups')
  })

  it('sin señales sale del precio, y sin precio del ícono', () => {
    const withPrice = (price: PlaceExtraction['price']) => postProcess(target, {
      ...base, price, facts: [{ id: 'F1', text: 'Platos entre 300 y 500 pesos', sourceId: 'S1', kind: 'price', proposedTag: null }],
      support: [{ field: 'price', facts: ['F1'] }],
    }, { sources: [web('Platos entre 300 y 500 pesos')] })
    expect(styleOf(withPrice('low'))).toEqual(['casual', 'price'])
    expect(styleOf(withPrice('moderate'))).toEqual(['intermedio', 'price'])
    expect(styleOf(withPrice('high'))).toEqual(['cuidado', 'price'])
    expect(styleOf(withPrice('very_high'))).toEqual(['cuidado', 'price'])
    expect(withPrice('low').tagEvidence).toContainEqual({ tag: 'casual', mode: 'inferred', basis: 'price', signals: ['precio: low'], factIds: ['F1'] })
    // Las señales ganan al precio.
    const signals = postProcess(target, {
      ...base, price: 'very_high', facts: [{ id: 'F1', text: 'Ambiente informal', sourceId: 'S1', kind: 'other', proposedTag: null }],
    }, { sources: [web('Ambiente informal')] })
    expect(styleOf(signals)).toEqual(['casual', 'signals'])
    const icon = (iconCategory: PlaceExtraction['iconCategory']) => postProcess(target, { ...base, iconCategory }, { sources: [web('Bar')] })
    expect(icon('pizza').tagEvidence).toContainEqual({ tag: 'casual', mode: 'inferred', basis: 'icon', signals: ['ícono: pizza'], factIds: [] })
    for (const id of ['hot_dog', 'burger', 'fries', 'sandwich', 'beer_pub', 'ice_cream'] as const) expect(styleOf(icon(id)), id).toEqual(['casual', 'icon'])
    expect(styleOf(icon('wine'))).toEqual(BY_ICON)
    expect(icon('pizza').embeddingText).toContain('Estilo casual')
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
    expect(styleOf(mixed('Abre de noche', 'Ambiente informal', () => []))).toEqual(BY_ICON)
    expect(sufficientSignals([], signalsIn(MOMENT_SIGNALS.quick, [{ id: 'F2', text: 'Se come al paso' }]))).toBeNull()
  })
})

describe('señales débiles de style', () => {
  it('reservas recomendadas sola no alcanza para cuidado', () => {
    expect(styleOf(run(['Se recomienda reservar'], [{ group: 'style', id: 'cuidado', facts: ['F1'] }]))).toEqual(BY_ICON)
  })

  it('casual con dos débiles distintas', () => {
    expect(styleOf(run(['Hamburguesería'], [{ group: 'style', id: 'casual', facts: ['F1'] }]))).toEqual(BY_ICON)
    const place = run(['Hamburguesería con combos', 'Ambiente relajado'], [{ group: 'style', id: 'casual', facts: allFacts(2) }])
    expect(place.style).toBe('casual')
    expect(place.tagEvidence).toContainEqual({ tag: 'casual', mode: 'inferred', basis: 'signals', signals: ['hamburguesería', 'combos'], factIds: ['F1'] })
  })
})
