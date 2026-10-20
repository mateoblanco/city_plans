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
    /**
     * Peso de cada ranking dentro de la fusión. distance existe con "cerca mío" o al relajar el barrio;
     * quality (prominence, featured) sólo en búsquedas sin texto, que no tienen otro ranking.
     */
    weights: { semantic: 1, keyword: 1, name: 1, distance: 2, quality: 1 },
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
    /** Con "lo mejor" ("el mejor chivito"): lo que define al lugar pesa más que un primer puesto en un ranking. */
    signatureBest: 0.02,
    maxSignatureMatches: 2,
    preferTag: 0.006,
    /** El style pedido ("de barrio" → casual), como una preferencia más. */
    preferStyle: 0.006,
    /** La consulta pide precio y el del lugar está confirmado y coincide: queda arriba de los de precio desconocido. */
    priceMatch: 0.008,
    exactDish: 0.02,
    /**
     * Pide un plato y el lugar es conocido por él: su ícono es el del plato (pizza → pizza) o su categoría es la del
     * plato (pizzería). Pesa más que exactDish: una pizzería le gana a un bar que tiene pizza en la carta.
     */
    knownFor: 0.03,
    confirmedOpen: 0.01,
    /**
     * Principalmente para bailar (boliche, tag dancing, o dj sin comida) y la consulta no pide bailar: baja un poco
     * menos que un primer puesto en un ranking. No se excluye.
     */
    danceOnly: -0.015,
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

  /**
   * Corte por relevancia con una señal absoluta: la similitud semántica (coseno contra el embedding de la
   * consulta). El puntaje RRF no sirve para cortar porque depende sólo del puesto (el 20º siempre queda cerca
   * del 76 % del primero). Se saca lo que quede más de maxSemanticGap por debajo del más parecido, salvo que
   * coincida con algo explícito de la consulta (categoría, tag, plato o keyword) o esté fijado por nombre.
   */
  relevance: { maxSemanticGap: 0.08 },

  /**
   * Secciones de las búsquedas amplias: desde cuántos resultados se agrupa, cuántos van en "Mejores coincidencias"
   * (n/4 entre top.min y top.max), cuántos lugares necesita un grupo, hasta cuántos grupos se muestran y cuántos ids
   * válidos tiene que dar el modelo para no usar las reglas.
   */
  sections: { minResults: 10, top: { min: 3, max: 5 }, minPlaces: 3, maxGroups: 4, minRequested: 2 },

  /** Cerca mío: radio inicial y cómo se amplía (en metros) si no hay resultados. */
  near: { radii: [1500, 3000, 5000] },

  llm: {
    model: process.env.SEARCH_MODEL?.trim() || 'anthropic/claude-haiku-5.5',
    /**
     * Por debajo de los 10 s en los que Next (dev) da por trabada una entrada de "use cache".
     * Si se vence, la búsqueda sigue con el diccionario parcial y el embedding del texto.
     */
    timeoutMs: 8000,
    /**
     * TTL del prompt caching del mensaje de sistema (instrucciones, tags y barrios, ~8.300 tokens).
     * 1 h: escribir cuesta 1,5× más que con 5 min, pero con poco tráfico se reescribe mucho menos.
     */
    promptCacheTtl: '1h',
  },
  embeddingModel: 'openai/text-embedding-3-small',

  /** La interpretación y el embedding de una consulta duran 24 h en la cache de Next. */
  cacheSeconds: 60 * 60 * 24,

  timeZone: 'America/Montevideo',
  /** Faltando esto o menos para el cierre o la apertura, la card dice "Cierra pronto" / "Abre pronto". */
  soonMinutes: 60,
} as const
