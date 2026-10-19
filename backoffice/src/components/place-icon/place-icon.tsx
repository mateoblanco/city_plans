import { iconEmoji, type IconCategory } from '@/data/icon-categories'

/**
 * Ícono de la categoría del lugar, con la clave en el tooltip. Es el único lugar que dibuja el
 * emoji: cuando haya SVGs se cambia acá.
 */
export function PlaceIcon({ category }: { category: IconCategory | null }) {
  // Sin categoría: el ícono de reserva, sólo visual.
  const label = category ?? 'Sin categoría'
  return (
    <span role="img" aria-label={label} title={label} className="shrink-0 text-xl leading-none">
      {iconEmoji(category)}
    </span>
  )
}
