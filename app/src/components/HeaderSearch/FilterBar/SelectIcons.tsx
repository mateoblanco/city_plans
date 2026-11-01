import styles from "./NeighborhoodSelect/NeighborhoodSelect.module.scss";

/** Íconos de los selects de la barra (barrios y precio). */
export const CaretUpDownIcon = () => (
  <svg className={styles.icon} width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M11 10H5l3 3.5zm0-4H5l3-3.5z" />
  </svg>
);

export const CheckIcon = () => (
  <svg className={styles.icon} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="m2.5 8.5 4 4 7-9" />
  </svg>
);

export const CaretUpIcon = () => (
  <svg className={styles.icon} width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M12 10H4l4-4.5z" />
  </svg>
);

export const CaretDownIcon = () => (
  <svg className={styles.icon} width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M12 6H4l4 4.5z" />
  </svg>
);
