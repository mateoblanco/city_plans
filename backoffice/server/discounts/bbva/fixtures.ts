import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const BASE = 'https://www.bbva.com.uy/personas/productos/tarjetas/descuentos/'
export const LISTING_URL = `${BASE}gastronomia.html`

/** HTML guardado de BBVA (noviembre 2026), sin scripts, estilos, menú ni pie. */
export const fixture = (name: string) => readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8')
