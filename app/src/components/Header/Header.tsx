import { Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import HeaderOffset from './HeaderOffset';
import NavigationTracker from './NavigationTracker';
import styles from './Header.module.scss';
import Logo from "@/assets/logo.svg";

type Props = {
  /** Centro de la primera fila (en /search, el input). */
  children?: ReactNode;
  /** Segunda fila, centrada (en /search, la barra de filtros). */
  bottom?: ReactNode;
  /**
   * Debajo de ese breakpoint: sin logo, el centro y la segunda fila a todo el ancho. Home y /search cambian en md; la
   * ficha, que pasa a una columna antes, en ml.
   */
  compactBelow?: "md" | "ml";
  /** La home: el centro y la segunda fila sólo se muestran en mobile; en desktop, sólo el logo. */
  mobileOnlyContent?: boolean;
};

const Header = (props: Props) => {
  return (
    <>
      <header
        className={styles.header}
        data-compact={props.compactBelow}
        data-mobile-only={props.mobileOnlyContent || undefined}
      >
        <HeaderOffset />
        {/* En una ruta dinámica el pathname es dato de request: no bloquea el resto del header. */}
        <Suspense fallback={null}>
          <NavigationTracker />
        </Suspense>
        <div className={styles.top}>
          <Link href="/" className={styles.logo}>
            <Logo width={40} height={40} />
            Montevideo
          </Link>
          <div className={styles.center}>{props.children}</div>
          <div className={styles.end} />
          {/* <UserButton /> */}
        </div>
        {props.bottom && <div className={styles.bottom}>{props.bottom}</div>}
      </header>
      {/* El header es fixed y no ocupa lugar: el espaciador reserva su alto para que el contenido arranque debajo. */}
      <div className={styles.spacer} aria-hidden="true" />
    </>
  );
};

export default Header;
