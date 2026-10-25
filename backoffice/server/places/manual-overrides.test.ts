import { describe, expect, it } from 'vitest'
import { editedFields, parseManualOverrides } from '../../src/data/manual-overrides.ts'
import { applyOverrides, changedEditFields, mergeEdit, overridesAffectSearch, type EditableValues } from './manual-overrides.ts'

const current: EditableValues = {
  name: 'El Palenque', tags: ['seafood', 'terrace'], style: 'casual', iconCategory: 'grill', price: 'high',
  dietVegan: 'unknown', dietVegetarian: 'has_options', dietGlutenFree: 'no', instagram: '@ElPalenque', website: null, brandKey: null,
}

describe('applyOverrides', () => {
  it('pone los campos de un valor encima de lo automático, sólo en las claves que vienen', () => {
    const final = applyOverrides({ name: 'Palenque SA', price: 'low', igFollowers: 10 }, { name: 'El Palenque', price: 'high', style: 'cuidado', instagram: null })
    expect(final).toEqual({ name: 'El Palenque', price: 'high', igFollowers: 10 })
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

  it('sin overrides devuelve lo mismo', () => {
    expect(applyOverrides({ tags: ['a'], name: 'X' }, {})).toEqual({ tags: ['a'], name: 'X' })
  })

  it('sabe qué overrides cambian los textos de búsqueda', () => {
    expect(overridesAffectSearch({ price: 'low', website: null, instagram: 'x' })).toBe(false)
    expect(overridesAffectSearch({ diet_vegan: 'fully' })).toBe(true)
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
