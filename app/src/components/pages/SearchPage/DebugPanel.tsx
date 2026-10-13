import type { SearchDebug } from "@/server/search";
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
      <summary>Debug</summary>
      <Json title="Interpretación" value={{ source, model, llmError, discarded, original, interpretation, nameMatches, semanticText, keywords }} />
      <Json title="Intentos" value={debug.attempts} />
      <Json title="Rankings" value={debug.rankings} />
      <Json title="Resultados y empujones" value={debug.results} />
      <Json title="Tiempos (ms)" value={debug.timings} />
    </details>
  );
};

export default DebugPanel;
