import { INTENT_IDS, INTENTS } from "@shared/intents.ts";
import { neighborhoodDisplayName } from "@shared/neighborhood-names.ts";
import { publishedNeighborhoods, type Chip, type IntentBar } from "@/server/search";
import { DIET_KEYS } from "@/server/search/interpretation";
import { dietLabel } from "@/server/search/labels";
import FilterChip from "./FilterChip/FilterChip";
import NeighborhoodSelect from "./NeighborhoodSelect/NeighborhoodSelect";
import { addFilterHref, extraHref, intentHref, removeChipHref, searchHref, subHref, type SearchUrl } from "@/components/pages/SearchPage/utils/search-href";
import chipStyles from "./FilterChip/FilterChip.module.scss";
import styles from "./FilterBar.module.scss";

type ToggleProps = {
  state: SearchUrl;
  chips: Chip[];
  kind: Chip["kind"];
  id: string;
  text: string;
};

const Toggle = (props: ToggleProps) => {
  const chip = props.chips.find((item) => item.kind === props.kind && item.id === props.id);
  return chip ? (
    <FilterChip active href={removeChipHref(props.state, chip)} text={props.text} />
  ) : (
    <FilterChip href={addFilterHref(props.state, { kind: props.kind, id: props.id })} text={props.text} />
  );
};

type Props = {
  state: SearchUrl;
  /** Chips de la búsqueda: la barra es otra vista de ellos (activo = hay chip, venga del texto o de la barra). */
  chips: Chip[];
  /** Intención, sub-filtros y extras del texto. */
  bar: IntentBar;
  needsLocation: boolean;
};

const FilterBar = async (props: Props) => {
  const neighborhoodChips = props.chips
    .filter((chip) => chip.kind === "neighborhood")
    .map(({ kind, id, fromText, fromFilter }) => ({ kind, id, fromText, fromFilter }));
  // Los barrios con lugares publicados, más los activos aunque no tengan ninguno ("cafés en Pocitos"): si no, el
  // select mostraría "Todos" con un barrio aplicado.
  const published = await publishedNeighborhoods().catch(() => [] as string[]);
  const neighborhoods = [...new Set([...published, ...neighborhoodChips.map((chip) => chip.id)])]
    .map((id) => ({ id, label: neighborhoodDisplayName(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
  const toggle = { state: props.state, chips: props.chips };
  const activeDiets = props.chips.filter((chip) => chip.kind === "diet").length;
  const activeIntent = props.bar.intent?.id ?? null;
  const showSubs = props.bar.subs.length > 0 || props.bar.extras.length > 0;

  return (
    <nav className={styles.filterBar} aria-label="Filtros">
      <div className={styles.filterRow}>
        <NeighborhoodSelect options={neighborhoods} chips={neighborhoodChips} state={props.state} autoNear={props.needsLocation} />
        <Toggle {...toggle} kind="openAt" id="today" text="Abre hoy" />
        {/* <details className={styles.more}>
          <summary className={chipStyles.chip} data-active={activeDiets > 0 || undefined}>
            Más filtros{activeDiets > 0 ? ` · ${activeDiets}` : ""}
          </summary>
          <div className={styles.filterRow}>
            {DIET_KEYS.map((key) => (
              <Toggle key={key} {...toggle} kind="diet" id={key} text={dietLabel(key, "es")} />
            ))}
          </div>
        </details> */}
      </div>
      <div className={styles.filterRow} role="group" aria-label="Qué querés hacer">
        {INTENT_IDS.map((id) => {
          const active = id === activeIntent;
          return (
            <FilterChip
              key={id}
              active={active}
              current={active}
              href={intentHref(props.state, active ? null : id, props.bar)}
              text={INTENTS[id].label.es}
            />
          );
        })}
      </div>
      {showSubs && (
        <div className={`${styles.filterRow} ${styles.subRow}`} role="group" aria-label="Sub-filtros">
          {props.bar.subs.map((sub) => (
            <FilterChip key={sub.id} active={sub.active} href={subHref(props.state, sub.id, props.bar)} text={sub.label} />
          ))}
          {props.bar.subs.length > 0 && props.bar.extras.length > 0 && <hr className={styles.divider} />}
          {props.bar.extras.map((chip) => (
            <FilterChip key={`${chip.kind}:${chip.id}`} active href={extraHref(props.state, chip, props.bar)} text={chip.label} />
          ))}
        </div>
      )}
    </nav>
  );
};

export default FilterBar;
