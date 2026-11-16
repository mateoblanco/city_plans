import { describe, expect, it } from 'vitest'
import { viewAllCard, viewAllLabel } from '../view-all'

const logo = (id: string) => ({ id, name: id, logoUrl: null, logoBgColor: null })

describe('card "Ver todos" de una fila de la home', () => {
  it('aparece con link y algún extra; lleva al mismo destino y con el mismo nombre que la flecha del título', () => {
    const row = { title: 'Para cenar', href: '/search?intent=eat&sub=dinner&f=open%3Anow&loc=all', more: [logo('a'), logo('b')] }
    expect(viewAllCard(row)).toEqual({ href: row.href, label: viewAllLabel(row.title), logos: row.more })
    expect(viewAllLabel('Para cenar')).toBe('Ver todos: Para cenar')
  })

  it('no aparece sin extras (la fila ya muestra todo) ni sin "Ver todos" (Guardados, Para vos)', () => {
    expect(viewAllCard({ title: 'Para cenar', href: '/search', more: [] })).toBeNull()
    expect(viewAllCard({ title: 'Para cenar', href: '/search' })).toBeNull()
    expect(viewAllCard({ title: 'Para vos', href: null, more: [logo('a')] })).toBeNull()
  })
})
