import { NEIGHBORHOOD_NAMES } from './neighborhood-names.ts'
import { normalize } from './tags.ts'

// Formas cortas o parciales con las que la gente nombra barrios cuyo id del INE es compuesto.
// Las claves van normalizadas (minúscula, sin acentos).
const ALIASES: Record<string, string> = {
  prado: 'PRADO NUEVA SAVONA',
  'el prado': 'PRADO NUEVA SAVONA',
  'nueva savona': 'PRADO NUEVA SAVONA',
  rodo: 'PARQUE RODO',
  'pque rodo': 'PARQUE RODO',
  'parque batlle': 'PQUE BATLLE VILLA DOLORES',
  'villa dolores': 'PQUE BATLLE VILLA DOLORES',
  capurro: 'CAPURRO BELLA VISTA',
  'bella vista': 'CAPURRO BELLA VISTA',
  casabo: 'CASABO PAJAS BLANCAS',
  'pajas blancas': 'CASABO PAJAS BLANCAS',
  colon: 'COLON CENTRO Y NOROESTE',
  abayuba: 'COLON SURESTE ABAYUBA',
  'la figurita': 'FIGURITA',
  maronas: 'MAROÃ‘AS PARQUE GUARANI',
  'parque guarani': 'MAROÃ‘AS PARQUE GUARANI',
  'mercado modelo': 'MERCADO MODELO Y BOLIVAR',
  bolivar: 'MERCADO MODELO Y BOLIVAR',
  penarol: 'PEÃ‘AROL LAVALLEJA',
  'punta rieles': 'PUNTA RIELES BELLA ITALIA',
  'bella italia': 'PUNTA RIELES BELLA ITALIA',
  'tres ombues': 'TRES OMBUES PBLO VICTORIA',
  'pueblo victoria': 'TRES OMBUES PBLO VICTORIA',
  'villa munoz': 'VILLA MUÃ‘OZ RETIRO',
  retiro: 'VILLA MUÃ‘OZ RETIRO',
  'toledo chico': 'MANGA TOLEDO CHICO',
  lezica: 'LEZICA MELILLA',
  melilla: 'LEZICA MELILLA',
  'castro castellanos': 'CASTRO CASTELLANOS',
  'paso molino': 'BELVEDERE',
  'old town': 'CIUDAD VIEJA',
  downtown: 'CENTRO',
}

const LOOKUP = new Map<string, string>()
for (const [id, name] of Object.entries(NEIGHBORHOOD_NAMES)) {
  LOOKUP.set(normalize(name), id)
  LOOKUP.set(normalize(id), id)
}
for (const [alias, id] of Object.entries(ALIASES)) LOOKUP.set(alias, id)

/** Id del INE para un nombre de barrio tal como lo escribe alguien (o el modelo); null si no es un barrio. */
export function resolveNeighborhood(raw: string): string | null {
  if (raw in NEIGHBORHOOD_NAMES) return raw
  return LOOKUP.get(normalize(raw.replace(/[-–]/g, ' '))) ?? null
}

// Lo bastante largo para el nombre de barrio más largo ("colon centro y noroeste").
const MAX_NEIGHBORHOOD_WORDS = 4

/** Ids de los barrios que nombra un texto ya normalizado, con las mismas formas que acepta resolveNeighborhood. */
export function neighborhoodsIn(normalized: string): Set<string> {
  const words = normalized.split(' ').filter(Boolean)
  const found = new Set<string>()
  for (let index = 0; index < words.length; index++) {
    for (let length = 1; length <= Math.min(MAX_NEIGHBORHOOD_WORDS, words.length - index); length++) {
      const id = resolveNeighborhood(words.slice(index, index + length).join(' '))
      if (id) found.add(id)
    }
  }
  return found
}
