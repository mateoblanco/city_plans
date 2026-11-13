import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { SEARCH_CONFIG } from '../../search/config'
import { WELCOME_POOL, welcomePoolQuery, welcomeSearchQuery } from '../queries'

const dialect = new PgDialect()
const render = (query: ReturnType<typeof welcomePoolQuery>) => dialect.sqlToQuery(query)

describe('consultas de la bienvenida', () => {
  it('pool: publicados, una sucursal por marca, sin cadenas, los más prominentes', () => {
    const { sql, params } = render(welcomePoolQuery())
    expect(sql).toContain("p.status = 'published'")
    expect(sql).toContain('distinct on (coalesce(p.brand_key, p.id::text))')
    expect(sql).toMatch(/"brandCount" < \$\d/)
    expect(params).toContain(SEARCH_CONFIG.personal.chainMinBranches)
    expect(params).toContain(WELCOME_POOL)
  })

  it('búsqueda: parcial y sin tildes sobre el nombre, sin comodines del usuario', () => {
    const { sql, params } = render(welcomeSearchQuery('caf%e_'))
    expect(sql).toContain('f_unaccent(lower(p.name)) like f_unaccent(lower($1))')
    expect(sql).toContain("p.status = 'published'")
    expect(params[0]).toBe('%cafe%')
  })
})
