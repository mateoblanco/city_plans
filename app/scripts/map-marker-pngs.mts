/**
 * Genera los PNG del marcador de la ficha en mobile (Static Maps: el marcador tiene que ser una imagen pública que baja
 * Google), uno por ícono de `shared/icons/*.webp` más `default.png` (sin categoría). El aspecto es el de MapMarker en
 * reposo: círculo blanco (--color-surface) de 30px con la sombra de --shadow-marker y el ícono de 20px.
 *
 * Static Maps acepta íconos de hasta 4096 px² (64×64): el PNG va al doble (64×64 para 32px) y la URL lleva
 * `scale:2` en el marcador, así se ve nítido y del tamaño en CSS. La sombra se achica un poco para entrar en el lienzo.
 *
 * Uso (desde app/): yarn tsx scripts/map-marker-pngs.mts. Con un ícono nuevo en shared/icons, correrlo y commitear el
 * PNG (marker-pngs.test.ts lo exige). `sharp` viene con Next.
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ICONS = path.resolve(import.meta.dirname, '../../shared/icons')
const OUT = path.resolve(import.meta.dirname, '../public/map-markers')

const SIZE = 64 // lienzo: 32px CSS al doble
const CIRCLE = 58 // 29px CSS (el de MapMarker es de 30; 1px menos para que la sombra entre)
const ICON = 40 // 20px CSS, como .markerIcon

const base = (inner = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.6"/>
      <feOffset dy="1.5" result="b"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <circle cx="${SIZE / 2}" cy="${SIZE / 2 - 1}" r="${CIRCLE / 2}" fill="#ffffff" filter="url(#s)"/>
  ${inner}
</svg>`

fs.mkdirSync(OUT, { recursive: true })

const icons = fs.readdirSync(ICONS).filter((file) => file.endsWith('.webp'))
for (const file of icons) {
  const icon = await sharp(path.join(ICONS, file)).resize(ICON, ICON).png().toBuffer()
  const offset = (SIZE - ICON) / 2
  await sharp(Buffer.from(base()))
    .composite([{ input: icon, left: offset, top: offset - 1 }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.join(OUT, file.replace(/\.webp$/, '.png')))
}

// Sin categoría (el emoji 🍽️ de la card no se puede dibujar en Static Maps): el círculo con un punto.
await sharp(Buffer.from(base(`<circle cx="${SIZE / 2}" cy="${SIZE / 2 - 1}" r="8" fill="#000000"/>`)))
  .png({ compressionLevel: 9, palette: true })
  .toFile(path.join(OUT, 'default.png'))

console.log(`${icons.length + 1} PNG en ${path.relative(process.cwd(), OUT)}`)
