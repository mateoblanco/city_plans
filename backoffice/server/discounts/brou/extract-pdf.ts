import { getDocumentProxy } from 'unpdf'
import { DEPARTMENTS } from '../geo.ts'
import { cleanText, fold } from '../text.ts'

/**
 * Los locales de un departamento, como celdas de texto del PDF en el orden en que están escritas: fila por fila,
 * nombre, dirección y ciudad. En el texto plano del PDF el nombre y la dirección quedan pegados ("BURGER HOUSE 284
 * PIEDRAS 284"); las filas las arma split-rows.ts.
 */
export type DepartmentBlock = {
  department: (typeof DEPARTMENTS)[number]
  /** Páginas del PDF (1 = la primera) de las que salió. */
  pages: number[]
  fragments: string[]
}

const PAGE_TITLE = /^comercios adheridos/
const HEADER = ['nombre comercial', 'direccion', 'ciudad']
const BY_FOLDED = new Map(DEPARTMENTS.map((name) => [fold(name), name]))

/**
 * Las celdas de texto de cada página, en el orden del PDF. Una celda de varias líneas viene en varios fragmentos: el
 * fragmento con `hasEOL` sigue en el próximo ("AVENIDA GRAL. JOSÉ G. ARTIGAS" + "1191"), y se juntan.
 */
export async function pdfFragments(bytes: Uint8Array): Promise<string[][]> {
  // pdfjs se queda con el buffer: una copia, así quien llama puede seguir usando el suyo.
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const pages: string[][] = []
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const content = await (await pdf.getPage(number)).getTextContent()
    const cells: string[] = []
    let continues = false
    for (const item of content.items) {
      if (!('str' in item)) continue
      const text = cleanText(item.str)
      // Los fragmentos vacíos con hasEOL son sólo saltos de línea entre celdas.
      if (!text) continue
      if (continues && cells.length > 0) cells[cells.length - 1] = `${cells[cells.length - 1]} ${text}`
      else cells.push(text)
      continues = item.hasEOL
    }
    pages.push(cells)
  }
  return pages
}

/**
 * Un bloque por departamento. Cada tabla empieza con el título del departamento seguido del encabezado "NOMBRE
 * COMERCIAL · DIRECCIÓN · CIUDAD"; un departamento que sigue en la página siguiente (Maldonado, Montevideo) se junta.
 * El título se reconoce por estar justo antes del encabezado (una ciudad "MONTEVIDEO" en una fila no es un título).
 */
export function departmentBlocks(pages: string[][]): { blocks: DepartmentBlock[]; problems: string[] } {
  const blocks = new Map<string, DepartmentBlock>()
  const problems: string[] = []
  pages.forEach((fragments, pageIndex) => {
    let current: DepartmentBlock | null = null
    for (let index = 0; index < fragments.length; index += 1) {
      const folded = fold(fragments[index])
      if (PAGE_TITLE.test(folded)) continue
      if (HEADER.every((word, offset) => fold(fragments[index + 1 + offset] ?? '') === word)) {
        const department = BY_FOLDED.get(folded)
        if (!department) {
          problems.push(`Página ${pageIndex + 1}: «${fragments[index]}» está antes del encabezado y no es un departamento.`)
          current = null
        } else {
          current = blocks.get(department) ?? { department, pages: [], fragments: [] }
          blocks.set(department, current)
          if (!current.pages.includes(pageIndex + 1)) current.pages.push(pageIndex + 1)
        }
        index += HEADER.length
        continue
      }
      if (current) current.fragments.push(fragments[index])
      else problems.push(`Página ${pageIndex + 1}: «${fragments[index]}» está fuera de una tabla de departamento.`)
    }
  })
  return { blocks: [...blocks.values()].filter((block) => block.fragments.length > 0), problems }
}
