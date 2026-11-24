// IDs del shapefile del INE (en UTF-8: "LARRAÑAGA"), con su nombre oficial.
// Para mostrar se usa neighborhoodDisplayName, que aplica NEIGHBORHOOD_DISPLAY_NAMES.
export const NEIGHBORHOOD_NAMES: Record<string, string> = {
  AGUADA: 'Aguada', 'AIRES PUROS': 'Aires Puros', ATAHUALPA: 'Atahualpa', 'BAÑADOS DE CARRASCO': 'Bañados de Carrasco',
  'BARRIO SUR': 'Barrio Sur', BELVEDERE: 'Belvedere', 'BRAZO ORIENTAL': 'Brazo Oriental', BUCEO: 'Buceo',
  'CAPURRO BELLA VISTA': 'Capurro Bella Vista', CARRASCO: 'Carrasco', 'CARRASCO NORTE': 'Carrasco Norte',
  'CASABO PAJAS BLANCAS': 'Casabó Pajas Blancas', CASAVALLE: 'Casavalle', 'CASTRO CASTELLANOS': 'Castro Castellanos',
  CENTRO: 'Centro', CERRITO: 'Cerrito', CERRO: 'Cerro', 'CIUDAD VIEJA': 'Ciudad Vieja',
  'COLON CENTRO Y NOROESTE': 'Colón Centro y Noroeste', 'COLON SURESTE ABAYUBA': 'Colón Sureste Abayubá',
  CONCILIACION: 'Conciliación', CORDON: 'Cordón', FIGURITA: 'Figurita', 'FLOR DE MAROÑAS': 'Flor de Maroñas',
  ITUZAINGO: 'Ituzaingó', 'JACINTO VERA': 'Jacinto Vera', 'JARDINES DEL HIPODROMO': 'Jardines del Hipódromo',
  'LA BLANQUEADA': 'La Blanqueada', 'LA COMERCIAL': 'La Comercial', 'LA PALOMA TOMKINSON': 'La Paloma Tomkinson',
  'LA TEJA': 'La Teja', 'LARRAÑAGA': 'Larrañaga', 'LAS ACACIAS': 'Las Acacias', 'LAS CANTERAS': 'Las Canteras',
  'LEZICA MELILLA': 'Lezica Melilla', MALVIN: 'Malvín', 'MALVIN NORTE': 'Malvín Norte', MANGA: 'Manga',
  'MANGA TOLEDO CHICO': 'Manga Toledo Chico', 'MAROÑAS PARQUE GUARANI': 'Maroñas Parque Guaraní',
  'MERCADO MODELO Y BOLIVAR': 'Mercado Modelo y Bolívar', 'NUEVO PARIS': 'Nuevo París', PALERMO: 'Palermo',
  'PARQUE RODO': 'Parque Rodó', 'PASO DE LA ARENA': 'Paso de la Arena', 'PASO DE LAS DURANAS': 'Paso de las Duranas',
  'PEÑAROL LAVALLEJA': 'Peñarol Lavalleja', 'PIEDRAS BLANCAS': 'Piedras Blancas', POCITOS: 'Pocitos',
  'PQUE BATLLE VILLA DOLORES': 'Parque Batlle Villa Dolores', 'PRADO NUEVA SAVONA': 'Prado Nueva Savona',
  'PUNTA CARRETAS': 'Punta Carretas', 'PUNTA GORDA': 'Punta Gorda', 'PUNTA RIELES BELLA ITALIA': 'Punta Rieles Bella Italia',
  REDUCTO: 'Reducto', SAYAGO: 'Sayago', 'TRES CRUCES': 'Tres Cruces', 'TRES OMBUES PBLO VICTORIA': 'Tres Ombúes Pueblo Victoria',
  UNION: 'Unión', 'VILLA ESPAÑOLA': 'Villa Española', 'VILLA GARCIA MANGA RURAL': 'Villa García Manga Rural',
  'VILLA MUÑOZ RETIRO': 'Villa Muñoz Retiro',
}

// Ids con la Ñ mal decodificada (UTF-8 leído como Windows-1252: "LARRA" + U+00C3 U+2018 + "AGA"), como venían del GeoJSON hasta noviembre de 2026, y su forma actual.
// Sólo para links viejos (`f=neighborhood:…`); en la base ya no quedan (backoffice: yarn neighborhoods:fix-ids).
export const LEGACY_NEIGHBORHOOD_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.keys(NEIGHBORHOOD_NAMES)
    .filter((id) => id.includes('Ñ'))
    .map((id) => [id.replaceAll('Ñ', '\u00C3\u2018'), id]),
)

/** El id actual de un barrio, también si viene con la codificación vieja; el mismo texto si no es uno viejo. */
export function currentNeighborhoodId(id: string): string {
  return LEGACY_NEIGHBORHOOD_IDS[id] ?? id
}

// Nombre para mostrar cuando no es el oficial. Cambiar uno acá no toca el id (URLs, filtros, datos) ni los polígonos;
// el nombre oficial sigue funcionando en la búsqueda por texto (neighborhood-aliases.ts).
export const NEIGHBORHOOD_DISPLAY_NAMES: Partial<Record<string, string>> = {
  'PRADO NUEVA SAVONA': 'Prado',
}

export function neighborhoodDisplayName(id: string | null): string | null {
  return id ? NEIGHBORHOOD_DISPLAY_NAMES[id] ?? NEIGHBORHOOD_NAMES[id] ?? id : null
}

/** Todos los nombres de un barrio (el que se muestra y el oficial), para reconocerlo o sacarlo de un texto. */
export function neighborhoodNameForms(id: string): string[] {
  return [...new Set([neighborhoodDisplayName(id) ?? id, NEIGHBORHOOD_NAMES[id] ?? id])]
}
