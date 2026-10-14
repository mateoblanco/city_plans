import type { Chip, IntentBar, SearchDebug } from "@/server/search";
import { formatUsd } from "@/server/search/cost";
import { DAY_NAMES } from "@/server/search/labels";
import styles from "./SearchPage.module.scss";

type DebugPanelProps = {
  debug: SearchDebug;
  /** Todos los chips de la búsqueda (la UI sólo muestra los de la barra). */
  chips: Chip[];
  bar: IntentBar;
};

const SOURCE_LABELS: Record<SearchDebug["source"], string> = {
  shortcut: "atajo del diccionario",
  name: "nombre",
  llm: "modelo",
  fallback: "respaldo sin modelo",
  filters: "sólo filtros",
};

const join = (values: string[]) => (values.length ? values.join(", ") : "—");

const origin = ({ fromText, fromFilter }: Chip) => (fromText && fromFilter ? "texto + barra" : fromFilter ? "barra" : fromText ? "texto" : "—");

/** Lo que interpretó la búsqueda en limpio: lo que no se ve en la barra (platos, preferencias, vibe…) incluido. */
const Interpreted = ({ debug, chips, bar }: DebugPanelProps) => {
  const { interpretation: value, semanticText, source } = debug;
  const at = value.must.openAt;
  const openAt = at === null ? "—" : at === "now" ? "ahora" : `${at.day === null ? "hoy" : DAY_NAMES.es[at.day]}${at.time ? ` ${at.time}` : ""}`;
  const rows: [string, string][] = [
    ["Fuente", SOURCE_LABELS[source]],
    ["Intención", bar.intent ? `${bar.intent.id} (${bar.intent.fromText ? "texto" : "URL"})` : "—"],
    ["Intención del texto", bar.textIntent ?? "—"],
    ["Votos", join(Object.entries(debug.intentVotes).map(([id, votes]) => `${id}: ${votes}`))],
    ["Sub-filtros", join(bar.subs.filter((sub) => sub.active).map((sub) => `${sub.id} (${sub.fromText ? `texto: ${sub.removeKeys.join(", ")}` : "URL"})`))],
    ["Extras", join(bar.extras.map((chip) => `${chip.kind}:${chip.id}`))],
    ["Platos", join(value.dishes.map((dish) => `${dish.name}${dish.relatedTags.length + dish.relatedCategories.length ? ` (relacionados: ${[...dish.relatedTags, ...dish.relatedCategories].join(", ")})` : ""}`))],
    ["Preferencias", join([...value.prefer.categories, ...value.prefer.tags])],
    ["Vibe", value.vibe ?? "—"],
    ["Texto semántico", semanticText ?? "—"],
    ["Tags obligatorios", join(value.must.tags)],
    ["Categorías", join(value.must.categories)],
    ["Dieta", join(Object.entries(value.must.diet).filter(([, on]) => on).map(([key]) => key))],
    ["Barrios", join(value.must.neighborhoods)],
    ["Abierto", openAt],
    ["Precio", join(value.must.price)],
    ["Excluye", join([...value.exclude.categories, ...value.exclude.tags])],
    ["Nombre", value.nameQuery ?? "—"],
    ["Lo mejor", value.wantsBest ? "sí" : "no"],
    ["Sin reconocer", join(value.unrecognized)],
    ["Chips", join(chips.map((chip) => `${chip.kind}:${chip.label} (${origin(chip)})`))],
  ];
  return (
    <dl className={styles.debugSummary}>
      {rows.map(([term, detail]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{detail}</dd>
        </div>
      ))}
    </dl>
  );
};

const Json = ({ title, value }: { title: string; value: unknown }) => (
  <details>
    <summary>{title}</summary>
    <pre>{JSON.stringify(value, null, 2)}</pre>
  </details>
);

const DebugPanel = ({ debug, chips, bar }: DebugPanelProps) => {
  const { source, model, llmError, discarded, original, interpretation, nameMatches, semanticText, keywords } = debug;

  return (
    <details className={styles.debug} open>
      <summary>Debug · {formatUsd(debug.cost.totalUsd)}</summary>
      <p>
        Costo:{" "}
        {debug.cost.calls.length === 0
          ? "sin llamadas pagas"
          : debug.cost.calls
              .map((call) => `${call.step} (${call.model}) ${call.cached ? "cache" : call.usd === null ? "sin dato" : formatUsd(call.usd)}${call.discarded ? ", descartado" : ""}`)
              .join(" · ")}
      </p>
      <Interpreted debug={debug} chips={chips} bar={bar} />
      <Json title="Interpretación" value={{ source, model, llmError, discarded, original, interpretation, nameMatches, semanticText, keywords }} />
      <Json title="Intentos" value={debug.attempts} />
      <Json title="Rankings" value={debug.rankings} />
      <Json title="Resultados y empujones" value={debug.results} />
      <Json title="Tiempos (ms)" value={debug.timings} />
    </details>
  );
};

export default DebugPanel;
