// Todos los números de la búsqueda en un solo lugar, para calibrarlos con `yarn search:eval`.

export const SEARCH_CONFIG = {
  maxQueryLength: 200,
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
    /** El style pedido ("descontracturado" → casual), como una preferencia más. */
    preferStyle: 0.006,
    exactDish: 0.02,
    /**
     * Pide un plato y el lugar es conocido por él: su ícono es el del plato (pizza → pizza) o su categoría es la del
     * plato (pizzería). Pesa más que exactDish: una pizzería le gana a un bar que tiene pizza en la carta.
     */
    knownFor: 0.03,
    /**
     * Por cada dieta pedida en la que el lugar es 100 % (vegano fully cuenta como vegetariano fully). Lo mismo que
     * knownFor: el apto entero va arriba del que tiene una opción. has_options no suma.
     */
    dietFully: 0.03,
    /**
     * Dieta preferida sin filtrar ("sin carne" → vegetariano): entero si el lugar es 100 % apto, la mitad con opciones.
     * Como dos preferencias: ordena, no cambia quién entra.
     */
    preferDiet: 0.012,
    /**
     * Intención Bares y el lugar es conocido por la bebida (su ícono es de bebida: vino, cerveza, tragos, bar clásico).
     * Con Bares todos tienen categoría de bar, así que el ícono separa al bar de verdad del sushi o la tapería con barra.
     * La mitad de knownFor, casi un primer puesto en un ranking. Con una bebida pedida (vino, cerveza, cócteles…), entero
     * sólo para el bar de esa bebida (fuse.ts DRINK_FIT) y la mitad para los otros bares, con o sin la intención.
     */
    barFit: 0.015,
    /**
     * Intención Comer y el lugar es conocido por un plato (su ícono es de comida de plato: parrilla, pasta, sushi…).
     * Separa al restaurante del café o la heladería. Lo mismo que barFit.
     */
    eatFit: 0.015,
    /**
     * Por cada señal de la sección que tiene el lugar (las de su regla y las de bonus: picada + tapas + groups en Para
     * compartir), hasta maxSectionSignals. Ordena dentro de la sección (Ver todos o el grupo); no cambia quién entra.
     */
    sectionFit: 0.004,
    maxSectionSignals: 3,
    /**
     * Por cada señal del momento pedido que tiene el lugar (moments.ts MOMENT_FIT: con una cita, cozy, quiet, vino…),
     * hasta maxMomentSignals: como mucho 0.012, menos que un primer puesto en un ranking. Ordena entre los "has".
     */
    momentFit: 0.003,
    maxMomentSignals: 4,
    /**
     * Con groups pedido ("con amigos", "para un grupo"; moments.ts). Tag groups: 0.009, que con preferTag da 0.015. Sin el
     * tag, un pub o cervecería suma groupIdentity, lo mismo que el tag con preferTag: no vale más que tenerlo. Cada señal
     * (cerveza, para compartir, juegos…) suma groupSignal, hasta maxGroupSignals. Con minGroupSignals señales, o con el tag
     * o la identidad, el lugar es "has" y pasa el corte por relevancia.
     */
    groupFit: 0.009,
    groupIdentity: 0.015,
    groupSignal: 0.005,
    maxGroupSignals: 3,
    minGroupSignals: 3,
    confirmedOpen: 0.01,
    /**
     * Principalmente para bailar (boliche, tag dancing, o dj sin comida) y la consulta no pide bailar: baja un poco
     * menos que un primer puesto en un ranking. No se excluye.
     */
    danceOnly: -0.015,
    /** Con niños pedido (kids_friendly en must o prefer) y el lugar tiene espacio para niños: más que un primer puesto. */
    kidsArea: 0.02,
    /**
     * Con niños pedido y el lugar es de noche (fuse.ts isKidsNight: dj o dancing, o trasnoche en un bar sin restaurant; una
     * sola vez): baja debajo de los restaurantes y cafés aptos, más que danceOnly. No se excluye.
     */
    kidsNight: -0.025,
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
   * Secciones de las búsquedas amplias: desde cuántos resultados (después de los filtros) se agrupa, cuántos lugares necesita un grupo y
   * cuántos entran como mucho (el resto va a "Más opciones"), hasta cuántos grupos se muestran y cuántos ids válidos
   * tiene que dar el modelo para no usar las reglas. El grupo "100 % …" de la dieta sale desde dietMinPlaces; con un
   * solo apto, ese lugar va primero en el primer grupo.
   */
  sections: { minResults: 12, minPlaces: 3, maxPlaces: 6, maxGroups: 5, minRequested: 2, dietMinPlaces: 2 },

  /**
   * Likes (cookie espejo de localStorage, sólo en el pedido). Los likes se agrupan por tipo (cafés, bares, comer,
   * postres: personal.ts placeKind) y cada tipo con minLikesProfile likes es un perfil: el promedio de sus embeddings más
   * los rasgos que se repiten. Nunca reordena ni cambia quién entra: sólo elige qué lugares de la misma búsqueda van a un
   * solo grupo personal, "Parecido a <lugar>" (desde 1 like) o, si no sale, "Porque te gustan…" (el perfil del tipo de la
   * búsqueda), o, sin grupos, a "Para vos"; siempre entre los resultados "has" del mismo tipo que el perfil.
   * El tipo de la búsqueda es el de la intención o, sin intención, el que tiene al menos `dominant.share` de los primeros
   * `dominant.top` resultados "has"; sin tipo o sin perfil de ese tipo no hay "Porque te gustan…" ni "Para vos".
   * Puntaje: sim (coseno contra el promedio del perfil) + affinity.beta × afinidad (0 a 1, la parte del peso de los rasgos
   * del perfil que tiene el lugar); entra con sim ≥ affinity.simFloor y puntaje ≥ profileThreshold. El peso de un rasgo:
   * la parte del perfil que lo tiene (si lo tienen al menos 2 y la mitad) × su idf en la base (ln(N/df)/ln(N); por
   * debajo de affinity.minIdf no cuenta: cena o almuerzo los tienen casi todos) × affinity.weights de su clase.
   * "Porque te gustan…" sólo elige entre los primeros profileMaxPosition de la búsqueda. Variedad: como mucho
   * maxPerFamily de la misma familia de ícono; si todos son de una familia, como mucho maxPerNeighborhood por barrio y
   * una sucursal por marca (con menos de min, se completa con los salteados). Las cadenas (chainMinBranches sucursales
   * publicadas o más) no entran en los grupos personales.
   * "Parecido a" es del like del tipo de la búsqueda mejor ubicado entre los primeros
   * `similar.maxPosition` de la búsqueda (más abajo no encaja en lo pedido). Entran los que pasan los datos concretos
   * (misma familia de ícono o una cocina en común, mismo style y precio a `similar.priceDistance` niveles como mucho; lo
   * desconocido pasa) y, entre ellos, los que están en el top `similar.topShare` más parecido a ese lugar dentro de toda
   * la base publicada, con piso `similar.floor` (unos lugares tienen vecinos mucho más cercanos que otros).
   */
  personal: {
    maxLikes: 100,
    minLikesProfile: 2,
    minPlaces: 3,
    maxPlaces: 6,
    forYou: { min: 3, max: 4 },
    /** Con menos resultados "has" que esto no hay bloques personales: con pocos, la fila se lleva casi todo. */
    minHas: 12,
    profileThreshold: 0.72,
    profileMaxPosition: 50,
    dominant: { top: 30, share: 0.5 },
    affinity: { beta: 0.08, simFloor: 0.68, minIdf: 0.2, minLikes: 2, minShare: 0.5, weights: { tag: 1, style: 0.6, price: 0.6, barrio: 0.5 } },
    /** Rasgos del motivo: como mucho maxTraits, que tengan al menos traitShare de los lugares del grupo. */
    reason: { maxTraits: 2, traitShare: 0.5 },
    maxPerFamily: 2,
    maxPerNeighborhood: 3,
    chainMinBranches: 4,
    similar: { maxPosition: 30, topShare: 0.2, floor: 0.6, priceDistance: 1 },
  },

  /**
   * Brunch: el tag se asigna sólo con la palabra explícita y lo tienen pocos lugares. Con menos resultados "has" que
   * minHas, se completa debajo (maybe) con cafés que tienen todos los tags de `tags` y no el de brunch.
   */
  brunchFill: { minHas: 12, categories: ['cafe'], tags: ['breakfast', 'lunch'] },

  /** Cerca mío: radio inicial y cómo se amplía (en metros) si no hay resultados. */
  near: { radii: [1500, 3000, 5000] },
  /**
   * Venue nombrado ("en el Mercado del Puerto"): además de sus locales, los que no tienen located_in a menos de esto de
   * alguno. 100 m cubre un mercado o un shopping desde el local cargado sin llegar a la cuadra de enfrente.
   */
  venue: { radiusM: 100 },

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
  /**
   * Va en la clave de la interpretación cacheada: subirla cuando cambia cómo se interpreta (prompt, schema,
   * validación) para no usar lo guardado con el criterio viejo. 2: horario del texto ("tarde" con bares). 3: almuerzo
   * de trabajo (lunch + menú del día + algo rápido), no work. 4: un lugar que no es barrio (mercado, shopping) va a
   * unrecognized, no a neighborhoods. 5: cocinas paraguas (asian, latin_american). 6: "sin carne" es exclude de grilled_meat,
   * no vegetariano, y las cocinas del texto se suman a lo del modelo. 8: más frases de groups ("con amigas", "para un
   * grupo", "juntada"…), en el prompt y en el diccionario.
   */
  interpretationCacheVersion: 8,

  timeZone: 'America/Montevideo',
  /** Faltando esto o menos para el cierre o la apertura, la card dice "Cierra pronto" / "Abre pronto". */
  soonMinutes: 60,
  /**
   * "Abre hoy" a la noche (cenar o "esta noche"): abierto en algún momento desde `from`. Antes de `until` (madrugada)
   * todavía es la noche anterior: alcanza con estar abierto ahora.
   */
  night: { from: '20:00', until: '06:00', late: '23:30' },
  /**
   * Horas de las franjas del texto ("a la tarde", "a la noche"). "tarde" con bares es trasnoche: night.late, antes de la
   * medianoche para que siga siendo el día pedido ("martes 00:00" sería la noche del lunes).
   */
  slots: { afternoon: '17:00', night: '21:00' },
} as const
