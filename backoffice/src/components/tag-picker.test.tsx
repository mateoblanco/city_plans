import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FOODS, CATEGORIES, type TagId } from '@/data/tags'
import { TagPicker } from './tag-picker'

afterEach(cleanup)

const groups = [{ heading: 'Comidas', tags: FOODS }, { heading: 'Categorías', tags: CATEGORIES }]

describe('TagPicker', () => {
  it('escribir "mila" muestra Milanesas sin recorrer los grupos, y elegirla la agrega', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TagPicker noun="tag" groups={groups} value={['pizza' as TagId]} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Agregar tag' }))
    await user.type(screen.getByPlaceholderText('Buscar tag…'), 'mila')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Milanesas'])
    await user.click(screen.getByRole('option', { name: 'Milanesas' }))
    expect(onChange).toHaveBeenCalledWith(['pizza', 'milanesa'])
  })

  it('busca sin acentos y por sinónimos', async () => {
    const user = userEvent.setup()
    render(<TagPicker noun="tag" groups={groups} value={[]} onChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Agregar tag' }))
    const input = screen.getByPlaceholderText('Buscar tag…')

    await user.type(input, 'pizzeria')
    expect(screen.getByRole('option', { name: 'Pizzería' })).toBeTruthy()
    await user.clear(input)
    await user.type(input, 'milanga')
    expect(screen.getByRole('option', { name: 'Milanesas' })).toBeTruthy()
  })

  it('con el máximo no deja agregar más', () => {
    render(<TagPicker noun="tag" groups={groups} value={['pizza', 'milanesa'] as TagId[]} max={2} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Agregar tag' })).toBeDisabled()
  })
})
