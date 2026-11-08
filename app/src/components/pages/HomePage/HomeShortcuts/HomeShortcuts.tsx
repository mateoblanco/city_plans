import FilterChip from "@/components/HeaderSearch/FilterBar/FilterChip/FilterChip";
import { searchHref } from "@/components/pages/SearchPage/utils/search-href";
import styles from "./HomeShortcuts.module.scss";

/**
 * Accesos directos de la home. Los de texto se resuelven por el diccionario, sin pasar por el modelo; los de dieta van
 * sin texto, con el filtro de la barra (se ven activos en el select de Dieta).
 */
const SHORTCUTS = [
  { text: "Comer", href: searchHref({ q: "comer" }) },
  { text: "Tomar algo", href: searchHref({ q: "tomar algo" }) },
  { text: "Cafés", href: searchHref({ q: "cafés" }) },
  { text: "Brunch", href: searchHref({ q: "brunch" }) },
  { text: "Vegetariano", href: searchHref({ q: "", f: "diet:vegetarian" }) },
  { text: "Vegano", href: searchHref({ q: "", f: "diet:vegan" }) },
  { text: "Sin TACC", href: searchHref({ q: "", f: "diet:glutenFree" }) },
];

type Props = {
  /** wrap: centrados y en varias líneas (el hero de desktop). scroll: una sola línea con scroll horizontal (mobile). */
  layout: "wrap" | "scroll";
};

const HomeShortcuts = (props: Props) => {
  return (
    <nav aria-label="Accesos directos" className={styles[props.layout]}>
      {SHORTCUTS.map((shortcut) => (
        <FilterChip key={shortcut.text} href={shortcut.href} text={shortcut.text} />
      ))}
    </nav>
  );
};

export default HomeShortcuts;
