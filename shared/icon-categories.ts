// Categoría de ícono: por qué es conocido un lugar. En la base va sólo la clave (null = todavía sin
// categoría); el emoji vive acá. La descripción es para el prompt de extracción. Son todas categorías
// reales: no hay "other", así el modelo elige siempre la más cercana. Los emojis que no se muestran
// como emoji por defecto llevan el selector de variación U+FE0F (🍽️ y no 🍽).

export const ICON_CATEGORIES = {
  wine: { emoji: '🍷', description: 'Vinos, wine bar' },
  beer: { emoji: '🍺', description: 'Cervecería' },
  beer_pub: { emoji: '🍻', description: 'Pub o bar de cervezas para ir en grupo' },
  cocktails: { emoji: '🍸', description: 'Coctelería de autor' },
  tropical_drinks: { emoji: '🍹', description: 'Tragos tropicales o frutales' },
  classic_bar: { emoji: '🥃', description: 'Bar clásico, whisky, vermut' },
  coffee: { emoji: '☕', description: 'Café de especialidad' },
  tea: { emoji: '🫖', description: 'Casa de té' },
  croissant: { emoji: '🥐', description: 'Panadería o pastelería francesa (medialunas, croissants)' },
  bread: { emoji: '🥖', description: 'Panadería de masa madre o artesanal' },
  bakery: { emoji: '🍞', description: 'Panadería de barrio' },
  pancakes: { emoji: '🥞', description: 'Brunch' },
  breakfast: { emoji: '🍳', description: 'Desayunos' },
  cake: { emoji: '🍰', description: 'Tortas, pastelería' },
  cupcake: { emoji: '🧁', description: 'Cupcakes, pastelería decorada' },
  pie: { emoji: '🥧', description: 'Tartas, pies' },
  birthday_cake: { emoji: '🎂', description: 'Tortas por encargo' },
  donut: { emoji: '🍩', description: 'Donas' },
  cookie: { emoji: '🍪', description: 'Cookies' },
  chocolate: { emoji: '🍫', description: 'Chocolatería' },
  ice_cream: { emoji: '🍦', description: 'Heladería' },
  grill: { emoji: '🥩', description: 'Parrilla' },
  meat: { emoji: '🍖', description: 'Carnes, costillas, ahumados' },
  pasta: { emoji: '🍝', description: 'Pastas' },
  pizza: { emoji: '🍕', description: 'Pizzería' },
  burger: { emoji: '🍔', description: 'Hamburguesería' },
  fries: { emoji: '🍟', description: 'Comida rápida, papas' },
  sandwich: { emoji: '🥪', description: 'Sándwiches, chivitos' },
  hot_dog: { emoji: '🌭', description: 'Panchos' },
  taco: { emoji: '🌮', description: 'Tacos, mexicana' },
  burrito: { emoji: '🌯', description: 'Burritos, wraps' },
  tamale: { emoji: '🫔', description: 'Tamales, comida latinoamericana' },
  seafood: { emoji: '🦞', description: 'Mariscos' },
  fish: { emoji: '🐟', description: 'Pescados, ceviche, peruana' },
  octopus: { emoji: '🐙', description: 'Pulpo, cocina de mar mediterránea o gallega' },
  tapas: { emoji: '🥘', description: 'Tapas, paella, cocina española' },
  sushi: { emoji: '🍣', description: 'Sushi, japonesa' },
  ramen: { emoji: '🍜', description: 'Ramen, sopas asiáticas' },
  wok: { emoji: '🥡', description: 'China, wok, para llevar' },
  dumplings: { emoji: '🥟', description: 'Dumplings' },
  curry: { emoji: '🍛', description: 'India, curry' },
  falafel: { emoji: '🧆', description: 'Falafel, árabe vegetariana' },
  kebab: { emoji: '🥙', description: 'Shawarma, kebab, Medio Oriente' },
  salad: { emoji: '🥗', description: 'Veggie, vegano, saludable' },
  bookstore: { emoji: '📚', description: 'Café-librería' },
} as const satisfies Record<string, { emoji: string; description: string }>

export type IconCategory = keyof typeof ICON_CATEGORIES

/** Las claves en orden; tupla no vacía para z.enum. */
export const ICON_CATEGORY_KEYS = Object.keys(ICON_CATEGORIES) as [IconCategory, ...IconCategory[]]

/** Sólo para la UI (sin categoría o clave desconocida); nunca es una opción del modelo. */
export const FALLBACK_ICON_EMOJI = '\u{1F37D}\uFE0F'

export function isIconCategory(key: string): key is IconCategory {
  return Object.hasOwn(ICON_CATEGORIES, key)
}

/** Emoji de la clave; 🍽️ si no existe. */
export function iconEmoji(key: string | null | undefined): string {
  return key && isIconCategory(key) ? ICON_CATEGORIES[key].emoji : FALLBACK_ICON_EMOJI
}
