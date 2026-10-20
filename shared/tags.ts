export type Lang = 'es' | 'en'

export type TagDef = {
  label: Record<Lang, string>
  synonyms: Record<Lang, string[]>
  note?: Partial<Record<Lang, string>>
  /** Sólo cocinas: platos típicos que la sugieren sin nombrarla (tacos → mexicana). No son sinónimos. */
  dishes?: Record<Lang, string[]>
}

export type TagGroup = Record<string, TagDef>

const tag = (es: string, en: string, synEs: string[], synEn: string[], noteEn?: string): TagDef => ({
  label: { es, en },
  synonyms: { es: synEs, en: synEn },
  ...(noteEn ? { note: { en: noteEn } } : {}),
})

const cuisine = (es: string, en: string, synEs: string[], synEn: string[], dishesEs: string[] = [], dishesEn: string[] = []): TagDef => ({
  ...tag(es, en, synEs, synEn),
  ...(dishesEs.length || dishesEn.length ? { dishes: { es: dishesEs, en: dishesEn } } : {}),
})

export const CATEGORIES = {
  restaurant: tag('Restaurante', 'Restaurant', ['restaurante', 'resto', 'restorán', 'comedor'], ['restaurant', 'eatery', 'place to eat']),
  cafe: tag('Café', 'Café', ['cafetería', 'cafe', 'café'], ['cafe', 'coffee shop', 'coffee place']),
  bar: tag('Bar', 'Bar', ['bar', 'barcito', 'boliche de barrio'], ['bar', 'pub', 'drinking spot']),
  brewery: tag('Cervecería', 'Brewery', ['cervecería', 'brewpub', 'taproom'], ['brewery', 'brewpub', 'taproom', 'beer bar']),
  wine_bar: tag('Vinoteca', 'Wine bar', ['vinoteca', 'bar de vinos', 'vinos por copa'], ['wine bar', 'wine shop', 'wine by the glass']),
  bakery: tag('Panadería', 'Bakery', ['panadería', 'panificadora', 'confitería'], ['bakery', 'pastry shop', 'patisserie']),
  ice_cream_shop: tag('Heladería', 'Ice cream shop', ['heladería', 'helados'], ['ice cream', 'gelato', 'ice cream shop']),
  grill: tag('Parrilla', 'Steakhouse', ['parrilla', 'parrillada', 'asador'], ['steakhouse', 'grill', 'barbecue', 'bbq'], 'Uruguayan wood-fired grill restaurant'),
  chiviteria: tag('Chivitería', 'Chivito spot', ['chivitería'], ['chivito place'], "Place specialized in chivitos, Uruguay's signature steak sandwich"),
  pizzeria: tag('Pizzería', 'Pizzeria', ['pizzería'], ['pizzeria', 'pizza place']),
  night_club: tag('Boliche', 'Night club', ['boliche', 'disco', 'discoteca'], ['night club', 'club', 'dance club']),
  bodegon: tag('Bodegón', 'Bodegón', ['bodegón', 'bodegones'], ['traditional tavern', 'old-school eatery'], 'Old-school neighborhood restaurant with home-style dishes'),
} satisfies TagGroup

export type CategoryId = keyof typeof CATEGORIES

export const MOMENTS = {
  breakfast: tag('Desayuno', 'Breakfast', ['desayunar', 'desayuno'], ['breakfast']),
  brunch: tag('Brunch', 'Brunch', ['brunch', 'desayuno tardío'], ['brunch']),
  lunch: tag('Almuerzo', 'Lunch', ['almorzar', 'almuerzo', 'mediodía'], ['lunch', 'midday']),
  afternoon_snack: tag('Merienda', 'Afternoon snack', ['merendar', 'merienda'], ['afternoon tea', 'afternoon snack', 'tea time'], 'Late-afternoon coffee and pastries, a Uruguayan ritual'),
  dinner: tag('Cena', 'Dinner', ['cenar', 'cena', 'comer de noche'], ['dinner', 'supper']),
  drinks: tag('Tomar algo', 'Drinks', ['tomar algo', 'salir a tomar', 'copas'], ['drinks', 'grab a drink']),
  late_night: tag('Trasnoche', 'Late night', ['trasnoche', 'abierto hasta tarde', 'madrugada'], ['late night', 'open late', 'after midnight']),
} satisfies TagGroup

export const CUISINES = {
  uruguayan: cuisine('Uruguaya', 'Uruguayan', ['comida uruguaya', 'comida casera', 'minutas'], ['uruguayan food', 'local food', 'home cooking']),
  italian: cuisine('Italiana', 'Italian', ['italiano', 'comida italiana', 'cocina italiana', 'trattoria'], ['italian food', 'italian cuisine', 'trattoria'],
    ['risotto', 'carpaccio', 'bruschetta', 'burrata', 'tiramisú', 'ossobuco', 'focaccia'], ['risotto', 'carpaccio', 'bruschetta', 'burrata', 'tiramisu', 'ossobuco', 'focaccia']),
  armenian: cuisine('Armenia', 'Armenian', ['armenio', 'comida armenia'], ['armenian food']),
  chinese: cuisine('China', 'Chinese', ['chino', 'comida china', 'cocina china', 'cantonesa'], ['chinese food', 'chinese cuisine', 'cantonese'],
    ['chop suey', 'dim sum', 'wantán', 'chow mein', 'pato pekinés', 'cerdo agridulce', 'rollito primavera'], ['chop suey', 'dim sum', 'wonton', 'chow mein', 'peking duck', 'sweet and sour pork', 'spring roll']),
  japanese: cuisine('Japonesa', 'Japanese', ['japonés', 'comida japonesa', 'cocina japonesa'], ['japanese food', 'japanese cuisine'],
    ['sushi', 'sashimi', 'nigiri', 'ramen', 'gyoza', 'tempura', 'udon', 'yakitori'], ['sushi', 'sashimi', 'nigiri', 'ramen', 'gyoza', 'tempura', 'udon', 'yakitori']),
  nikkei: cuisine('Nikkei', 'Nikkei', ['nikkei', 'cocina nikkei', 'comida nikkei', 'nikei'], ['nikkei food', 'japanese-peruvian'],
    ['acevichado', 'tiradito nikkei', 'ceviche nikkei'], ['acevichado', 'nikkei tiradito', 'nikkei ceviche']),
  mexican: cuisine('Mexicana', 'Mexican', ['mexicano', 'comida mexicana', 'cocina mexicana', 'tex mex', 'taquería'], ['mexican food', 'mexican cuisine', 'tex mex', 'taqueria'],
    ['taco', 'burrito', 'quesadilla', 'nachos', 'enchilada', 'fajita', 'guacamole'], ['taco', 'burrito', 'quesadilla', 'nachos', 'enchilada', 'fajita', 'guacamole']),
  venezuelan: cuisine('Venezolana', 'Venezuelan', ['venezolano', 'comida venezolana', 'cocina venezolana', 'arepera', 'arepería'], ['venezuelan food', 'arepa bar'],
    ['arepa', 'cachapa', 'tequeño', 'pabellón', 'hallaca'], ['arepa', 'cachapa', 'tequeño', 'pabellon', 'hallaca']),
  peruvian: cuisine('Peruana', 'Peruvian', ['peruano', 'comida peruana', 'cocina peruana', 'cevichería'], ['peruvian food', 'peruvian cuisine', 'cevicheria'],
    ['ceviche', 'lomo saltado', 'causa limeña', 'ají de gallina', 'anticucho', 'tiradito', 'papa a la huancaína'], ['ceviche', 'lomo saltado', 'causa limena', 'aji de gallina', 'anticucho', 'tiradito', 'papa a la huancaina']),
  middle_eastern: cuisine('Árabe', 'Middle Eastern', ['árabe', 'comida árabe', 'cocina árabe', 'medio oriente', 'oriente medio', 'libanés', 'libanesa', 'comida libanesa'], ['middle eastern', 'lebanese', 'arabic food', 'levantine'],
    ['shawarma', 'falafel', 'hummus', 'kebab', 'kibbeh', 'quipe', 'baba ganoush', 'tabule'], ['shawarma', 'falafel', 'hummus', 'kebab', 'kibbeh', 'baba ganoush', 'tabbouleh']),
  indian: cuisine('India', 'Indian', ['indio', 'hindú', 'comida india', 'cocina india'], ['indian food', 'indian cuisine'],
    ['curry', 'tikka masala', 'naan', 'biryani', 'samosa', 'tandoori', 'dal'], ['curry', 'tikka masala', 'naan', 'biryani', 'samosa', 'tandoori', 'dal']),
  korean: cuisine('Coreana', 'Korean', ['coreano', 'comida coreana', 'cocina coreana'], ['korean food', 'korean cuisine'],
    ['kimchi', 'bibimbap', 'bulgogi', 'tteokbokki', 'japchae', 'kimbap'], ['kimchi', 'bibimbap', 'bulgogi', 'tteokbokki', 'japchae', 'kimbap']),
  spanish: cuisine('Española', 'Spanish', ['español', 'comida española', 'gallega', 'gallego', 'cocina española'], ['spanish food', 'galician', 'spanish cuisine']),
  french: cuisine('Francesa', 'French', ['francés', 'comida francesa', 'cocina francesa'], ['french food', 'french cuisine'],
    ['crêpe', 'ratatouille', 'croque monsieur', 'boeuf bourguignon', 'confit de pato', 'crème brûlée'], ['crepe', 'ratatouille', 'croque monsieur', 'beef bourguignon', 'duck confit', 'creme brulee']),
  brazilian: cuisine('Brasileña', 'Brazilian', ['brasileño', 'brasilero', 'brasilera', 'comida brasileña', 'comida brasilera', 'cocina brasileña'], ['brazilian food', 'brazilian cuisine'],
    ['feijoada', 'pão de queijo', 'coxinha', 'moqueca', 'brigadeiro', 'farofa'], ['feijoada', 'pao de queijo', 'coxinha', 'moqueca', 'brigadeiro', 'farofa']),
  asian: cuisine('Asiática', 'Asian', ['asiático', 'comida asiática', 'cocina asiática', 'fusión asiática', 'panasiática', 'tailandesa', 'thai', 'vietnamita'], ['asian food', 'asian fusion', 'pan-asian', 'thai food', 'vietnamese'],
    ['pad thai', 'pho', 'bao', 'banh mi', 'laksa', 'nasi goreng'], ['pad thai', 'pho', 'bao', 'banh mi', 'laksa', 'nasi goreng']),
  mediterranean: cuisine('Mediterránea', 'Mediterranean', ['mediterráneo', 'comida mediterránea', 'cocina mediterránea'], ['mediterranean', 'mediterranean food'],
    ['musaka', 'souvlaki', 'tzatziki', 'spanakopita'], ['moussaka', 'souvlaki', 'tzatziki', 'spanakopita']),
  fusion: cuisine('Fusión', 'Fusion', ['fusión', 'cocina de autor'], ['fusion', 'chef-driven']),
} satisfies TagGroup

export const FOODS = {
  grilled_meat: tag('Carnes y parrilla', 'Grilled meat', ['asado', 'parrilla', 'achuras', 'vacío', 'entraña', 'cordero', 'cerdo', 'chorizo', 'morcilla', 'chinchulines', 'molleja', 'bife', 'bife de chorizo', 'ojo de bife', 'entrecot', 'churrasco'], ['steak', 'grilled meat', 'asado', 'barbecue', 'lamb', 'pork', 'sausage', 'sausages', 'sweetbreads']),
  chivito: tag('Chivitos', 'Chivitos', ['chivito', 'chivitos', 'chivito al plato', 'chivito canadiense'], ['chivito', 'steak sandwich'], "Uruguay's national sandwich: steak, ham, cheese, egg and more"),
  milanesa: tag('Milanesas', 'Milanesas', ['milanesa', 'milanga', 'milanesa napolitana'], ['milanesa', 'breaded steak', 'schnitzel'], 'Breaded meat cutlet, a local staple'),
  empanadas: tag('Empanadas', 'Empanadas', ['empanada', 'empanadas'], ['empanadas', 'turnovers']),
  burgers: tag('Hamburguesas', 'Burgers', ['hamburguesa', 'hamburguesas', 'hamburguesería'], ['burger', 'burgers', 'hamburger']),
  pizza: tag('Pizza', 'Pizza', ['pizza', 'pizzas', 'fainá', 'muzzarella', 'pizza a la leña'], ['pizza', 'wood-fired pizza']),
  pasta: tag('Pastas', 'Pasta', ['pasta', 'pastas', 'ñoquis', 'ravioles', 'sorrentinos', 'fideos', 'canelones'], ['pasta', 'gnocchi', 'ravioli', 'homemade pasta', 'cannelloni']),
  seafood: tag('Pescados y mariscos', 'Seafood', ['pescado', 'mariscos', 'frutos de mar', 'rabas'], ['seafood', 'fish', 'calamari']),
  sushi: tag('Sushi', 'Sushi', ['sushi', 'rolls', 'nigiri', 'sashimi'], ['sushi', 'rolls', 'sashimi']),
  poke: tag('Poke', 'Poke', ['poke', 'bowl', 'poke bowl'], ['poke', 'poke bowl', 'bowls']),
  wok: tag('Woks', 'Stir-fry', ['wok', 'woks', 'salteado'], ['wok', 'stir fry', 'noodles']),
  chicken: tag('Pollo', 'Chicken', ['pollo', 'pollo al spiedo', 'pollo frito', 'alitas'], ['chicken', 'fried chicken', 'wings', 'rotisserie chicken']),
  hot_dogs: tag('Panchos', 'Hot dogs', ['pancho', 'panchos'], ['hot dog', 'hot dogs']),
  sandwiches: tag('Sándwiches', 'Sandwiches', ['sándwich', 'sanguche', 'bocata', 'olímpico', 'sándwich caliente'], ['sandwich', 'sandwiches', 'toasted sandwich']),
  wraps: tag('Wraps', 'Wraps', ['wrap', 'wraps'], ['wrap', 'wraps', 'burrito']),
  tarts: tag('Tartas', 'Savory tarts', ['tarta', 'tartas', 'pascualina'], ['savory tart', 'quiche']),
  tortilla: tag('Tortillas', 'Spanish omelette', ['tortilla', 'tortilla de papas'], ['tortilla', 'spanish omelette', 'potato omelette']),
  salads: tag('Ensaladas', 'Salads', ['ensalada', 'ensaladas', 'comida liviana', 'saludable'], ['salad', 'salads', 'healthy', 'light food']),
  picada: tag('Picada', 'Picada', ['picada', 'picadita', 'tabla', 'tablas', 'para compartir', 'fiambres y quesos', 'quesos'], ['charcuterie', 'sharing board', 'cheese board', 'to share'], 'Sharing board of cold cuts, cheeses and snacks'),
  tapas: tag('Tapas y platitos', 'Tapas and small plates', ['tapas', 'platitos', 'platos pequeños', 'para picar'], ['tapas', 'small plates']),
  desserts: tag('Postres', 'Desserts', ['postre', 'postres', 'torta', 'tortas', 'chajá', 'martín fierro', 'mousse'], ['dessert', 'desserts', 'cake', 'sweets', 'mousse']),
  ice_cream: tag('Helados', 'Ice cream', ['helado', 'helados', 'gelato'], ['ice cream', 'gelato']),
  pastries: tag('Panificados', 'Pastries', ['medialunas', 'bizcochos', 'croissant', 'facturas', 'masas'], ['pastries', 'croissants', 'baked goods'], 'Bizcochos are Uruguayan breakfast pastries'),
  smoothies: tag('Licuados y jugos', 'Smoothies and juices', ['licuado', 'licuados', 'jugo', 'jugos', 'exprimido'], ['smoothie', 'smoothies', 'juice', 'fresh juice']),
} satisfies TagGroup

export const DRINKS = {
  signature_cocktails: tag('Tragos de autor', 'Signature cocktails', ['tragos de autor', 'coctelería de autor', 'cócteles de autor', 'cócteles a base de vino', 'bar de tragos', 'bar de cócteles'], ['signature cocktails', 'craft cocktails', 'mixology', 'wine cocktails', 'cocktail bar']),
  classic_cocktails: tag('Coctelería', 'Cocktails', ['tragos', 'cócteles', 'coctelería', 'negroni', 'old fashioned', 'mojito', 'martini', 'spritz', 'aperol', 'daiquiri', 'margarita', 'caipirinha', 'manhattan', 'pisco sour', 'whisky sour', 'moscow mule', 'cuba libre', 'fernet'], ['cocktails', 'mixed drinks']),
  craft_beer: tag('Cerveza artesanal', 'Craft beer', ['cerveza artesanal', 'birra artesanal', 'ipa'], ['craft beer', 'ipa', 'microbrewery']),
  draft_beer: tag('Cerveza tirada', 'Draft beer', ['cerveza tirada', 'chopp', 'birra', 'cerveza', 'canilla'], ['draft beer', 'beer on tap', 'beer']),
  wine: tag('Vino', 'Wine', ['vino', 'vinos', 'tannat', 'copa de vino', 'carta de vinos', 'vino tirado', 'vinos de canilla', 'vino de canilla'], ['wine', 'tannat', 'wine list', 'wine by the glass', 'wine on tap']),
  vermouth: tag('Vermut', 'Vermouth', ['vermut', 'vermú', 'vermouth', 'vermutería'], ['vermouth', 'vermut']),
  gin: tag('Gin', 'Gin', ['gin', 'gin tonic', 'gintonic'], ['gin', 'gin and tonic']),
  whisky: tag('Whisky', 'Whisky', ['whisky', 'whiskey'], ['whisky', 'whiskey', 'bourbon']),
  cider: tag('Sidra', 'Cider', ['sidra'], ['cider']),
  medio_y_medio: tag('Medio y medio', 'Medio y medio', ['medio y medio', 'medio medio'], ['medio y medio'], 'Uruguayan blend of sparkling and white wine'),
  specialty_coffee: tag('Café de especialidad', 'Specialty coffee', ['café de especialidad', 'flat white', 'filtrado', 'v60'], ['specialty coffee', 'third wave coffee', 'flat white', 'pour over']),
  tea: tag('Té', 'Tea', ['té', 'tés', 'matcha'], ['tea', 'matcha']),
  non_alcoholic: tag('Sin alcohol', 'Non-alcoholic', ['sin alcohol', 'tragos sin alcohol', 'kombucha'], ['non alcoholic', 'mocktails', 'alcohol free', 'kombucha']),
} satisfies TagGroup

export const FEATURES = {
  terrace: tag('Terraza', 'Terrace', ['terraza', 'azotea'], ['terrace', 'rooftop']),
  sidewalk: tag('Mesas en la vereda', 'Sidewalk tables', ['mesas en la vereda', 'vereda'], ['sidewalk', 'outside tables', 'street-side tables']),
  outdoor: tag('Al aire libre', 'Outdoor seating', ['mesas afuera', 'al aire libre', 'exterior', 'a la sombra'], ['outdoor seating']),
  patio: tag('Patio', 'Patio', ['patio', 'jardín', 'patio interno'], ['patio', 'garden', 'courtyard']),
  sea_view: tag('Vista al mar', 'Sea view', ['vista al mar', 'frente a la rambla', 'sobre la rambla', 'vista al río'], ['sea view', 'ocean view', 'waterfront', 'rambla']),
  live_music: tag('Música en vivo', 'Live music', ['música en vivo', 'bandas', 'bandas en vivo', 'shows', 'toques', 'jazz en vivo', 'tributos musicales'], ['live music', 'live band', 'gigs', 'live jazz']),
  dj: tag('DJ', 'DJ', ['dj', 'djs', 'dj set', 'con dj'], ['dj', 'djs', 'dj set']),
  vinyl: tag('Vinilos', 'Vinyl', ['vinilos', 'discos', 'listening bar'], ['vinyl', 'records', 'listening bar', 'hi-fi bar']),
  karaoke: tag('Karaoke', 'Karaoke', ['karaoke'], ['karaoke']),
  shop: tag('Tienda', 'Shop', ['bazar', 'tienda', 'boutique', 'venta de productos'], ['shop', 'store', 'boutique']),
  events: tag('Eventos', 'Events', ['eventos', 'talleres', 'charlas', 'actividades culturales', 'ciclos', 'exposiciones'], ['workshops', 'events']),
  books: tag('Libros', 'Books', ['libros', 'librería', 'biblioteca', 'para leer'], ['books']),
  dancing: tag('Para bailar', 'Dancing', ['para bailar', 'funciona como boliche', 'pista de baile'], ['dancing']),
  board_games: tag('Juegos de mesa', 'Board games', ['juegos de mesa', 'juegos'], ['board games', 'games']),
  watch_football: tag('Deportes en vivo', 'Live sports', ['ver fútbol', 'ver el partido', 'pantallas', 'pantalla gigante', 'pantalla grande', 'fútbol', 'básquet', 'basket', 'deportes', 'ver deportes', 'rugby', 'partido'], ['live sports', 'sports', 'sports bar', 'watch football', 'watch the game', 'big screen', 'basketball', 'soccer', 'rugby']),
  pool_table: tag('Pool y metegol', 'Pool and foosball', ['pool', 'metegol', 'billar'], ['pool table', 'billiards', 'foosball']),
  kids_area: tag('Espacio para niños', 'Kids area', ['espacio para niños', 'juegos para niños'], ['kids area', 'playground']),
  wifi: tag('Wifi', 'Wifi', ['wifi', 'internet'], ['wifi', 'wi-fi', 'internet']),
  outlets: tag('Enchufes', 'Power outlets', ['enchufes', 'para cargar la compu'], ['power outlets', 'plugs', 'charging']),
  pet_friendly: tag('Pet friendly', 'Pet friendly', ['pet friendly', 'se aceptan perros', 'con mascotas'], ['pet friendly', 'dog friendly', 'dogs allowed']),
  accessible: tag('Accesible', 'Accessible', ['accesible', 'silla de ruedas', 'rampa'], ['wheelchair accessible', 'accessible']),
  open_kitchen: tag('Cocina a la vista', 'Open kitchen', ['cocina a la vista', 'cocina abierta'], ['open kitchen', 'visible kitchen']),
  bar_seating: tag('Para comer en la barra', 'Bar seating', ['barra central', 'barra larga', 'comer en la barra'], ['bar seating', 'long bar', 'counter']),
  accepts_meal_vouchers: tag('Acepta tickets alimentación', 'Accepts meal vouchers', ['acepta tickets', 'tickets alimentación', 'edenred', 'sodexo', 'pluxee'], ['meal vouchers', 'meal tickets', 'edenred', 'sodexo', 'pluxee']),
  cash_only: tag('Solo efectivo', 'Cash only', ['solo efectivo', 'no acepta tarjetas', 'únicamente efectivo'], ['cash only']),
  delivery: tag('Delivery', 'Delivery', ['delivery', 'envíos', 'envío a domicilio', 'entrega a domicilio', 'pedidosya', 'pedidos ya'], ['delivery', 'home delivery']),
  takeaway: tag('Para llevar', 'Takeaway', ['para llevar', 'take away'], ['takeaway', 'take away', 'to go']),
} satisfies TagGroup

export const GOOD_FOR = {
  date: tag('Cita', 'Date', ['cita', 'primera cita', 'romántico', 'en pareja', 'ir en pareja'], ['date', 'first date', 'date night', 'romantic', 'couples']),
  work: tag('Para trabajar', 'Remote work', ['trabajar', 'para trabajar', 'laburar', 'con la compu', 'notebook', 'home office', 'estudiar', 'cowork', 'coworking'], ['work', 'laptop', 'cowork', 'coworking', 'laptop friendly', 'remote work', 'remote workers', 'work from', 'study', 'work from cafe']),
  lgbtq_friendly: tag('LGBTQ+ friendly', 'LGBTQ+ friendly', ['lgbt', 'lgbtq', 'lgbtq+', 'diversidad'], ['gay friendly', 'lgbtq']),
  after_office: tag('After office', 'After work', ['after office', 'after', 'salida del trabajo'], ['after work', 'after office']),
  groups: tag('Grupos', 'Groups', ['grupos', 'en grupo', 'con amigos', 'juntarse con amigos', 'mesa larga'], ['groups', 'friends', 'with friends', 'big table']),
  kids_friendly: tag('Apto niños', 'Kids friendly', ['apto niños', 'para ir con niños', 'con niños', 'con los chicos', 'en familia', 'con chicos', 'menú infantil', 'menú para niños'], ['kids friendly', 'kid friendly', 'family friendly', 'family', 'with kids']),
  solo: tag('Ir solo', 'Solo', ['ir solo', 'sola', 'barra'], ['solo', 'alone', 'eat at the bar']),
  celebration: tag('Celebración', 'Celebration', ['celebrar', 'festejar', 'cumpleaños', 'cumple', 'ocasión especial', 'celebraciones', 'casamientos', 'festejos'], ['celebration', 'special occasion', 'birthday']),
  quick: tag('Algo rápido', 'Quick bite', ['algo rápido', 'al paso', 'rápido', 'comer rápido'], ['quick bite', 'grab and go', 'quick']),
} satisfies TagGroup

export const ATMOSPHERE = {
  quiet: tag('Tranquilo', 'Quiet', ['tranquilo', 'silencioso', 'calmo', 'para charlar'], ['quiet', 'calm', 'low-key']),
  lively: tag('Animado', 'Lively', ['animado', 'con onda', 'movido', 'bullicioso'], ['lively', 'buzzy', 'vibrant']),
  cozy: tag('Acogedor', 'Cozy', ['acogedor', 'acogedora'], ['cozy', 'cosy']),
  elegant: tag('Elegante', 'Elegant', ['elegante', 'sofisticado', 'refinado'], ['elegant', 'upscale', 'refined']),
} satisfies TagGroup

export const OFFERS = {
  menu_of_the_day: tag('Menú del día', 'Set lunch', ['menú ejecutivo', 'menú del día', 'plato del día'], ['set lunch', 'lunch special', 'menu of the day']),
  all_you_can_eat: tag('Tenedor libre', 'All you can eat', ['tenedor libre', 'buffet libre'], ['all you can eat', 'buffet']),
  happy_hour: tag('Happy hour', 'Happy hour', ['happy hour', '2x1 en tragos'], ['happy hour', 'drink specials']),
} satisfies TagGroup

export const DIETARY = {
  vegan: tag('Vegano', 'Vegan', ['vegano', 'vegana', 'plant based', 'sin productos animales'], ['vegan', 'plant based']),
  vegetarian: tag('Vegetariano', 'Vegetarian', ['vegetariano', 'vegetariana', 'veggie', 'sin carne'], ['vegetarian', 'veggie', 'meat free']),
  gluten_free: tag('Sin TACC', 'Gluten free', ['sin tacc', 'sin gluten', 'celíaco', 'celíacos', 'apto celíacos'], ['gluten free', 'celiac', 'celiac friendly', 'no gluten']),
} satisfies TagGroup

/**
 * Momentos u ocasiones (con amigos, cita, con niños, festejar, algo rápido): tags de goodFor que se pueden
 * inferir con señales en la extracción y que la búsqueda usa siempre como preferencia, nunca como filtro.
 */
export const OCCASION_TAGS = ['groups', 'date', 'kids_friendly', 'celebration', 'quick'] as const satisfies readonly (keyof typeof GOOD_FOR)[]
export type OccasionTag = (typeof OCCASION_TAGS)[number]
export const isOccasionTag = (id: string): id is OccasionTag => (OCCASION_TAGS as readonly string[]).includes(id)

/** Estilo del lugar: de la marca, igual en todas las sucursales. Es un campo propio (style), no un tag. */
export const STYLES = {
  casual: tag('Casual', 'Casual', ['descontracturado', 'de barrio', 'informal', 'casual', 'sencillo'], ['casual', 'laid-back', 'informal', 'neighborhood spot']),
  intermedio: tag('Intermedio', 'Mid-range', [], []),
  cuidado: tag('Cuidado', 'Refined', ['especial', 'de autor', 'cuidado', 'refinado'], ['refined', 'chef-driven', 'special']),
} satisfies TagGroup

export type StyleId = keyof typeof STYLES
export const STYLE_IDS = Object.keys(STYLES) as [StyleId, ...StyleId[]]
export const isStyleId = (value: string): value is StyleId => Object.hasOwn(STYLES, value)

export const ALL_GROUPS = { categories: CATEGORIES, moments: MOMENTS, cuisines: CUISINES, foods: FOODS, drinks: DRINKS, features: FEATURES, atmosphere: ATMOSPHERE, goodFor: GOOD_FOR, offers: OFFERS, dietary: DIETARY, style: STYLES } as const
export type GroupName = keyof typeof ALL_GROUPS

/** Filtros de búsqueda que agrupan varios tags. */
export const TAG_FILTERS = {
  outdoor: { label: { es: 'Al aire libre', en: 'Outdoor' }, tags: ['outdoor', 'patio', 'terrace', 'sidewalk'] },
} as const

export function tagsForFilter(filter: keyof typeof TAG_FILTERS) { return TAG_FILTERS[filter].tags }

// Grupos que forman el array tags del borrador. categories y dietary quedan aparte.
export const TAG_GROUPS = { moments: MOMENTS, cuisines: CUISINES, foods: FOODS, drinks: DRINKS, features: FEATURES, atmosphere: ATMOSPHERE, goodFor: GOOD_FOR, offers: OFFERS } as const
export type TagGroupName = keyof typeof TAG_GROUPS
export type TagId = { [G in TagGroupName]: keyof typeof TAG_GROUPS[G] & string }[TagGroupName]
export const TAG_IDS = Object.values(TAG_GROUPS).flatMap((group) => Object.keys(group)) as [TagId, ...TagId[]]

const GROUP_BY_ID = new Map<string, GroupName>()
for (const [group, definitions] of Object.entries(ALL_GROUPS) as [GroupName, TagGroup][]) {
  for (const id of Object.keys(definitions)) if (!GROUP_BY_ID.has(id)) GROUP_BY_ID.set(id, group)
}

/** Grupo de tags.ts al que pertenece un id, para agrupar tags en la UI. */
export function groupOf(tagId: string): GroupName | null { return GROUP_BY_ID.get(tagId) ?? null }

export function ids<G extends TagGroup>(group: G) {
  return Object.keys(group) as [keyof G & string, ...(keyof G & string)[]]
}

/** Minúsculas, sin acentos y con espacios colapsados: la forma con la que se comparan términos. */
export const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
const LOOKUP = new Map<string, { group: GroupName; id: string; dish?: true }>()
for (const [group, definitions] of Object.entries(ALL_GROUPS) as [GroupName, TagGroup][]) {
  for (const [id, definition] of Object.entries(definitions)) {
    for (const key of [id, definition.label.es, definition.label.en, ...definition.synonyms.es, ...definition.synonyms.en]) {
      const normalized = normalize(key)
      if (!LOOKUP.has(normalized)) LOOKUP.set(normalized, { group, id })
    }
  }
}
// Platos típicos de una cocina, después de todos los nombres: nunca le sacan una palabra a otro tag (burrito sigue en wraps).
for (const [id, definition] of Object.entries(CUISINES) as [string, TagDef][]) {
  for (const dish of [...(definition.dishes?.es ?? []), ...(definition.dishes?.en ?? [])]) {
    const normalized = normalize(dish)
    if (!LOOKUP.has(normalized)) LOOKUP.set(normalized, { group: 'cuisines', id, dish: true })
  }
}

/** Tag de un término (id, label, sinónimo o, con dish, plato típico de una cocina). */
export function toCanonical(raw: string) { return LOOKUP.get(normalize(raw)) ?? null }

export function findDef(id: string): TagDef | undefined {
  return (Object.values(ALL_GROUPS) as TagGroup[]).find((definitions) => definitions[id] !== undefined)?.[id]
}

export function label(id: string, lang: Lang = 'es') { return findDef(id)?.label[lang] ?? id }
export function expandTag(id: string) {
  const definition = findDef(id)
  return definition ? [definition.label.es, ...definition.synonyms.es, definition.label.en, ...definition.synonyms.en].join(', ') : id
}

function withoutTrailingPeriods(value: string) {
  return value.trim().replace(/[.。]+$/u, '').trim()
}

function uniqueText(values: string[]) {
  const seen = new Set<string>()
  return values.flatMap((value) => {
    const cleaned = withoutTrailingPeriods(value)
    if (!cleaned || seen.has(normalize(cleaned))) return []
    seen.add(normalize(cleaned))
    return [cleaned]
  })
}

export type SearchTextInput = {
  name: string
  neighborhood: string
  description?: { es?: string | null; en?: string | null }
  locatedIn?: string | null
  tags: string[]
  highlights?: { es: string; en: string }[]
  /** Platos normalizados en español; sólo entran en keywordText. */
  dishes?: string[]
  /** Hasta 3 ids que definen al lugar; entran en embeddingText aunque sean comidas o bebidas. */
  signature?: string[]
  /** Estilo de la marca; entra en los dos textos. */
  style?: StyleId | null
}

// Grupos que describen la identidad del lugar. foods, drinks y features son filtros: sólo entran
// en el embedding si están en signature.
const IDENTITY_GROUPS = new Set<GroupName>(['categories', 'cuisines', 'atmosphere', 'goodFor'])

/** Identidad del lugar: qué es, ambiente, por qué es conocido y barrio. Sin listas de platos. */
export function buildEmbeddingText(place: SearchTextInput) {
  const identityTags = [
    ...place.tags.filter((id) => { const group = groupOf(id); return group !== null && IDENTITY_GROUPS.has(group) }),
    ...(place.signature ?? []),
  ]
  return uniqueText([
    place.name,
    `${place.neighborhood}, Montevideo`,
    place.locatedIn ? `Dentro de ${place.locatedIn}` : '',
    place.description?.es ?? '',
    ...identityTags.map((id) => label(id, 'es')),
    place.style ? `Estilo ${label(place.style, 'es').toLowerCase()}` : '',
  ]).join('. ')
}

/** Todo lo buscable por palabra: tags con sinónimos en es/en, highlights y platos. */
export function buildKeywordText(place: SearchTextInput) {
  const tagText = [...place.tags, ...(place.style ? [place.style] : [])].flatMap((id) => {
    const definition = findDef(id)
    return definition
      ? [definition.label.es, definition.label.en, ...definition.synonyms.es, ...definition.synonyms.en]
      : [id]
  })
  return uniqueText([
    place.name,
    `${place.neighborhood}, Montevideo`,
    place.locatedIn ? `Dentro de ${place.locatedIn}` : '',
    place.description?.es ?? '',
    place.description?.en ?? '',
    ...tagText,
    ...(place.highlights ?? []).flatMap((highlight) => [highlight.es, highlight.en]),
    ...(place.dishes ?? []),
  ]).join('. ')
}
