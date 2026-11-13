// IDs tal como vienen del shapefile del INE (incluye la codificación histórica del archivo), con su nombre oficial.
// Para mostrar se usa neighborhoodDisplayName, que aplica NEIGHBORHOOD_DISPLAY_NAMES.
export const NEIGHBORHOOD_NAMES: Record<string, string> = {
  AGUADA: 'Aguada', 'AIRES PUROS': 'Aires Puros', ATAHUALPA: 'Atahualpa', 'BAÃ‘ADOS DE CARRASCO': 'Bañados de Carrasco',
  'BARRIO SUR': 'Barrio Sur', BELVEDERE: 'Belvedere', 'BRAZO ORIENTAL': 'Brazo Oriental', BUCEO: 'Buceo',
  'CAPURRO BELLA VISTA': 'Capurro Bella Vista', CARRASCO: 'Carrasco', 'CARRASCO NORTE': 'Carrasco Norte',
  'CASABO PAJAS BLANCAS': 'Casabó Pajas Blancas', CASAVALLE: 'Casavalle', 'CASTRO CASTELLANOS': 'Castro Castellanos',
  CENTRO: 'Centro', CERRITO: 'Cerrito', CERRO: 'Cerro', 'CIUDAD VIEJA': 'Ciudad Vieja',
  'COLON CENTRO Y NOROESTE': 'Colón Centro y Noroeste', 'COLON SURESTE ABAYUBA': 'Colón Sureste Abayubá',
  CONCILIACION: 'Conciliación', CORDON: 'Cordón', FIGURITA: 'Figurita', 'FLOR DE MAROÃ‘AS': 'Flor de Maroñas',
  ITUZAINGO: 'Ituzaingó', 'JACINTO VERA': 'Jacinto Vera', 'JARDINES DEL HIPODROMO': 'Jardines del Hipódromo',
  'LA BLANQUEADA': 'La Blanqueada', 'LA COMERCIAL': 'La Comercial', 'LA PALOMA TOMKINSON': 'La Paloma Tomkinson',
  'LA TEJA': 'La Teja', 'LARRAÃ‘AGA': 'Larrañaga', 'LAS ACACIAS': 'Las Acacias', 'LAS CANTERAS': 'Las Canteras',
  'LEZICA MELILLA': 'Lezica Melilla', MALVIN: 'Malvín', 'MALVIN NORTE': 'Malvín Norte', MANGA: 'Manga',
  'MANGA TOLEDO CHICO': 'Manga Toledo Chico', 'MAROÃ‘AS PARQUE GUARANI': 'Maroñas Parque Guaraní',
  'MERCADO MODELO Y BOLIVAR': 'Mercado Modelo y Bolívar', 'NUEVO PARIS': 'Nuevo París', PALERMO: 'Palermo',
  'PARQUE RODO': 'Parque Rodó', 'PASO DE LA ARENA': 'Paso de la Arena', 'PASO DE LAS DURANAS': 'Paso de las Duranas',
  'PEÃ‘AROL LAVALLEJA': 'Peñarol Lavalleja', 'PIEDRAS BLANCAS': 'Piedras Blancas', POCITOS: 'Pocitos',
  'PQUE BATLLE VILLA DOLORES': 'Parque Batlle Villa Dolores', 'PRADO NUEVA SAVONA': 'Prado Nueva Savona',
  'PUNTA CARRETAS': 'Punta Carretas', 'PUNTA GORDA': 'Punta Gorda', 'PUNTA RIELES BELLA ITALIA': 'Punta Rieles Bella Italia',
  REDUCTO: 'Reducto', SAYAGO: 'Sayago', 'TRES CRUCES': 'Tres Cruces', 'TRES OMBUES PBLO VICTORIA': 'Tres Ombúes Pueblo Victoria',
  UNION: 'Unión', 'VILLA ESPAÃ‘OLA': 'Villa Española', 'VILLA GARCIA MANGA RURAL': 'Villa García Manga Rural',
  'VILLA MUÃ‘OZ RETIRO': 'Villa Muñoz Retiro',
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
