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

  it('muestra el style y si cada momento es explícito o inferido, con la señal', () => {
    render(
      <PlaceTagsEvidence
        place={{
          categories: ['bar'],
          tags: ['groups'],
          style: 'casual',
          tagEvidence: [
            { tag: 'groups', mode: 'inferred', signals: ['picada para compartir'], factIds: ['F1'] },
            { tag: 'casual', mode: 'inferred', signals: ['de barrio'], factIds: ['F2'] },
          ],
          placeFacts: [
            { id: 'F1', text: 'picadas para compartir', kind: 'food', sourceId: 'S1', sourceUrl: 'https://bar.example/', trust: 'official', supports: ['goodFor.groups'] },
            { id: 'F2', text: 'bar de barrio', kind: 'other', sourceId: 'S1', sourceUrl: 'https://bar.example/', trust: 'official', supports: ['style.casual'] },
          ],
        }}
      />,
    )

    const section = screen.getByRole('region', { name: 'Tags y su respaldo' })
    expect(within(section).getByText('Grupos').closest('li')).toHaveTextContent('Inferido: picada para compartir')
    const style = within(section).getByText('Casual').closest('li')!
    expect(style).toHaveTextContent('Inferido: de barrio')
    expect(style).toHaveTextContent('F2 · bar de barrio (Oficial)')
  })

  it('no muestra nada si el borrador no tiene tags', () => {
    const { container } = render(<PlaceTagsEvidence place={{ categories: [], tags: [], placeFacts: [] }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
