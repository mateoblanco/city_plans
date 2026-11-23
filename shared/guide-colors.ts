/**
 * Los colores que se pueden elegir para la franja de la tarjeta de una guía (`guides.color`). El backoffice los ofrece
 * agrupados por familia y la base sólo acepta estos (check `guides_color_check`). Para sumar uno: agregarlo acá y
 * generar la migración que cambia el check.
 */

export const GUIDE_COLOR_FAMILIES = [
  { id: 'naranja', name: 'Naranja', colors: ['#FF8E00', '#D07B00', '#A15400', '#B94200'] },
  { id: 'naranjaRojizo', name: 'Naranja rojizo', colors: ['#FF5C00', '#CC2C00'] },
  { id: 'violeta', name: 'Violeta', colors: ['#8A49FF', '#6C12DD', '#AC3FFF', '#7F06CF'] },
  { id: 'magenta', name: 'Magenta', colors: ['#E927F4', '#A700A9'] },
  { id: 'fucsia', name: 'Fucsia', colors: ['#FF2A8D', '#C90050'] },
  { id: 'rojoRosado', name: 'Rojo rosado', colors: ['#FF184E', '#C90030'] },
  { id: 'rojo', name: 'Rojo', colors: ['#FF2334', '#C20013'] },
  { id: 'verdeLima', name: 'Verde lima', colors: ['#62C803', '#377210', '#E6FBD0', '#A9F15A'] },
  { id: 'verde', name: 'Verde', colors: ['#00C251', '#007735'] },
  { id: 'verdeEsmeralda', name: 'Verde esmeralda', colors: ['#00B475', '#006F4D'] },
  { id: 'verdeAzulado', name: 'Verde azulado', colors: ['#00B39E', '#006D64'] },
  { id: 'cianOscuro', name: 'Cian oscuro', colors: ['#00B0D3', '#006A88'] },
  { id: 'azulCielo', name: 'Azul cielo', colors: ['#009DEE', '#005F9B'] },
  { id: 'azulElectrico', name: 'Azul eléctrico', colors: ['#1E75FF', '#1B40DB'] },
  { id: 'indigo', name: 'Índigo', colors: ['#5B56FA', '#402ACC'] },
  { id: 'crema', name: 'Crema', colors: ['#FFF5CC', '#FFF1CC'] },
  { id: 'amarillo', name: 'Amarillo', colors: ['#FFDA3D', '#FFCB41'] },
  { id: 'durazno', name: 'Durazno', colors: ['#FFE4CC', '#FFAF67'] },
  { id: 'celeste', name: 'Celeste', colors: ['#CCF0FF', '#CCE5FF', '#5ACFFE', '#7DBEFF'] },
  { id: 'cian', name: 'Cian', colors: ['#CDFAFE', '#1FE7FA'] },
  { id: 'menta', name: 'Menta', colors: ['#CCFFF9', '#D0FBE5', '#D2F9ED'] },
  { id: 'turquesa', name: 'Turquesa', colors: ['#00EACF', '#31E6AF', '#58EFA3'] },
  { id: 'rosaClaro', name: 'Rosa claro', colors: ['#FFCCCD', '#FFCCD3', '#FFCCE6'] },
  { id: 'rosa', name: 'Rosa', colors: ['#FF9799', '#FF96A4', '#FF9ACE'] },
  { id: 'rosaPastel', name: 'Rosa pastel', colors: ['#FCCDFE', '#FA9EFD'] },
  { id: 'azulLavanda', name: 'Azul lavanda', colors: ['#CCD5FF', '#98ABFF'] },
  { id: 'lila', name: 'Lila', colors: ['#D9CCFF', '#E8CCFF', '#C0ABFF', '#D9A9FF'] },
] as const

export type GuideColor = (typeof GUIDE_COLOR_FAMILIES)[number]['colors'][number]

/** Todos los colores, en el orden de las familias. */
export const GUIDE_COLORS: readonly GuideColor[] = GUIDE_COLOR_FAMILIES.flatMap((family) => family.colors)

/** El de una guía nueva (y el de la columna en la base). */
export const DEFAULT_GUIDE_COLOR: GuideColor = '#FF8E00'

export const isGuideColor = (value: unknown): value is GuideColor => typeof value === 'string' && (GUIDE_COLORS as readonly string[]).includes(value)

/** "Naranja 2": el nombre accesible de cada color en el selector del backoffice. */
export function guideColorLabel(color: GuideColor): string {
  for (const family of GUIDE_COLOR_FAMILIES) {
    const index = (family.colors as readonly string[]).indexOf(color)
    if (index >= 0) return family.colors.length > 1 ? `${family.name} ${index + 1}` : family.name
  }
  return color
}
