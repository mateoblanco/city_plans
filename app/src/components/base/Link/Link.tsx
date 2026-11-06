import NextLink from "next/link";
import ArrowExternal from "@/assets/arrow_external.svg";
import styles from "./Link.module.scss";

type Props = {
  href: string;
  label: string;
  /** Otro sitio: un <a> común que abre en otra pestaña, con la flecha. Sin esto, un link de Next sin flecha. */
  external?: boolean;
};

/** Link de texto (sin forma de botón), p. ej. "Ver más info" hacia el sitio del banco. */
const Link = (props: Props) =>
  props.external ? (
    <a className={styles.link} href={props.href} target="_blank" rel="noopener noreferrer">
      {props.label}
      <ArrowExternal className={styles.icon} aria-hidden width={8} height={8} />
    </a>
  ) : (
    <NextLink className={styles.link} href={props.href}>
      {props.label}
    </NextLink>
  );

export default Link;
