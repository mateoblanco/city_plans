import type { ReactNode } from 'react';
import Link from 'next/link';
import HeaderOffset from './HeaderOffset';
import styles from './Header.module.scss';

type Props = {
  /** Centro de la primera fila (en /search, el input). */
  children?: ReactNode;
  /** Segunda fila, centrada (en /search, la barra de filtros). */
  bottom?: ReactNode;
};

const Header = (props: Props) => {
  return (
    <>
      <header className={styles.header}>
        <HeaderOffset />
        <div className={styles.top}>
          <Link href="/" className={styles.logo}>SALIMOS</Link>
          <div className={styles.center}>{props.children}</div>
          <div/>
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
