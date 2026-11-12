import { INTENT_IDS, INTENTS } from "@shared/intents.ts";
import { neighborhoodDisplayName } from "@shared/neighborhood-names.ts";
import type { Chip, IntentBar, SearchLocation } from "@/server/search";
import { choiceKey } from "@/server/discounts/selection";
import { parseFilters } from "@/server/search/filters";
import { PRICES, type DietKey } from "@/server/search/interpretation";
import { dietLabel, PRICE_FILTER_LABELS } from "@/server/search/labels";
import FilterChip from "./FilterChip/FilterChip";
import LocationSelect from "./LocationSelect/LocationSelect";
import PriceSelect from "./PriceSelect/PriceSelect";
import DietSelect from "./DietSelect/DietSelect";
import DiscountFilter from "./DiscountFilter/DiscountFilter";
import ScrollFade from "./ScrollFade/ScrollFade";
import { DIET_OPTIONS } from "./DietSelect/utils/diet-selection";
import type { FilterBarData } from "./utils/filter-bar-data";
import { addFilterHref, barIntentHref, extraHref, removeChipHref, subHref, type SearchUrl } from "@/components/pages/SearchPage/utils/search-href";
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
  /** Dónde buscó (cerca mío, todo Montevideo, barrio o zona): lo activo del filtro "Dónde". */
  location: SearchLocation;
  /** Barrios publicados y proveedores de descuento (loadFilterBarData), pedidos en paralelo con la búsqueda. */
  data: FilterBarData;
};

const FilterBar = (props: Props) => {
  const neighborhoodChips = props.chips
    .filter((chip) => chip.kind === "neighborhood")
    .map(({ kind, id, fromText, fromFilter }) => ({ kind, id, fromText, fromFilter }));
  // Los barrios con lugares publicados, más los activos aunque no tengan ninguno ("cafés en Pocitos"): si no, el
  // select mostraría "Todos" con un barrio aplicado.
  const neighborhoods = [...new Set([...props.data.publishedNeighborhoods, ...neighborhoodChips.map((chip) => chip.id)])]
    .map((id) => ({ id, label: neighborhoodDisplayName(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
  const priceChips = props.chips
    .filter((chip) => chip.kind === "price")
    .map(({ kind, id, fromText, fromFilter }) => ({ kind, id, fromText, fromFilter }));
  const prices = PRICES.map((id) => ({ id, label: PRICE_FILTER_LABELS[id] }));
  const dietChips = props.chips
    .filter((chip) => chip.kind === "diet")
    .map(({ kind, id, fromText, fromFilter }) => ({ kind, id, fromText, fromFilter }));
  const diets = DIET_OPTIONS.map((id) => ({ id, label: dietLabel(id as DietKey, "es") }));
  // Descuentos: no vienen del texto, así que lo activo sale de `f` y no de los chips.
  const discountProviders = props.data.discountProviders;
  const activeDiscounts = parseFilters(props.state.f).discounts.map(choiceKey);
  const toggle = { state: props.state, chips: props.chips };
  const activeIntent = props.bar.intent?.id ?? null;
  // Segunda fila: sólo las opciones de la intención activa. Lo que pidió el texto (momentos, platos, tags…) no va como
  // chip: ya está en el buscador. Quedan los filtros de la URL que no tienen otro lugar (tag de una fila de la home,
  // "Ver todos" de un grupo), para poder verlos y quitarlos.
  const extras = props.bar.extras.filter((chip) => chip.fromFilter);
  const showSubs = props.bar.subs.length > 0 || extras.length > 0;

  return (
    <nav className={styles.filterBar} aria-label="Filtros">
      {/* Primera línea: selects e intenciones. En desktop no existe como caja (display: contents); en mobile es la
          línea con su propio scroll horizontal y degradado, con las intenciones primero (la activa adelante). */}
      <ScrollFade className={styles.mainLine}>
        <div className={`${styles.filterRow} ${styles.selectRow}`}>
          <LocationSelect options={neighborhoods} chips={neighborhoodChips} state={props.state} location={props.location} />
          <PriceSelect options={prices} chips={priceChips} state={props.state} />
          <DietSelect options={diets} chips={dietChips} state={props.state} />
          {discountProviders.length > 0 && <DiscountFilter providers={discountProviders} active={activeDiscounts} state={props.state} />}
          <Toggle {...toggle} kind="openAt" id="today" text="Abre hoy" />
        </div>
        <hr className={`${styles.divider} ${styles.intentDivider}`} />
        <div className={`${styles.filterRow} ${styles.intentRow}`} role="group" aria-label="Qué querés hacer">
          {INTENT_IDS.map((id) => {
            const active = id === activeIntent;
            return (
              <FilterChip
                key={id}
                active={active}
                current={active}
                href={barIntentHref(props.state, active ? null : id, props.bar)}
                text={INTENTS[id].label.es}
              />
            );
          })}
        </div>
      </ScrollFade>
      {showSubs && (
        <div className={`${styles.filterRow} ${styles.subRow}`} role="group" aria-label="Sub-filtros">
          {props.bar.subs.map((sub) => (
            <FilterChip key={sub.id} active={sub.active} href={subHref(props.state, sub.id, props.bar)} text={sub.label} />
          ))}
          {props.bar.subs.length > 0 && extras.length > 0 && <hr className={styles.divider} />}
          {extras.map((chip) => (
            <FilterChip key={`${chip.kind}:${chip.id}`} active href={extraHref(props.state, chip, props.bar)} text={chip.label} />
          ))}
        </div>
      )}
    </nav>
  );
};

export default FilterBar;
