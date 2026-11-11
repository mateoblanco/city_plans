import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { discountProviders } from '../providers.ts'

export const ITAU = discountProviders().find((provider) => provider.id === 'itau')!
export const PERSONAL_BANK = discountProviders().find((provider) => provider.id === 'itau-personal-bank')!
export const PAGE = (name: string) => `https://www.itau.com.uy/inst/${name}.html`

/** HTML guardado de Itaú (noviembre 2026), sin scripts, estilos, formularios, menú ni pie. */
export const fixture = (name: string) => readFileSync(join(import.meta.dirname, '__fixtures__', `${name}.html`), 'utf8')
