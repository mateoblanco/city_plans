import type { Chip, IntentBar, SearchDebug, SearchResponse } from "@/server/search";
import { formatUsd } from "@/server/search/cost";
import { DAY_NAMES } from "@/server/search/labels";
import CopyResponse from "./CopyResponse/CopyResponse";
import styles from "./DebugPanel.module.scss";

const SOURCE_LABELS: Record<SearchDebug["source"], string> = {
  shortcut: "atajo del diccionario",
  name: "nombre",
  llm: "modelo",
  fallback: "respaldo sin modelo",
  filters: "sólo filtros",
};

const join = (values: string[]) => (values.length ? values.join(", ") : "—");

const origin = ({ fromText, fromFilter }: Chip) => (fromText && fromFilter ? "texto + barra" : fromFilter ? "barra" : fromText ? "texto" : "—");

type InterpretedProps = {
  debug: SearchDebug;
  chips: Chip[];
  bar: IntentBar;
};

/** Lo que interpretó la búsqueda en limpio: lo que no se ve en la barra (platos, preferencias, vibe…) incluido. */
const Interpreted = (props: InterpretedProps) => {
  const { interpretation: value, semanticText, source } = props.debug;
  const at = value.must.openAt;
  const openAt = at === null ? "—" : at === "now" ? "ahora" : `${at.day === null ? "hoy" : DAY_NAMES.es[at.day]}${at.time ? ` ${at.time}` : ""}`;
  const rows: [string, string][] = [
    ["Fuente", SOURCE_LABELS[source]],
    ["Intención", props.bar.intent ? `${props.bar.intent.id} (${props.bar.intent.fromText ? "texto" : "URL"})` : "—"],
    ["Intención del texto", props.bar.textIntent ?? "—"],
    ["Lo exigido", props.debug.must.ok ? join(props.debug.must.trace.map((entry) => `${entry.item} → ${entry.detail}`)) : `PERDIDO: ${props.debug.must.violations.join(", ")}`],
    ["Descartado", join(props.debug.discarded.map((entry) => `${entry.value} (${entry.reason})`))],
    ["Votos", join(Object.entries(props.debug.intentVotes).map(([id, votes]) => `${id}: ${votes}`))],
    ["Sub-filtros", join(props.bar.subs.filter((sub) => sub.active).map((sub) => `${sub.id} (${sub.fromText ? `texto: ${sub.removeKeys.join(", ")}` : "URL"})`))],
    ["Extras", join(props.bar.extras.map((chip) => `${chip.kind}:${chip.id}`))],
    ["Platos", join(value.dishes.map((dish) => `${dish.name}${dish.relatedTags.length + dish.relatedCategories.length ? ` (relacionados: ${[...dish.relatedTags, ...dish.relatedCategories].join(", ")})` : ""}`))],
    ["Preferencias", join([...value.prefer.categories, ...value.prefer.tags, ...(value.prefer.style ? [`style:${value.prefer.style}`] : [])])],
    ["Vibe", value.vibe ?? "—"],
    ["Texto semántico", semanticText ?? "—"],
    ["Keywords", join(props.debug.keywords)],
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
    ["Chips", join(props.chips.map((chip) => `${chip.kind}:${chip.label} (${origin(chip)})`))],
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

type JsonProps = {
  title: string;
  value: unknown;
};

const Json = (props: JsonProps) => (
  <details>
    <summary>{props.title}</summary>
    <pre>{JSON.stringify(props.value, null, 2)}</pre>
  </details>
);

const decimal = (value: number | null) => (value === null ? "—" : value.toLocaleString("es-UY", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));

type RelevanceProps = {
  debug: SearchDebug;
};

/** Corte por relevancia: el umbral y lo que se sacó, con el motivo. */
const Relevance = (props: RelevanceProps) => {
  const cut = props.debug.results.flatMap((result) => ("cut" in result.relevance ? [{ ...result, reason: result.relevance.reason }] : []));
  if (!props.debug.relevance) return <p>Corte por relevancia: sin embedding, no se corta.</p>;
  return (
    <div>
      <p>
        Corte por relevancia: mejor similitud {decimal(props.debug.relevance.best)}, se corta debajo de {decimal(props.debug.relevance.threshold)} sin coincidencia
        explícita. {cut.length === 0 ? "No se cortó nada." : `Cortados (${cut.length}):`}
      </p>
      {cut.length > 0 && (
        <ul>
          {cut.map((result) => (
            <li key={result.id}>
              {result.name}: {result.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

type Props = {
  debug: SearchDebug;
  /** Todos los chips de la búsqueda (la UI sólo muestra los de la barra). */
  chips: Chip[];
  bar: IntentBar;
  /** La respuesta entera, para "Copiar respuesta". */
  response: SearchResponse;
};

const DebugPanel = (props: Props) => {
  const { source, model, llmError, discarded, original, interpretation, nameMatches, semanticText, keywords } = props.debug;

  return (
    <details className={styles.debug} open>
      <summary>Debug · {formatUsd(props.debug.cost.totalUsd)}</summary>
      <CopyResponse json={JSON.stringify(props.response)} />
      <p>
        Costo:{" "}
        {props.debug.cost.calls.length === 0
          ? "sin llamadas pagas"
          : props.debug.cost.calls
              .map((call) => `${call.step} (${call.model}) ${call.cached ? "cache" : call.usd === null ? "sin dato" : formatUsd(call.usd)}${call.discarded ? ", descartado" : ""}`)
              .join(" · ")}
      </p>
      <Interpreted debug={props.debug} chips={props.chips} bar={props.bar} />
      <Relevance debug={props.debug} />
      <Json title="Interpretación" value={{ source, model, llmError, discarded, original, interpretation, nameMatches, semanticText, keywords }} />
      <Json title="Intentos" value={props.debug.attempts} />
      <Json title="Rankings" value={props.debug.rankings} />
      <Json title="Resultados y empujones" value={props.debug.results} />
      <Json title="Tiempos (ms)" value={props.debug.timings} />
    </details>
  );
};

export default DebugPanel;
