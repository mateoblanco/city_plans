import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { discountProviders } from '../providers.ts'
import { santanderPageUrl } from './reader.ts'

export const SANTANDER = discountProviders().find((provider) => provider.id === 'santander')!
export const DETAIL = 'https://www.santander.com.uy/beneficios/'
export const pageUrl = (page: number) => santanderPageUrl(SANTANDER, page)

/** HTML guardado de Santander (noviembre 2026), sin scripts, estilos, formularios, menú ni pie. */
export const fixture = (name: string) => readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8')
