import Link from "next/link";
import { INTENT_IDS, INTENTS } from "@shared/intents.ts";
import { neighborhoodDisplayName } from "@shared/neighborhood-names.ts";
import { publishedNeighborhoods, type Chip, type IntentBar } from "@/server/search";
import { DIET_KEYS } from "@/server/search/interpretation";
import { dietLabel } from "@/server/search/labels";
import NearMe from "./NearMe";
import NeighborhoodSelect from "./NeighborhoodSelect/NeighborhoodSelect";
import { addFilterHref, extraHref, intentHref, removeChipHref, searchHref, setNeighborhoodHref, subHref, type SearchUrl } from "@/components/pages/SearchPage/utils/search-href";
import styles from "./HeaderSearch.module.scss";

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
    <Link className={styles.filter} data-active href={removeChipHref(props.state, chip)} aria-label={`Quitar filtro: ${props.text}`}>
      {props.text} ×
    </Link>
  ) : (
    <Link className={styles.filter} href={addFilterHref(props.state, { kind: props.kind, id: props.id })}>
      {props.text}
    </Link>
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
  const activeNeighborhood = props.chips.find((chip) => chip.kind === "neighborhood")?.id ?? "";
  // Los barrios con lugares publicados, más el activo aunque no tenga ninguno ("cafés en Pocitos"): si no, el
  // select mostraría "Todos" con un barrio aplicado.
  const published = await publishedNeighborhoods().catch(() => [] as string[]);
  const neighborhoods = [...new Set([...published, ...(activeNeighborhood ? [activeNeighborhood] : [])])]
    .map((id) => ({ id, label: neighborhoodDisplayName(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
  const hrefs = Object.fromEntries([
    ["", setNeighborhoodHref(props.state, null, props.chips)],
    ...neighborhoods.map(({ id }) => [id, setNeighborhoodHref(props.state, id, props.chips)]),
  ]);
  const toggle = { state: props.state, chips: props.chips };
  const activeDiets = props.chips.filter((chip) => chip.kind === "diet").length;
  const activeIntent = props.bar.intent?.id ?? null;
  const showSubs = props.bar.subs.length > 0 || props.bar.extras.length > 0;

  return (
    <nav className={styles.filterBar} aria-label="Filtros">
      <div className={styles.filterRow}>
        <NeighborhoodSelect options={neighborhoods} value={activeNeighborhood} hrefs={hrefs} />
        <Toggle {...toggle} kind="openAt" id="now" text="Abierto ahora" />
        {/* <NearMe state={props.state} active={Boolean(props.state.near)} offHref={searchHref({ ...props.state, near: null })} auto={props.needsLocation && !props.state.near} /> */}
        {/* <details className={styles.more}>
          <summary className={styles.filter} data-active={activeDiets > 0 || undefined}>
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
          const text = INTENTS[id].label.es;
          return (
            <Link
              key={id}
              className={styles.filter}
              data-active={active || undefined}
              aria-current={active ? "true" : undefined}
              aria-label={active ? `Quitar filtro: ${text}` : undefined}
              href={intentHref(props.state, active ? null : id, props.bar)}
            >
              {active ? `${text} ×` : text}
            </Link>
          );
        })}
      </div>
      {showSubs && (
        <div className={`${styles.filterRow} ${styles.subRow}`} role="group" aria-label="Sub-filtros">
          {props.bar.subs.map((sub) => (
            <Link
              key={sub.id}
              className={styles.filter}
              data-active={sub.active || undefined}
              href={subHref(props.state, sub.id, props.bar)}
              aria-label={sub.active ? `Quitar filtro: ${sub.label}` : undefined}
            >
              {sub.active ? `${sub.label} ×` : sub.label}
            </Link>
          ))}
          {props.bar.subs.length > 0 && props.bar.extras.length > 0 && <hr className={styles.divider} />}
          {props.bar.extras.map((chip) => (
            <Link
              key={`${chip.kind}:${chip.id}`}
              className={styles.filter}
              data-active
              href={extraHref(props.state, chip, props.bar)}
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
