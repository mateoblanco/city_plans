import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PlaceTagsEvidence } from './place-tags-evidence'

afterEach(cleanup)

describe('PlaceTagsEvidence', () => {
  it('muestra cada tag con el fact que lo respalda y marca los agregados por regla', () => {
    render(
      <PlaceTagsEvidence
        place={{
          categories: ['bar'],
          tags: ['dj', 'drinks'],
          placeFacts: [
            { id: 'F1', text: 'pone DJ los viernes', kind: 'feature', sourceId: 'S1', sourceUrl: 'https://www.instagram.com/local/', trust: 'official', supports: ['features.dj'] },
            { id: 'F2', text: 'es un bar de barrio', kind: 'other', sourceId: 'S2', sourceUrl: 'https://exa.ai/', trust: 'third_party', supports: ['categories.bar'] },
          ],
        }}
      />,
    )

    const section = screen.getByRole('region', { name: 'Tags y su respaldo' })
    const dj = within(section).getByText('DJ').closest('li')!
    expect(dj).toHaveTextContent('F1 · pone DJ los viernes (Oficial)')
    const bar = within(section).getByText('Bar').closest('li')!
    expect(bar).toHaveTextContent('F2 · es un bar de barrio (Terceros)')
    const drinks = within(section).getByText('Tomar algo').closest('li')!
    expect(drinks).toHaveTextContent('Agregado por regla (categoría u horarios)')
  })

  it('no muestra nada si el borrador no tiene tags', () => {
    const { container } = render(<PlaceTagsEvidence place={{ categories: [], tags: [], placeFacts: [] }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
