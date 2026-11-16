import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ViewAllCard from '../ViewAllCard'

const render = (logos: { id: string; name: string; logoUrl: string | null; logoBgColor: string | null }[]) =>
  renderToStaticMarkup(createElement(ViewAllCard, { href: '/search?intent=eat&sub=dinner', label: 'Ver todos: Para cenar', logos }))

describe('ViewAllCard', () => {
  it('un único link con el nombre de la fila, al destino de la flecha', () => {
    const html = render([{ id: 'a', name: 'A', logoUrl: 'https://logos.test/a.png', logoBgColor: null }])
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain('href="/search?intent=eat&amp;sub=dinner"')
    expect(html).toContain('aria-label="Ver todos: Para cenar"')
    expect(html).toMatch(/<a [^>]*>Ver todos<\/a>/)
  })

  it('un logo por extra, decorativo (alt="", lazy); sin logo, el placeholder con el nombre de PlaceImage', () => {
    const html = render([
      { id: 'a', name: 'A', logoUrl: 'https://logos.test/a.png', logoBgColor: null },
      { id: 'b', name: 'B', logoUrl: 'https://logos.test/b.png', logoBgColor: '#123456' },
      { id: 'c', name: 'Sin Logo', logoUrl: null, logoBgColor: null },
    ])
    const images = html.match(/<img [^>]*>/g) ?? []
    expect(images).toHaveLength(2)
    expect(images.every((img) => img.includes('alt=""') && img.includes('loading="lazy"') && img.includes('width="60"') && img.includes('height="66"'))).toBe(true)
    expect(html.match(/data-size="sm"/g)).toHaveLength(3)
    expect(html).toContain('>Sin Logo</span>')
    expect(html).toMatch(/aria-hidden="true"/)
  })
})
