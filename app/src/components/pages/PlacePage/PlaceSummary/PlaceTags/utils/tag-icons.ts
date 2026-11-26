import type { FC, SVGProps } from "react";
import Accessible from "@/assets/tags/accesible.svg";
import AfterOffice from "@/assets/tags/afteroffice.svg";
import Babies from "@/assets/tags/babies.svg";
import BoardGames from "@/assets/tags/boardgames.svg";
import Books from "@/assets/tags/books.svg";
import CoffeeForTwo from "@/assets/tags/coffefortwo.svg";
import DateIcon from "@/assets/tags/date.svg";
import Delivery from "@/assets/tags/delivery.svg";
import Events from "@/assets/tags/events.svg";
import Flame from "@/assets/tags/flame.svg";
import Groups from "@/assets/tags/groups.svg";
import HappyHour from "@/assets/tags/happyhour.svg";
import Karaoke from "@/assets/tags/karaoke.svg";
import Kids from "@/assets/tags/kids.svg";
import Menu from "@/assets/tags/menu.svg";
import Music from "@/assets/tags/music.svg";
import OpenKitchen from "@/assets/tags/open kitchen.svg";
import Outdoor from "@/assets/tags/outdoor.svg";
import Party from "@/assets/tags/party.svg";
import PetFriendly from "@/assets/tags/petfriendly.svg";
import Pool from "@/assets/tags/pool.svg";
import Quick from "@/assets/tags/quick.svg";
import Sea from "@/assets/tags/sea.svg";
import Solo from "@/assets/tags/solo.svg";
import SportsTv from "@/assets/tags/sportstv.svg";
import Store from "@/assets/tags/store.svg";
import Tacc from "@/assets/tags/tacc.svg";
import Takeaway from "@/assets/tags/takeaway.svg";
import Utensils from "@/assets/tags/utils.svg";
import Vegan from "@/assets/tags/vegan.svg";
import Veggie from "@/assets/tags/veggie.svg";
import Vinyl from "@/assets/tags/vinyl.svg";
import Wifi from "@/assets/tags/wifi.svg";
import Work from "@/assets/tags/work.svg";

type Icon = FC<SVGProps<SVGSVGElement>>;

/**
 * El ícono de cada chip de la ficha (CHIP_IDS de place-options.ts): las dietas (para "100 %" y "Opciones…") y los tags
 * que se muestran. Un tag nuevo sin ícono sale sólo con el texto; tag-icons.test.ts exige uno por cada chip.
 */
export const TAG_ICONS: Record<string, Icon> = {
  // Dietas
  vegetarian: Veggie,
  vegan: Vegan,
  gluten_free: Tacc,
  // Lo que hay en el lugar (FEATURES; la azotea está oculta)
  outdoor: Outdoor,
  sea_view: Sea,
  live_music: Music,
  vinyl: Vinyl,
  karaoke: Karaoke,
  shop: Store,
  events: Events,
  books: Books,
  board_games: BoardGames,
  watch_football: SportsTv,
  pool_table: Pool,
  kids_area: Babies,
  wifi: Wifi,
  pet_friendly: PetFriendly,
  accessible: Accessible,
  wood_fired_oven: Flame,
  open_kitchen: OpenKitchen,
  delivery: Delivery,
  takeaway: Takeaway,
  // Lo que ofrece (OFFERS)
  menu_of_the_day: Menu,
  all_you_can_eat: Utensils,
  shared_afternoon_tea: CoffeeForTwo,
  happy_hour: HappyHour,
  // Para qué sirve (GOOD_FOR)
  date: DateIcon,
  work: Work,
  after_office: AfterOffice,
  groups: Groups,
  kids_friendly: Kids,
  solo: Solo,
  celebration: Party,
  quick: Quick,
};
