// Todos los números de la búsqueda en un solo lugar, para calibrarlos con `yarn search:eval`.

export const SEARCH_CONFIG = {
  maxQueryLength: 200,
  maxResults: 20,
  /** Cuántos lugares de cada ranking entran en la fusión. */
  rankingDepth: 100,
  /** Tope de candidatos que trae el SQL (ordenados por cercanía semántica cuando hay embedding). */
  candidateLimit: 500,
  /** Cuántos se muestran por ranking en debug. */
  debugDepth: 20,

  rrf: {
    k: 60,
    /** Peso de cada ranking dentro de la fusión. distance sólo existe al relajar el barrio. */
    weights: { semantic: 1, keyword: 1, name: 1, distance: 2 },
  },

  name: {
    /** similarity() contra el nombre completo a partir de la cual el lugar va primero. */
    strongSimilarity: 0.5,
    /** Si el diccionario resolvió la consulta ("bar"), sólo un nombre casi idéntico va primero. */
    strongSimilarityWhenStructured: 0.8,
    /** word_similarity() (la consulta dentro del nombre) para ir primero; no aplica si el diccionario resolvió la consulta. */
    strongWordSimilarity: 0.85,
    /** Consultas más cortas que esto nunca fijan un lugar por nombre. */
    minStrongLength: 4,
    /** Por debajo de esto el lugar no entra al ranking de nombre. */
    minForRanking: 0.3,
  },

  /** Empujones que se suman al puntaje RRF (un primer puesto en un ranking vale 1/61 ≈ 0.016). */
  boosts: {
    category: 0.01,
    signature: 0.008,
    maxSignatureMatches: 2,
    preferTag: 0.006,
    exactDish: 0.02,
    confirmedOpen: 0.01,
  },

  /**
   * Multiplicador por calidad sobre el puntaje final (RRF + empujones): lineal en prominence y un extra si es featured.
   * Reordena dentro de cada nivel (fijado, has/maybe, abierto); nunca los cruza.
   */
  quality: {
    normal: { prominenceMin: 0.9, prominenceMax: 1.1, featured: 1.1 },
    /** Cuando la consulta pide lo mejor ("el mejor chivito", "best coffee", "top"). */
    best: { prominenceMin: 0.8, prominenceMax: 1.2, featured: 1.2 },
  },

  llm: {
    model: process.env.SEARCH_MODEL?.trim() || 'anthropic/claude-haiku-5.5',
    timeoutMs: 10000,
  },
  embeddingModel: 'openai/text-embedding-3-small',

  /** La interpretación y el embedding de una consulta duran 24 h en la cache de Next. */
  cacheSeconds: 60 * 60 * 24,

  timeZone: 'America/Montevideo',
} as const
