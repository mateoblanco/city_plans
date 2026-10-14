import Link from "next/link";
import { INTENT_IDS, INTENTS } from "@shared/intents.ts";
import { neighborhoodDisplayName } from "@shared/neighborhood-names.ts";
import { publishedNeighborhoods, type Chip, type IntentBar } from "@/server/search";
import { DIET_KEYS } from "@/server/search/interpretation";
import { dietLabel } from "@/server/search/labels";
import NearMe from "./NearMe";
import NeighborhoodSelect from "./NeighborhoodSelect";
import { addFilterHref, extraHref, intentHref, removeChipHref, searchHref, setNeighborhoodHref, subHref, type SearchUrl } from "./search-href";
import styles from "./SearchPage.module.scss";

type FilterBarProps = {
  state: SearchUrl;
  /** Chips de la búsqueda: la barra es otra vista de ellos (activo = hay chip, venga del texto o de la barra). */
  chips: Chip[];
  /** Intención, sub-filtros y extras del texto. */
  bar: IntentBar;
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

const FilterBar = async ({ state, chips, bar, needsLocation }: FilterBarProps) => {
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
  const activeDiets = chips.filter((chip) => chip.kind === "diet").length;
  const activeIntent = bar.intent?.id ?? null;
  const showSubs = bar.subs.length > 0 || bar.extras.length > 0;

  return (
    <nav className={styles.filterBar} aria-label="Filtros">
      <div className={styles.filterRow}>
        <Toggle {...toggle} kind="openAt" id="now" text="Abierto ahora" />
        <NeighborhoodSelect options={neighborhoods} value={activeNeighborhood} hrefs={hrefs} />
        <NearMe state={state} active={Boolean(state.near)} offHref={searchHref({ ...state, near: null })} auto={needsLocation && !state.near} />
        <details className={styles.more}>
          <summary className={styles.filter} data-active={activeDiets > 0 || undefined}>
            Más filtros{activeDiets > 0 ? ` · ${activeDiets}` : ""}
          </summary>
          <div className={styles.filterRow}>
            {DIET_KEYS.map((key) => (
              <Toggle key={key} {...toggle} kind="diet" id={key} text={dietLabel(key, "es")} />
            ))}
          </div>
        </details>
      </div>
      <div className={styles.intentRow} role="group" aria-label="Qué querés hacer">
        {INTENT_IDS.map((id) => {
          const active = id === activeIntent;
          return (
            <Link
              key={id}
              className={styles.intent}
              data-active={active || undefined}
              aria-current={active ? "true" : undefined}
              href={intentHref(state, active ? null : id, bar)}
            >
              {INTENTS[id].label.es}
            </Link>
          );
        })}
      </div>
      {showSubs && (
        <div className={styles.filterRow} role="group" aria-label="Sub-filtros">
          {bar.subs.map((sub) => (
            <Link
              key={sub.id}
              className={styles.filter}
              data-active={sub.active || undefined}
              href={subHref(state, sub.id, bar)}
              aria-label={sub.active ? `Quitar filtro: ${sub.label}` : undefined}
            >
              {sub.active ? `${sub.label} ×` : sub.label}
            </Link>
          ))}
          {bar.extras.map((chip) => (
            <Link
              key={`${chip.kind}:${chip.id}`}
              className={styles.filter}
              data-active
              href={extraHref(state, chip, bar)}
              aria-label={`Quitar filtro: ${chip.label}`}
            >
              {chip.label} ×
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
};

export default FilterBar;
