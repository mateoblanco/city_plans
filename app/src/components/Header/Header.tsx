import { Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import CitySelect from './CitySelect/CitySelect';
import HeaderOffset from './HeaderOffset';
import NavigationTracker from './NavigationTracker';
import SearchExpand from '@/components/HeaderSearch/SearchExpand/SearchExpand';
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
  /** La home: la segunda fila se pliega al scrollear (la anima HeaderSearch/FilterReveal). */
  collapsibleBottom?: boolean;
  /**
   * La ficha y las guías: sólo se ve el centro (el input); las pestañas y la segunda fila están plegadas y se abren al
   * enfocarlo, encima de la página (la anima HeaderSearch/SearchExpand). El espaciador mide el header cerrado.
   */
  expandable?: boolean;
};

/** Plegable (prop expandable): la grilla se pliega (0fr) y el de adentro recorta lo que no entra. */
const Fold = (props: { children: ReactNode; className?: string; part: "tabs" | "bottom" }) => (
  <div className={props.className ? `${styles.fold} ${props.className}` : styles.fold} data-header-fold={props.part}>
    <div className={styles.foldClip}>
      <div className={styles.foldContent}>{props.children}</div>
    </div>
  </div>
);

const Header = (props: Props) => {
  return (
    <>
      <header
        className={styles.header}
        data-compact={props.compactBelow}
        data-sticky={props.sticky || undefined}
        data-expandable={props.expandable || undefined}
      >
        <HeaderOffset />
        {props.expandable && <SearchExpand />}
        {/* En una ruta dinámica el pathname es dato de request: no bloquea el resto del header. */}
        <Suspense fallback={null}>
          <NavigationTracker />
        </Suspense>
        <div className={styles.top} data-header-top data-with-tabs={props.tabs ? true : undefined}>
          <div className={styles.logo}>
            <Link href="/" className={styles.home} aria-label="Inicio">
              <Logo width={40} height={40} aria-hidden />
            </Link>
            <CitySelect />
          </div>
          <div className={styles.center} data-with-tabs={props.tabs ? true : undefined}>
            {props.expandable && props.tabs ? <Fold part="tabs">{props.tabs}</Fold> : props.tabs}
            {props.children}
          </div>
          <div className={styles.end} />
          {/* <UserButton /> */}
        </div>
        {props.bottom &&
          (props.expandable ? (
            <Fold part="bottom" className={styles.bottom}>
              {props.bottom}
            </Fold>
          ) : (
            <div className={styles.bottom} data-collapsible={props.collapsibleBottom || undefined}>
              {props.bottom}
            </div>
          ))}
      </header>
      {/* El header es fixed y no ocupa lugar: el espaciador reserva su alto para que el contenido arranque debajo. */}
      {!props.sticky && <div className={styles.spacer} aria-hidden="true" />}
    </>
  );
};

export default Header;
