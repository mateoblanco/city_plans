import { describe, expect, it } from 'vitest'
import { editedFields, parseManualOverrides } from '../../src/data/manual-overrides.ts'
import { applyOverrides, changedEditFields, mergeEdit, type EditableValues } from './manual-overrides.ts'
import { PlaceEdit } from '../../src/data/manual-overrides.ts'

const current: EditableValues = {
  name: 'El Palenque', tags: ['seafood', 'terrace'], style: 'casual', iconCategory: 'grill', price: 'high',
  dietVegan: 'unknown', dietVegetarian: 'has_options', dietGlutenFree: 'no', instagram: '@ElPalenque', website: null, brandKey: null, chainBranch: false,
  hours: { slots: [{ day: 1, opens: '12:00', closes: '16:00' }], status: 'exact', source: 'official' },
  dishes: ['pulpo a la gallega', 'chivito'], signature: ['seafood'], highlights: [{ es: 'Pulpo a la gallega', en: 'Galician-style octopus' }],
  categories: ['grill'], neighborhoodId: 'Ciudad Vieja', locatedIn: 'Mercado del Puerto', reservations: 'unknown',
}

describe('applyOverrides', () => {
  it('pone los campos de un valor encima de lo automático, sólo en las claves que vienen', () => {
    const final = applyOverrides({ name: 'Palenque SA', price: 'low', igFollowers: 10 }, { name: 'El Palenque', price: 'high', style: 'cuidado', instagram: null })
    expect(final).toEqual({ name: 'El Palenque', price: 'high', igFollowers: 10 })
  })

  it('horario manual: pisa el de la re-extracción y late_night sale de sus turnos, salvo un tag fijado a mano', () => {
    const extracted = { slots: [{ day: 5, opens: '20:00', closes: '03:00' }], status: 'exact' as const, source: 'official' as const }
    const hours = { slots: [{ day: 5, opens: '20:00', closes: '23:00' }] }
    const final = applyOverrides({ hours: extracted, tags: ['seafood', 'late_night'], signature: ['late_night'] }, { hours })
    expect(final.hours).toMatchObject({ slots: hours.slots, status: 'exact', source: 'manual', raw: 'Viernes: 20:00–23:00' })
    expect(final.tags).toEqual(['seafood'])
    expect(applyOverrides({ hours: extracted, tags: ['seafood'] }, { hours: { slots: [{ day: 5, opens: '20:00', closes: '02:00' }] } }).tags).toEqual(['seafood', 'late_night'])
    expect(applyOverrides({ hours: extracted, tags: ['seafood', 'late_night'] }, { hours, tags: { add: ['late_night'], remove: [] } }).tags).toEqual(['seafood', 'late_night'])
    // Un camino que no escribe hours ni tags no los toca.
    expect(applyOverrides({ igFollowers: 3 }, { hours })).toEqual({ igFollowers: 3 })
  })

  it('tags: los automáticos sin los sacados, más los agregados; signature sin los sacados', () => {
    const final = applyOverrides({ tags: ['seafood', 'groups', 'terrace'], signature: ['seafood', 'groups'] }, { tags: { add: ['date'], remove: ['seafood'] } })
    expect(final).toEqual({ tags: ['groups', 'terrace', 'date'], signature: ['groups'] })
  })

  it('el logo subido a mano reemplaza todas las columnas del logo', () => {
    const logo = { key: 'logos/x-0123abcd.webp', kind: 'logo' as const, bgColor: '#ffffff', color: '#000000', source: 'manual' as const, fetchedAt: '2026-10-20T12:00:00.000Z' }
    expect(applyOverrides({ logoKey: 'logos/x-ffffffff.webp', logoKind: 'person' }, { logo })).toEqual({
      logoKey: logo.key, logoKind: 'logo', logoBgColor: '#ffffff', logoColor: '#000000', logoSource: 'manual', logoFetchedAt: new Date(logo.fetchedAt),
    })
    expect(applyOverrides({ prominence: 0.5 }, { logo })).toEqual({ prominence: 0.5 })
  })

  it('chain_branch a mano: la prominencia se recalcula con ese valor si vienen los seguidores', () => {
    expect(applyOverrides({ igFollowers: 10_000, chainBranch: true, prominence: 0.68 }, { chain_branch: false }))
      .toEqual({ igFollowers: 10_000, chainBranch: false, prominence: expect.closeTo(0.8, 4) })
    expect(applyOverrides({ igFollowers: null, chainBranch: false, prominence: 0.5 }, { chain_branch: true }))
      .toEqual({ igFollowers: null, chainBranch: true, prominence: 0.5 })
  })

  it('sin overrides devuelve lo mismo', () => {
    expect(applyOverrides({ tags: ['a'], name: 'X' }, {})).toEqual({ tags: ['a'], name: 'X' })
  })
})

describe('mergeEdit', () => {
  it('los campos de un valor que cambian guardan el valor; los que no cambian no se bloquean', () => {
    const next = mergeEdit({ status: 'published' }, current, { name: 'Palenque', price: 'high', instagram: 'elpalenque', website: null, featured: true })
    expect(next).toEqual({ status: 'published', name: 'Palenque' })
  })

  it('tags: los agregados van a add y salen de remove; los sacados, al revés', () => {
    const first = mergeEdit({}, current, { tags: ['terrace', 'date'] })
    expect(first.tags).toEqual({ add: ['date'], remove: ['seafood'] })
    // Volver a poner uno sacado: sale de remove y queda agregado a mano (no se sabe si el pipeline lo vuelve a dar).
    const back = mergeEdit(first, { ...current, tags: ['terrace', 'date'] }, { tags: ['terrace', 'date', 'seafood'] })
    expect(back.tags).toEqual({ add: ['date', 'seafood'], remove: [] })
    const removed = mergeEdit(back, { ...current, tags: ['terrace', 'date', 'seafood'] }, { tags: ['terrace', 'date'] })
    expect(removed.tags).toEqual({ add: ['date'], remove: ['seafood'] })
  })

  it('sacar un tag agregado a mano lo deja sacado; sin cambios en los tags, la diferencia queda igual', () => {
    const added = mergeEdit({}, current, { tags: ['seafood', 'terrace', 'date'] })
    expect(mergeEdit(added, { ...current, tags: ['seafood', 'terrace', 'date'] }, { tags: ['seafood', 'terrace'] }).tags).toEqual({ add: [], remove: ['date'] })
    expect(mergeEdit({ tags: { add: ['date'], remove: [] } }, { ...current, tags: ['seafood', 'terrace', 'date'] }, { tags: ['seafood', 'terrace', 'date'] }).tags)
      .toEqual({ add: ['date'], remove: [] })
  })

  it('un null (sin Instagram, sin style) también queda bloqueado', () => {
    expect(mergeEdit({}, current, { instagram: null, style: null })).toEqual({ instagram: null, style: null })
  })

  it('changedEditFields compara el Instagram sin @ ni mayúsculas y los tags sin orden', () => {
    expect(changedEditFields(current, { instagram: 'elpalenque', tags: ['terrace', 'seafood'], name: 'El Palenque' })).toEqual([])
  })
})

describe('parseManualOverrides y editedFields', () => {
  it('lee el jsonb y descarta claves inválidas o desconocidas', () => {
    expect(parseManualOverrides({ status: 'published', style: 'carísimo', tags: { add: ['terrace'], remove: [] }, embedding: true })).toEqual({
      status: 'published', tags: { add: ['terrace'], remove: [] },
    })
    expect(parseManualOverrides(['status'])).toEqual({})
    expect(parseManualOverrides(null)).toEqual({})
  })

  it('editado a mano: sin Publicar ni motivos, y sin una diferencia de tags vacía', () => {
    expect(editedFields({ status: 'published', review_reasons: [], instagram: null, tags: { add: [], remove: [] } })).toEqual(['instagram'])
  })
})

describe('platos (dishes)', () => {
  it('agregar uno y sacar uno guarda la diferencia; una re-extracción suma el nuevo pero no vuelve a poner el sacado', () => {
    // El modal manda la lista completa: saca "chivito" y agrega "Milanesa Napolitana" (se guarda en minúscula).
    const edit = PlaceEdit.parse({ dishes: ['pulpo a la gallega', 'Milanesa  Napolitana'] })
    expect(changedEditFields(current, edit)).toEqual(['dishes'])
    const overrides = mergeEdit({}, current, edit)
    expect(overrides.dishes).toEqual({ add: ['milanesa napolitana'], remove: ['chivito'] })
    expect(editedFields(overrides)).toEqual(['dishes'])

    // La re-extracción trae uno nuevo (ñoquis) y el que se sacó (chivito).
    const final = applyOverrides({ dishes: ['pulpo a la gallega', 'chivito', 'ñoquis'] }, overrides)
    expect(final.dishes).toEqual(['pulpo a la gallega', 'ñoquis', 'milanesa napolitana'])
    // Si el pipeline también trae el agregado, no se repite.
    expect(applyOverrides({ dishes: ['Milanesa napolitana'] }, overrides).dishes).toEqual(['Milanesa napolitana'])
  })

  it('volver a poner uno sacado lo saca de remove; sacar uno agregado lo saca de add (como los tags)', () => {
    const overrides = { dishes: { add: ['milanesa napolitana'], remove: ['chivito'] } }
    const saved = { ...current, dishes: ['pulpo a la gallega', 'milanesa napolitana'] }
    expect(mergeEdit(overrides, saved, { dishes: ['pulpo a la gallega', 'chivito'] }).dishes).toEqual({ add: ['chivito'], remove: ['milanesa napolitana'] })
    // Sin cambios (misma lista en otro orden o mayúsculas), no cuenta como edición.
    expect(changedEditFields(saved, { dishes: ['milanesa napolitana', 'pulpo a la gallega'] })).toEqual([])
  })

  it('un camino que no escribe dishes no los toca', () => {
    expect(applyOverrides({ igFollowers: 3 }, { dishes: { add: ['chivito'], remove: [] } })).toEqual({ igFollowers: 3 })
  })
})

describe('signature, categorías y demás campos de un valor', () => {
  it('signature a mano manda sobre el del pipeline, sin los tags que ya no están', () => {
    const overrides = { signature: ['terrace', 'seafood'] } as const
    const final = applyOverrides({ tags: ['seafood', 'terrace'], signature: ['seafood'] }, { signature: [...overrides.signature] })
    expect(final.signature).toEqual(['terrace', 'seafood'])
    // Con terrace sacado a mano, sale también del signature.
    expect(applyOverrides({ tags: ['seafood', 'terrace'], signature: [] }, { signature: [...overrides.signature], tags: { add: [], remove: ['terrace'] } }).signature).toEqual(['seafood'])
  })

  it('sacar un tag en el modal lo saca también del signature guardado', () => {
    const overrides = mergeEdit({ signature: ['seafood', 'terrace'] }, { ...current, signature: ['seafood', 'terrace'] }, { tags: ['seafood'] })
    expect(overrides.signature).toEqual(['seafood'])
  })

  it('categorías, barrio, "dentro de", reservas y destacados quedan bloqueados ante una re-extracción', () => {
    const overrides = {
      categories: ['restaurant' as const, 'pizzeria' as const], neighborhood_id: 'Pocitos' as const, located_in: null,
      reservations: 'recommended' as const, highlights: [{ es: 'Fainá', en: '' }],
    }
    const auto = { categories: ['grill'], neighborhoodId: 'Ciudad Vieja', locatedIn: 'Mercado del Puerto', reservations: 'accepts' as const, highlights: [{ es: 'Pulpo', en: 'Octopus' }] }
    expect(applyOverrides(auto, overrides)).toEqual({
      categories: ['restaurant', 'pizzeria'], neighborhoodId: 'Pocitos', locatedIn: null, reservations: 'recommended', highlights: [{ es: 'Fainá', en: '' }],
    })
    expect(editedFields(overrides)).toEqual(['highlights', 'categories', 'neighborhood_id', 'located_in', 'reservations'])
  })

  it('destacados: el en se conserva en los que quedan y los nuevos van vacíos', () => {
    const overrides = mergeEdit({}, current, { highlights: ['pulpo a la gallega', 'Fainá'] })
    expect(overrides.highlights).toEqual([{ es: 'pulpo a la gallega', en: 'Galician-style octopus' }, { es: 'Fainá', en: '' }])
  })

  it('el schema de la edición limita signature a 3 y las categorías al catálogo', () => {
    expect(PlaceEdit.safeParse({ signature: ['seafood', 'terrace', 'groups', 'date'] }).success).toBe(false)
    expect(PlaceEdit.safeParse({ categories: ['karaoke'] }).success).toBe(false)
    expect(PlaceEdit.safeParse({ categories: [] }).success).toBe(false)
    expect(PlaceEdit.safeParse({ neighborhoodId: 'Narnia' }).success).toBe(false)
  })
})
