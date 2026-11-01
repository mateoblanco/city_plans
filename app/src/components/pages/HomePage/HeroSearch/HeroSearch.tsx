import Search from "@/components/Search/Search";
import FilterChip from "@/components/HeaderSearch/FilterBar/FilterChip/FilterChip";
import { searchHref } from "@/components/pages/SearchPage/utils/search-href";
import styles from './HeroSearch.module.scss';

/** Accesos directos de la home: cada uno busca su texto. Todos se resuelven por el diccionario, sin pasar por el modelo. */
const SHORTCUTS = [
  { text: "Comer", q: "comer" },
  { text: "Tomar algo", q: "tomar algo" },
  { text: "Cafés", q: "cafés" },
  { text: "Brunch", q: "brunch" },
  { text: "Vegetariano", q: "vegetariano" },
  { text: "Vegano", q: "vegano" },
  { text: "Sin TACC", q: "sin tacc" },
];

const HeroSearch = () => {
  return (
    <div className={styles.hero}>
      <h1 className={styles.heading}>Descubrí lugares para salir hoy</h1>
      <div className={styles.search}>
        <Search />
        <nav aria-label="Accesos directos" className={styles.shortcuts}>
          {SHORTCUTS.map((shortcut) => (
            <FilterChip key={shortcut.q} href={searchHref({ q: shortcut.q })} text={shortcut.text} />
          ))}
        </nav>
      </div>
    </div>
  );
};

export default HeroSearch;
