import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { discountProvider } from '../providers.ts'
import type { BrouRow } from './split-rows.ts'

export const BROU = discountProvider('brou')!
export const CAMPAIGN = 'https://beneficios.brou.com.uy/gastronomia/gastronomia-verano-2026-2027'
export const PDF = 'https://beneficios.brou.com.uy/pdf/Listado%20GASTRONOMIA%206.11.26.pptx.pdf'

const path = (name: string) => join(import.meta.dirname, '__fixtures__', name)
/** La página de la campaña (noviembre 2026), sin scripts, estilos, menú, formularios ni pie. */
export const campaignHtml = () => readFileSync(path('campaign.html'), 'utf8')
/** El PDF real del listado ("Listado GASTRONOMIA 6.11.26.pptx.pdf"). */
export const listadoPdf = () => new Uint8Array(readFileSync(path('listado-gastronomia.pdf')))
/** La separación de Haiku de cada departamento de ese PDF, grabada una vez (validada con validateRows). */
export const recordedSplit = () => JSON.parse(readFileSync(path('split-rows.json'), 'utf8')) as Record<string, BrouRow[]>
