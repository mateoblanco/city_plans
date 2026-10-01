import type { CategoryId } from './tags.ts'

export type FoodPlaceTypeGroup =
  | 'Principales'
  | 'Cafés, dulces y panadería'
  | 'Bares y bebidas'
  | 'Cocinas del mundo'
  | 'Especialidades y formatos'

type FoodPlaceTypeDefinition = {
  value: string
  label: string
  group: FoodPlaceTypeGroup
}

const principal = (value: string, label: string): FoodPlaceTypeDefinition => ({
  value,
  label,
  group: 'Principales',
})

const sweet = (value: string, label: string): FoodPlaceTypeDefinition => ({
  value,
  label,
  group: 'Cafés, dulces y panadería',
})

const drink = (value: string, label: string): FoodPlaceTypeDefinition => ({
  value,
  label,
  group: 'Bares y bebidas',
})

const cuisine = (value: string, label: string): FoodPlaceTypeDefinition => ({
  value,
  label,
  group: 'Cocinas del mundo',
})

const specialty = (value: string, label: string): FoodPlaceTypeDefinition => ({
  value,
  label,
  group: 'Especialidades y formatos',
})

// Snapshot de la sección "Food and Drink" de Google Places Table A (2026-02-12).
export const FOOD_PLACE_TYPES = [
  principal('restaurant', 'Restaurante'),
  principal('cafe', 'Café'),
  principal('bar', 'Bar'),
  principal('bakery', 'Panadería'),
  principal('fast_food_restaurant', 'Comida rápida'),
  principal('meal_takeaway', 'Comida para llevar'),
  principal('meal_delivery', 'Entrega de comida'),
  principal('cafeteria', 'Cafetería'),
  sweet('acai_shop', 'Tienda de açaí'),
  sweet('bagel_shop', 'Tienda de bagels'),
  sweet('cake_shop', 'Tienda de tortas'),
  sweet('candy_store', 'Tienda de golosinas'),
  sweet('cat_cafe', 'Café de gatos'),
  sweet('chocolate_factory', 'Fábrica de chocolate'),
  sweet('chocolate_shop', 'Chocolatería'),
  sweet('coffee_roastery', 'Tostaduría de café'),
  sweet('coffee_shop', 'Cafetería de especialidad'),
  sweet('coffee_stand', 'Puesto de café'),
  sweet('confectionery', 'Confitería'),
  sweet('dessert_restaurant', 'Restaurante de postres'),
  sweet('dessert_shop', 'Tienda de postres'),
  sweet('dog_cafe', 'Café de perros'),
  sweet('donut_shop', 'Tienda de donas'),
  sweet('ice_cream_shop', 'Heladería'),
  sweet('pastry_shop', 'Pastelería'),
  drink('bar_and_grill', 'Bar y parrilla'),
  drink('beer_garden', 'Cervecería al aire libre'),
  drink('brewery', 'Cervecería'),
  drink('brewpub', 'Bar con cervecería'),
  drink('cocktail_bar', 'Coctelería'),
  drink('hookah_bar', 'Bar de narguile'),
  drink('irish_pub', 'Pub irlandés'),
  drink('juice_shop', 'Bar de jugos'),
  drink('lounge_bar', 'Lounge bar'),
  drink('pub', 'Pub'),
  drink('sports_bar', 'Bar deportivo'),
  drink('tea_house', 'Casa de té'),
  drink('wine_bar', 'Bar de vinos'),
  drink('winery', 'Bodega'),
  cuisine('afghani_restaurant', 'Restaurante afgano'),
  cuisine('african_restaurant', 'Restaurante africano'),
  cuisine('american_restaurant', 'Restaurante estadounidense'),
  cuisine('argentinian_restaurant', 'Restaurante argentino'),
  cuisine('asian_fusion_restaurant', 'Restaurante de fusión asiática'),
  cuisine('asian_restaurant', 'Restaurante asiático'),
  cuisine('australian_restaurant', 'Restaurante australiano'),
  cuisine('austrian_restaurant', 'Restaurante austríaco'),
  cuisine('bangladeshi_restaurant', 'Restaurante bangladesí'),
  cuisine('basque_restaurant', 'Restaurante vasco'),
  cuisine('bavarian_restaurant', 'Restaurante bávaro'),
  cuisine('belgian_restaurant', 'Restaurante belga'),
  cuisine('brazilian_restaurant', 'Restaurante brasileño'),
  cuisine('british_restaurant', 'Restaurante británico'),
  cuisine('burmese_restaurant', 'Restaurante birmano'),
  cuisine('cajun_restaurant', 'Restaurante cajún'),
  cuisine('californian_restaurant', 'Restaurante californiano'),
  cuisine('cambodian_restaurant', 'Restaurante camboyano'),
  cuisine('cantonese_restaurant', 'Restaurante cantonés'),
  cuisine('caribbean_restaurant', 'Restaurante caribeño'),
  cuisine('chilean_restaurant', 'Restaurante chileno'),
  cuisine('chinese_restaurant', 'Restaurante chino'),
  cuisine('colombian_restaurant', 'Restaurante colombiano'),
  cuisine('croatian_restaurant', 'Restaurante croata'),
  cuisine('cuban_restaurant', 'Restaurante cubano'),
  cuisine('czech_restaurant', 'Restaurante checo'),
  cuisine('danish_restaurant', 'Restaurante danés'),
  cuisine('dutch_restaurant', 'Restaurante neerlandés'),
  cuisine('eastern_european_restaurant', 'Restaurante de Europa del Este'),
  cuisine('ethiopian_restaurant', 'Restaurante etíope'),
  cuisine('european_restaurant', 'Restaurante europeo'),
  cuisine('filipino_restaurant', 'Restaurante filipino'),
  cuisine('french_restaurant', 'Restaurante francés'),
  cuisine('german_restaurant', 'Restaurante alemán'),
  cuisine('greek_restaurant', 'Restaurante griego'),
  cuisine('hawaiian_restaurant', 'Restaurante hawaiano'),
  cuisine('hungarian_restaurant', 'Restaurante húngaro'),
  cuisine('indian_restaurant', 'Restaurante indio'),
  cuisine('indonesian_restaurant', 'Restaurante indonesio'),
  cuisine('irish_restaurant', 'Restaurante irlandés'),
  cuisine('israeli_restaurant', 'Restaurante israelí'),
  cuisine('italian_restaurant', 'Restaurante italiano'),
  cuisine('japanese_restaurant', 'Restaurante japonés'),
  cuisine('korean_restaurant', 'Restaurante coreano'),
  cuisine('latin_american_restaurant', 'Restaurante latinoamericano'),
  cuisine('lebanese_restaurant', 'Restaurante libanés'),
  cuisine('malaysian_restaurant', 'Restaurante malasio'),
  cuisine('mediterranean_restaurant', 'Restaurante mediterráneo'),
  cuisine('mexican_restaurant', 'Restaurante mexicano'),
  cuisine('middle_eastern_restaurant', 'Restaurante de Medio Oriente'),
  cuisine('moroccan_restaurant', 'Restaurante marroquí'),
  cuisine('north_indian_restaurant', 'Restaurante del norte de India'),
  cuisine('pakistani_restaurant', 'Restaurante pakistaní'),
  cuisine('persian_restaurant', 'Restaurante persa'),
  cuisine('peruvian_restaurant', 'Restaurante peruano'),
  cuisine('polish_restaurant', 'Restaurante polaco'),
  cuisine('portuguese_restaurant', 'Restaurante portugués'),
  cuisine('romanian_restaurant', 'Restaurante rumano'),
  cuisine('russian_restaurant', 'Restaurante ruso'),
  cuisine('scandinavian_restaurant', 'Restaurante escandinavo'),
  cuisine('south_american_restaurant', 'Restaurante sudamericano'),
  cuisine('south_indian_restaurant', 'Restaurante del sur de India'),
  cuisine('southwestern_us_restaurant', 'Restaurante del sudoeste de EE. UU.'),
  cuisine('spanish_restaurant', 'Restaurante español'),
  cuisine('sri_lankan_restaurant', 'Restaurante de Sri Lanka'),
  cuisine('swiss_restaurant', 'Restaurante suizo'),
  cuisine('taiwanese_restaurant', 'Restaurante taiwanés'),
  cuisine('tex_mex_restaurant', 'Restaurante Tex-Mex'),
  cuisine('thai_restaurant', 'Restaurante tailandés'),
  cuisine('tibetan_restaurant', 'Restaurante tibetano'),
  cuisine('turkish_restaurant', 'Restaurante turco'),
  cuisine('ukrainian_restaurant', 'Restaurante ucraniano'),
  cuisine('vietnamese_restaurant', 'Restaurante vietnamita'),
  cuisine('western_restaurant', 'Restaurante occidental'),
  specialty('barbecue_restaurant', 'Parrillada'),
  specialty('bistro', 'Bistró'),
  specialty('breakfast_restaurant', 'Restaurante de desayunos'),
  specialty('brunch_restaurant', 'Restaurante de brunch'),
  specialty('buffet_restaurant', 'Restaurante buffet'),
  specialty('burrito_restaurant', 'Restaurante de burritos'),
  specialty('chicken_restaurant', 'Restaurante de pollo'),
  specialty('chicken_wings_restaurant', 'Restaurante de alitas de pollo'),
  specialty('chinese_noodle_restaurant', 'Restaurante de fideos chinos'),
  specialty('deli', 'Delicatessen'),
  specialty('dim_sum_restaurant', 'Restaurante de dim sum'),
  specialty('diner', 'Diner'),
  specialty('dumpling_restaurant', 'Restaurante de dumplings'),
  specialty('falafel_restaurant', 'Restaurante de falafel'),
  specialty('family_restaurant', 'Restaurante familiar'),
  specialty('fine_dining_restaurant', 'Restaurante de alta cocina'),
  specialty('fish_and_chips_restaurant', 'Restaurante de fish and chips'),
  specialty('fondue_restaurant', 'Restaurante de fondue'),
  specialty('food_court', 'Patio de comidas'),
  specialty('fusion_restaurant', 'Restaurante de fusión'),
  specialty('gastropub', 'Gastropub'),
  specialty('gyro_restaurant', 'Restaurante de gyros'),
  specialty('halal_restaurant', 'Restaurante halal'),
  specialty('hamburger_restaurant', 'Hamburguesería'),
  specialty('hot_dog_restaurant', 'Restaurante de panchos'),
  specialty('hot_dog_stand', 'Puesto de panchos'),
  specialty('hot_pot_restaurant', 'Restaurante de hot pot'),
  specialty('japanese_curry_restaurant', 'Restaurante de curry japonés'),
  specialty('japanese_izakaya_restaurant', 'Izakaya japonés'),
  specialty('kebab_shop', 'Tienda de kebab'),
  specialty('korean_barbecue_restaurant', 'Barbacoa coreana'),
  specialty('mongolian_barbecue_restaurant', 'Barbacoa mongola'),
  specialty('noodle_shop', 'Casa de fideos'),
  specialty('oyster_bar_restaurant', 'Bar de ostras'),
  specialty('pizza_delivery', 'Entrega de pizza'),
  specialty('pizza_restaurant', 'Pizzería'),
  specialty('ramen_restaurant', 'Restaurante de ramen'),
  specialty('salad_shop', 'Ensaladería'),
  specialty('sandwich_shop', 'Sandwichería'),
  specialty('seafood_restaurant', 'Restaurante de mariscos'),
  specialty('shawarma_restaurant', 'Restaurante de shawarma'),
  specialty('snack_bar', 'Bar de snacks'),
  specialty('soul_food_restaurant', 'Restaurante soul food'),
  specialty('soup_restaurant', 'Restaurante de sopas'),
  specialty('steak_house', 'Parrilla de carnes'),
  specialty('sushi_restaurant', 'Restaurante de sushi'),
  specialty('taco_restaurant', 'Taquería'),
  specialty('tapas_restaurant', 'Bar de tapas'),
  specialty('tonkatsu_restaurant', 'Restaurante de tonkatsu'),
  specialty('vegan_restaurant', 'Restaurante vegano'),
  specialty('vegetarian_restaurant', 'Restaurante vegetariano'),
  specialty('yakiniku_restaurant', 'Restaurante de yakiniku'),
  specialty('yakitori_restaurant', 'Restaurante de yakitori'),
] as const satisfies readonly FoodPlaceTypeDefinition[]

export type FoodPlaceType = (typeof FOOD_PLACE_TYPES)[number]['value']

export const FOOD_PLACE_TYPE_GROUPS: readonly FoodPlaceTypeGroup[] = [
  'Principales',
  'Cafés, dulces y panadería',
  'Bares y bebidas',
  'Cocinas del mundo',
  'Especialidades y formatos',
]

const typeMap = new Map(FOOD_PLACE_TYPES.map((type) => [type.value, type]))

export function isFoodPlaceType(value: string): value is FoodPlaceType {
  return typeMap.has(value)
}

export function getFoodPlaceTypeLabel(value: string): string {
  return typeMap.get(value)?.label ?? 'Lugar gastronómico'
}

/** Maps Google's more granular Food & Drink type to the taxonomy used by drafts. */
export function seedCategoryForFoodPlaceType(value: FoodPlaceType): CategoryId {
  const direct: Partial<Record<FoodPlaceType, CategoryId>> = {
    restaurant: 'restaurant',
    cafe: 'cafe',
    bar: 'bar',
    bakery: 'bakery',
    ice_cream_shop: 'ice_cream_shop',
    brewery: 'brewery',
    brewpub: 'brewery',
    wine_bar: 'wine_bar',
    winery: 'wine_bar',
    pizza_restaurant: 'pizzeria',
    pizza_delivery: 'pizzeria',
    steak_house: 'grill',
    barbecue_restaurant: 'grill',
  }
  if (direct[value]) return direct[value]
  if (/^(coffee|tea_)|_cafe$|cafeteria|confectionery|pastry_shop|cake_shop|dessert_|chocolate_|donut_shop/.test(value)) return value === 'dessert_restaurant' ? 'restaurant' : 'cafe'
  if (/(^|_)(bar|pub)(_|$)|gastropub|beer_garden|cocktail/.test(value)) return 'bar'
  return 'restaurant'
}
