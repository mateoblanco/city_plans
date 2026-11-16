import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MARKER_ICONS } from '@/components/pages/SearchPage/Results/Map/SearchMap/marker-icons'

/**
 * El marcador de la imagen de Static Maps (ficha en mobile) es un PNG público en public/map-markers/, uno por ícono
 * del mapa más default.png. Se generan con `yarn tsx scripts/map-marker-pngs.mts`.
 */
const DIR = path.resolve(import.meta.dirname, '../../../../public/map-markers')

describe('PNG del marcador de Static Maps', () => {
  it('uno por ícono de MARKER_ICONS, más default.png, y ninguno de más', () => {
    const files = fs.readdirSync(DIR).filter((file) => file.endsWith('.png')).sort()
    expect(files).toEqual([...Object.keys(MARKER_ICONS).map((key) => `${key}.png`), 'default.png'].sort())
  })

  it('dentro del límite de Static Maps (4096 px²)', () => {
    for (const file of fs.readdirSync(DIR)) {
      const png = fs.readFileSync(path.join(DIR, file))
      // Ancho y alto del encabezado IHDR.
      expect(png.readUInt32BE(16) * png.readUInt32BE(20), file).toBeLessThanOrEqual(4096)
    }
  })
})
