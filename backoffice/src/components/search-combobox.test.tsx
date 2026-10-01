import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchCombobox } from './search-combobox'

afterEach(cleanup)

describe('SearchCombobox', () => {
  it('se puede recorrer y elegir usando el teclado', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SearchCombobox
        id="barrio-test"
        label="Barrio"
        placeholder="Seleccionar barrio"
        searchPlaceholder="Buscar barrio..."
        emptyMessage="Sin resultados"
        options={[
          { value: 'Centro', label: 'Centro' },
          { value: 'Pocitos', label: 'Pocitos' },
        ]}
        value=""
        onChange={onChange}
      />,
    )

    await user.tab()
    const trigger = screen.getByRole('combobox', { name: 'Barrio' })
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')

    const input = await screen.findByPlaceholderText('Buscar barrio...')
    expect(input).toHaveFocus()
    await user.type(input, 'poci')
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('Pocitos')
  })
})
