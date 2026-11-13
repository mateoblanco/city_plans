import { Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import HeaderOffset from './HeaderOffset';
import NavigationTracker from './NavigationTracker';
import styles from './Header.module.scss';
import Logo from "@/assets/logo.svg";

type Props = {
  /** Centro de la primera fila (en /search, el input). */
  children?: ReactNode;
  /** Arriba del centro (en home y /search, las pestañas de intención). */
  tabs?: ReactNode;
  /** Segunda fila, centrada (en /search, la barra de filtros). */
  bottom?: ReactNode;
  /**
   * Debajo de ese breakpoint: sin logo, el centro y la segunda fila a todo el ancho. Home y /search cambian en md; la
   * ficha, que pasa a una columna antes, en ml.
   */
  compactBelow?: "md" | "ml";
  /**
   * La home: sticky en vez de fixed, en el flujo y sin espaciador. El espaciador toma el alto que mide HeaderOffset al
   * hidratar, y con la barra de filtros eso corría el contenido (CLS). Sin mapa fijo debajo no hace falta.
   */
  sticky?: boolean;
};

const Header = (props: Props) => {
  return (
    <>
      <header
        className={styles.header}
        data-compact={props.compactBelow}
        data-sticky={props.sticky || undefined}
      >
        <HeaderOffset />
        {/* En una ruta dinámica el pathname es dato de request: no bloquea el resto del header. */}
        <Suspense fallback={null}>
          <NavigationTracker />
        </Suspense>
        <div className={styles.top} data-header-top data-with-tabs={props.tabs ? true : undefined}>
          <Link href="/" className={styles.logo}>
            <Logo width={40} height={40} />
            Montevideo
          </Link>
          <div className={styles.center} data-with-tabs={props.tabs ? true : undefined}>
            {props.tabs}
            {props.children}
          </div>
          <div className={styles.end} />
          {/* <UserButton /> */}
        </div>
        {props.bottom && <div className={styles.bottom}>{props.bottom}</div>}
      </header>
      {/* El header es fixed y no ocupa lugar: el espaciador reserva su alto para que el contenido arranque debajo. */}
      {!props.sticky && <div className={styles.spacer} aria-hidden="true" />}
    </>
  );
};

export default Header;
