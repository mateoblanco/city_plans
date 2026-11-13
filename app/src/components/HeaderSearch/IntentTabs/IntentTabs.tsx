import Image from "next/image";
import Link from "next/link";
import type { BarRef, SearchUrl } from "@/components/pages/SearchPage/utils/search-href";
import ScrollFade from "../ScrollFade/ScrollFade";
import { intentTabs } from "./utils/intent-tabs";
import styles from "./IntentTabs.module.scss";

type Props = {
  /** La búsqueda actual (en la home, vacía). */
  state: SearchUrl;
  /** Lo que la barra sabe de la intención (la activa, venga de la URL o del texto). null: todavía no se sabe. */
  bar: BarRef | null;
  /** La home: "Todo" es la actual y lleva a /. */
  home?: boolean;
};

/**
 * Pestañas de intención arriba del buscador (Todo, Comer, Tomar algo, Cafés, Postres): links, una sola activa
 * (aria-current). No son role="tab": navegan a otra búsqueda y no tienen paneles. Mobile: subrayadas, en una línea con
 * scroll; desde md, centradas y más grandes.
 */
const IntentTabs = (props: Props) => (
  <nav aria-label="Qué querés hacer" className={styles.nav}>
    <ScrollFade className={styles.line}>
      <ul className={styles.list}>
        {intentTabs(props.state, props.bar, props.home).map((tab) => (
          <li key={tab.id ?? "all"}>
            <Link className={styles.tab} href={tab.href} aria-current={tab.current ? "page" : undefined}>
              {tab.icon && <Image className={styles.icon} src={tab.icon} alt="" width={20} height={20} />}
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </ScrollFade>
  </nav>
);

export default IntentTabs;
