import type { StaticImageData } from "next/image";
import type { IconCategory } from "@shared/icon-categories.ts";
import wine from "@shared/icons/wine.webp";
import beer from "@shared/icons/beer.webp";
import beer_pub from "@shared/icons/beer_pub.webp";
import cocktails from "@shared/icons/cocktails.webp";
import tropical_drinks from "@shared/icons/tropical_drinks.webp";
import classic_bar from "@shared/icons/classic_bar.webp";
import coffee from "@shared/icons/coffee.webp";
import tea from "@shared/icons/tea.webp";
import croissant from "@shared/icons/croissant.webp";
import bread from "@shared/icons/bread.webp";
import bakery from "@shared/icons/bakery.webp";
import pancakes from "@shared/icons/pancakes.webp";
import breakfast from "@shared/icons/breakfast.webp";
import cake from "@shared/icons/cake.webp";
import cupcake from "@shared/icons/cupcake.webp";
import pie from "@shared/icons/pie.webp";
import birthday_cake from "@shared/icons/birthday_cake.webp";
import donut from "@shared/icons/donut.webp";
import cookie from "@shared/icons/cookie.webp";
import chocolate from "@shared/icons/chocolate.webp";
import ice_cream from "@shared/icons/ice_cream.webp";
import grill from "@shared/icons/grill.webp";
import meat from "@shared/icons/meat.webp";
import pasta from "@shared/icons/pasta.webp";
import pizza from "@shared/icons/pizza.webp";
import burger from "@shared/icons/burger.webp";
import fries from "@shared/icons/fries.webp";
import sandwich from "@shared/icons/sandwich.webp";
import hot_dog from "@shared/icons/hot_dog.webp";
import taco from "@shared/icons/taco.webp";
import burrito from "@shared/icons/burrito.webp";
import tamale from "@shared/icons/tamale.webp";
import seafood from "@shared/icons/seafood.webp";
import fish from "@shared/icons/fish.webp";
import octopus from "@shared/icons/octopus.webp";
import tapas from "@shared/icons/tapas.webp";
import sushi from "@shared/icons/sushi.webp";
import ramen from "@shared/icons/ramen.webp";
import wok from "@shared/icons/wok.webp";
import dumplings from "@shared/icons/dumplings.webp";
import curry from "@shared/icons/curry.webp";
import falafel from "@shared/icons/falafel.webp";
import kebab from "@shared/icons/kebab.webp";
import salad from "@shared/icons/salad.webp";
import bookstore from "@shared/icons/bookstore.webp";

/**
 * Ícono del marcador por categoría (shared/icons/<clave>.webp, 90×90 sin pérdida: 3× el tamaño máximo en pantalla, 30 px
 * con el marcador activo). Una categoría sin archivo no va acá y usa el emoji.
 */
export const MARKER_ICONS = {
  wine,
  beer,
  beer_pub,
  cocktails,
  tropical_drinks,
  classic_bar,
  coffee,
  tea,
  croissant,
  bread,
  bakery,
  pancakes,
  breakfast,
  cake,
  cupcake,
  pie,
  birthday_cake,
  donut,
  cookie,
  chocolate,
  ice_cream,
  grill,
  meat,
  pasta,
  pizza,
  burger,
  fries,
  sandwich,
  hot_dog,
  taco,
  burrito,
  tamale,
  seafood,
  fish,
  octopus,
  tapas,
  sushi,
  ramen,
  wok,
  dumplings,
  curry,
  falafel,
  kebab,
  salad,
  bookstore,
} satisfies Partial<Record<IconCategory, StaticImageData>>;
