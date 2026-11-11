import { describe, expect, it } from 'vitest'
import { departmentBlocks, pdfFragments } from './extract-pdf.ts'
import { listadoPdf } from './fixtures.ts'

describe('PDF del listado de BROU', () => {
  it('el PDF real: un bloque por departamento, con las celdas de cada fila en orden y las de varias líneas juntas', async () => {
    const { blocks, problems } = departmentBlocks(await pdfFragments(listadoPdf()))
    expect(problems).toEqual([])
    expect(blocks.map((block) => block.department)).toEqual([
      'Artigas', 'Canelones', 'Cerro Largo', 'Colonia', 'Durazno', 'Flores', 'Florida', 'Lavalleja', 'Maldonado', 'Montevideo',
      'Paysandú', 'Río Negro', 'Rocha', 'Salto', 'San José', 'Soriano', 'Tacuarembó', 'Treinta y Tres',
    ])
    // Tres celdas por local (nombre, dirección, ciudad): las tablas vienen limpias.
    expect(blocks.map((block) => block.fragments.length / 3)).toEqual([3, 10, 2, 8, 1, 2, 2, 2, 20, 43, 7, 2, 9, 5, 3, 2, 3, 1])
    const montevideo = blocks.find((block) => block.department === 'Montevideo')!
    // Montevideo sigue en tres páginas; el título de cada una no se repite como fila.
    expect(montevideo.pages).toEqual([6, 7, 8])
    expect(montevideo.fragments.slice(0, 6)).toEqual(['ALFAJORES DEL URUGUAY', 'PÉREZ CASTELLANO 1660', 'MONTEVIDEO', 'AMARANTO RESTO CAFÉ', 'MERCEDES 871', 'MONTEVIDEO'])
    expect(montevideo.fragments).toContain('BURGER HOUSE 284')
    expect(montevideo.fragments).toContain('TOSCO - PATIO CERVECERO & RESTOBAR')
    const maldonado = blocks.find((block) => block.department === 'Maldonado')!
    expect(maldonado.pages).toEqual([4, 5])
    expect(maldonado.fragments).toEqual(expect.arrayContaining(['ESCUELA ALTA GASTRONOMÍA PEDRO FIGARI', 'RAMBLA WILLIMAN Y PDA 12 SN']))
    const artigas = blocks.find((block) => block.department === 'Artigas')!
    expect(artigas.fragments.slice(0, 3)).toEqual(['CALIS', 'AVENIDA GRAL. JOSÉ G. ARTIGAS 1191', 'ARTIGAS'])
  })

  it('una ciudad con nombre de departamento en una fila no abre otro bloque; algo antes del encabezado que no es departamento es un problema', () => {
    const page = ['COMERCIOS ADHERIDOS POR LOCALIDAD', 'PAYSANDÚ', 'NOMBRE COMERCIAL', 'DIRECCIÓN', 'CIUDAD', 'VIEJO MERCADO', 'MONTEVIDEO 859', 'PAYSANDÚ']
    const { blocks } = departmentBlocks([page])
    expect(blocks).toEqual([{ department: 'Paysandú', pages: [1], fragments: ['VIEJO MERCADO', 'MONTEVIDEO 859', 'PAYSANDÚ'] }])
    expect(departmentBlocks([['HELADERÍAS', 'NOMBRE COMERCIAL', 'DIRECCIÓN', 'CIUDAD', 'X', 'Y', 'Z']]).problems).toEqual([
      'Página 1: «HELADERÍAS» está antes del encabezado y no es un departamento.',
      'Página 1: «X» está fuera de una tabla de departamento.',
      'Página 1: «Y» está fuera de una tabla de departamento.',
      'Página 1: «Z» está fuera de una tabla de departamento.',
    ])
  })
})
