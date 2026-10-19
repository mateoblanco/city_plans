/** Cantidad de lugares que el frontend procesa en paralelo, cada uno con su request a /api/extract. */
export const EXTRACT_CONCURRENCY = 5

/** Errores de Apify seguidos (en el orden en que terminan) que cortan el lote. */
export const APIFY_FAILURE_LIMIT = 3

/** Errores de Exa seguidos (en el orden en que terminan) que cortan el lote. */
export const EXA_FAILURE_LIMIT = 3
