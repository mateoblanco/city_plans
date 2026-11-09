import FilterChip from "@/components/HeaderSearch/FilterBar/FilterChip/FilterChip";
import { SHORTCUTS } from "./utils/shortcuts";
import styles from "./HomeShortcuts.module.scss";

type Props = {
  /** wrap: centrados y en varias líneas (el hero de desktop). scroll: una sola línea con scroll horizontal (mobile). */
  layout: "wrap" | "scroll";
};

const HomeShortcuts = (props: Props) => {
  return (
    <nav aria-label="Accesos directos" className={styles[props.layout]}>
      {SHORTCUTS.map((shortcut) => (
        <FilterChip key={shortcut.text} href={shortcut.href} text={shortcut.text} />
      ))}
    </nav>
  );
};

export default HomeShortcuts;
