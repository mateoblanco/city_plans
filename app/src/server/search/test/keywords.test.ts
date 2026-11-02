import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { candidatesQuery } from '../candidates'
import { keywordFilter } from '../keywords'
import { emptyInterpretation } from '../interpretation'
import { filtersFor } from '../search'

const dialect = new PgDialect()
const scores = { embedding: null, name: null, origins: [], pinnedId: null }

describe('sinónimos de varias palabras como frase completa', () => {
  it('una palabra que sólo existe dentro de frases exige que el lugar no tenga la frase', () => {
    const filter = keywordFilter(['ver', 'atardecer'], 'lugar para ver el atardecer')!
    expect(filter).toContain('(ver & ')
    expect(filter).toContain('!(ver <-> futbol)')
    expect(filter).toContain('!(ver <-> el <-> partido)')
    expect(filter.endsWith(' | atardecer')).toBe(true)
  })

  it('con la frase pedida en el texto, la palabra cuenta sin condición', () => {
    expect(keywordFilter(['ver', 'futbol'], 'ver futbol')).toBeNull()
    expect(keywordFilter(['ver', 'partido'], 'ver el partido')).toBeNull()
  })

  it('con la frase armada por las keywords (un plato del modelo) también', () => {
    expect(keywordFilter(['milanesa', 'napolitana'], 'milanga napolitana')).toBeNull()
  })

  it('una palabra con sinónimo propio no cambia', () => {
    expect(keywordFilter(['futbol'], 'futbol')).toBeNull()
    expect(keywordFilter(['terraza'], 'terraza')).toBeNull()
    expect(keywordFilter(['plantas'], 'cafe con plantas')).toBeNull()
    expect(keywordFilter([], 'algo')).toBeNull()
  })

  it('no arma frases que to_tsquery no acepta', () => {
    expect(keywordFilter(['lgbtq'], 'lgbtq')).toBeNull()
  })

  it('el SQL sólo agrega la condición si hay filtro', () => {
    const filters = filtersFor(emptyInterpretation(), null, [])
    const plain = dialect.sqlToQuery(candidatesQuery(filters, { ...scores, keywords: ['pizza'] }))
    expect(plain.sql).not.toContain('case when search_tsv @@')
    const guarded = dialect.sqlToQuery(candidatesQuery(filters, { ...scores, keywords: ['ver'], keywordFilter: '(ver & !(ver <-> futbol))' }))
    expect(guarded.sql).toContain('case when search_tsv @@ to_tsquery')
    expect(guarded.params).toContain('(ver & !(ver <-> futbol))')
    expect(guarded.params).toContain('ver')
  })
})
