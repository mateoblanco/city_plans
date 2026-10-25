import type { StaticImageData } from "next/image";
import type { IconCategory } from "@shared/icon-categories.ts";
import wine from "@shared/icons/wine.svg";
import beer from "@shared/icons/beer.svg";
import beer_pub from "@shared/icons/beer_pub.svg";
import cocktails from "@shared/icons/cocktails.svg";
import tropical_drinks from "@shared/icons/tropical_drinks.svg";
import classic_bar from "@shared/icons/classic_bar.svg";
import coffee from "@shared/icons/coffee.svg";
import tea from "@shared/icons/tea.svg";
import croissant from "@shared/icons/croissant.svg";
import bread from "@shared/icons/bread.svg";
import bakery from "@shared/icons/bakery.svg";
import pancakes from "@shared/icons/pancakes.svg";
import breakfast from "@shared/icons/breakfast.svg";
import cake from "@shared/icons/cake.svg";
import cupcake from "@shared/icons/cupcake.svg";
import pie from "@shared/icons/pie.svg";
import birthday_cake from "@shared/icons/birthday_cake.svg";
import donut from "@shared/icons/donut.svg";
import cookie from "@shared/icons/cookie.svg";
import chocolate from "@shared/icons/chocolate.svg";
import ice_cream from "@shared/icons/ice_cream.svg";
import grill from "@shared/icons/grill.svg";
import meat from "@shared/icons/meat.svg";
import pasta from "@shared/icons/pasta.svg";
import pizza from "@shared/icons/pizza.svg";
import burger from "@shared/icons/burger.svg";
import fries from "@shared/icons/fries.svg";
import sandwich from "@shared/icons/sandwich.svg";
import hot_dog from "@shared/icons/hot_dog.svg";
import taco from "@shared/icons/taco.svg";
import burrito from "@shared/icons/burrito.svg";
import tamale from "@shared/icons/tamale.svg";
import seafood from "@shared/icons/seafood.svg";
import fish from "@shared/icons/fish.svg";
import octopus from "@shared/icons/octopus.svg";
import tapas from "@shared/icons/tapas.svg";
import sushi from "@shared/icons/sushi.svg";
import ramen from "@shared/icons/ramen.svg";
import wok from "@shared/icons/wok.svg";
import dumplings from "@shared/icons/dumplings.svg";
import curry from "@shared/icons/curry.svg";
import falafel from "@shared/icons/falafel.svg";
import kebab from "@shared/icons/kebab.svg";
import salad from "@shared/icons/salad.svg";
import bookstore from "@shared/icons/bookstore.svg";

/** SVG del marcador por categoría (shared/icons/<clave>.svg). Una categoría sin archivo no va acá y usa el emoji. */
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
