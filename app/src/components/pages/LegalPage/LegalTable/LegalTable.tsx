import type { ReactNode } from "react";
import styles from "./LegalTable.module.scss";

type Props = {
  /** Lo que dice la tabla, para lectores de pantalla (caption visualmente igual al resto). */
  caption: string;
  head: string[];
  rows: ReactNode[][];
};

/** Tabla de las páginas legales (cookies, conservación): con scroll horizontal propio en pantallas chicas. */
const LegalTable = (props: Props) => (
  <div className={styles.wrap} role="region" aria-label={props.caption} tabIndex={0}>
    <table className={styles.table}>
      <thead>
        <tr>
          {props.head.map((cell) => (
            <th key={cell} scope="col">{cell}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default LegalTable;
