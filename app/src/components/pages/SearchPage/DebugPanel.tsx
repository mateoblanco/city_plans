import type { SearchDebug } from "@/server/search";
import { formatUsd } from "@/server/search/cost";
import styles from "./SearchPage.module.scss";

type DebugPanelProps = {
  debug: SearchDebug;
};

const Json = ({ title, value }: { title: string; value: unknown }) => (
  <details>
    <summary>{title}</summary>
    <pre>{JSON.stringify(value, null, 2)}</pre>
  </details>
);

const DebugPanel = ({ debug }: DebugPanelProps) => {
  const { source, model, llmError, discarded, original, interpretation, nameMatches, semanticText, keywords } = debug;

  return (
    <details className={styles.debug}>
      <summary>Debug · {formatUsd(debug.cost.totalUsd)}</summary>
      <p>
        Costo:{" "}
        {debug.cost.calls.length === 0
          ? "sin llamadas pagas"
          : debug.cost.calls
              .map((call) => `${call.step} (${call.model}) ${call.cached ? "cache" : call.usd === null ? "sin dato" : formatUsd(call.usd)}`)
              .join(" · ")}
      </p>
      <Json title="Interpretación" value={{ source, model, llmError, discarded, original, interpretation, nameMatches, semanticText, keywords }} />
      <Json title="Intentos" value={debug.attempts} />
      <Json title="Rankings" value={debug.rankings} />
      <Json title="Resultados y empujones" value={debug.results} />
      <Json title="Tiempos (ms)" value={debug.timings} />
    </details>
  );
};

export default DebugPanel;
