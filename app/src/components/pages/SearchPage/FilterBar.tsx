import Link from "next/link";
import { CATEGORIES, label } from "@shared/tags.ts";
import { neighborhoodDisplayName } from "@shared/neighborhood-names.ts";
import { publishedNeighborhoods, type Chip } from "@/server/search";
import { DIET_KEYS } from "@/server/search/interpretation";
import { dietLabel } from "@/server/search/labels";
import NearMe from "./NearMe";
import NeighborhoodSelect from "./NeighborhoodSelect";
import { addFilterHref, removeChipHref, searchHref, setNeighborhoodHref, type SearchUrl } from "./search-href";
import styles from "./SearchPage.module.scss";

type FilterBarProps = {
  state: SearchUrl;
  /** Chips de la búsqueda: la barra es otra vista de ellos (activo = hay chip, venga del texto o de la barra). */
  chips: Chip[];
  needsLocation: boolean;
};

const Toggle = ({ state, chips, kind, id, text }: { state: SearchUrl; chips: Chip[]; kind: Chip["kind"]; id: string; text: string }) => {
  const chip = chips.find((item) => item.kind === kind && item.id === id);
  return chip ? (
    <Link className={styles.filter} data-active href={removeChipHref(state, chip)} aria-label={`Quitar filtro: ${text}`}>
      {text} ×
    </Link>
  ) : (
    <Link className={styles.filter} href={addFilterHref(state, { kind, id })}>
      {text}
    </Link>
  );
};

const FilterBar = async ({ state, chips, needsLocation }: FilterBarProps) => {
  const activeNeighborhood = chips.find((chip) => chip.kind === "neighborhood")?.id ?? "";
  // Los barrios con lugares publicados, más el activo aunque no tenga ninguno ("cafés en Pocitos"): si no, el
  // select mostraría "Todos" con un barrio aplicado.
  const published = await publishedNeighborhoods().catch(() => [] as string[]);
  const neighborhoods = [...new Set([...published, ...(activeNeighborhood ? [activeNeighborhood] : [])])]
    .map((id) => ({ id, label: neighborhoodDisplayName(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
  const hrefs = Object.fromEntries([
    ["", setNeighborhoodHref(state, null, chips)],
    ...neighborhoods.map(({ id }) => [id, setNeighborhoodHref(state, id, chips)]),
  ]);
  const toggle = { state, chips };

  return (
    <nav className={styles.filterBar} aria-label="Filtros">
      <div className={styles.filterRow}>
        <Toggle {...toggle} kind="openAt" id="now" text="Abierto ahora" />
        <NeighborhoodSelect options={neighborhoods} value={activeNeighborhood} hrefs={hrefs} />
        <NearMe state={state} active={Boolean(state.near)} offHref={searchHref({ ...state, near: null })} auto={needsLocation && !state.near} />
      </div>
      <div className={styles.filterRow}>
        {Object.keys(CATEGORIES).map((id) => (
          <Toggle key={id} {...toggle} kind="category" id={id} text={label(id, "es")} />
        ))}
      </div>
      <div className={styles.filterRow}>
        {DIET_KEYS.map((key) => (
          <Toggle key={key} {...toggle} kind="diet" id={key} text={dietLabel(key, "es")} />
        ))}
      </div>
    </nav>
  );
};

export default FilterBar;
