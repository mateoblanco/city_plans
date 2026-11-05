import Image from "next/image";
import Search from "@/components/Search/Search";
import heroImage from "@/assets/hero_image.png";
import FilterChip from "@/components/HeaderSearch/FilterBar/FilterChip/FilterChip";
import { searchHref } from "@/components/pages/SearchPage/utils/search-href";
import styles from './HeroSearch.module.scss';

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

const HeroSearch = () => {
  return (
    <div className={styles.hero}>
      <Image src={heroImage} alt="" fill priority sizes="100vw" className={styles.backdrop} />
      <h1 className={styles.heading}>Descubrí lugares para salir hoy</h1>
      <div className={styles.search}>
        <Search />
        <nav aria-label="Accesos directos" className={styles.shortcuts}>
          {SHORTCUTS.map((shortcut) => (
            <FilterChip key={shortcut.text} href={shortcut.href} text={shortcut.text} />
          ))}
        </nav>
      </div>
    </div>
  );
};

export default HeroSearch;
