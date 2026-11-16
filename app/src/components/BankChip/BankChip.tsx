import styles from "./BankChip.module.scss";

type Props = {
  /** Id del proveedor: elige el color de marca (data-provider); sin color propio, fondo oscuro. */
  id: string;
  name: string;
  /** sm: texto de 12px (los descuentos de la card); sin size, 14px. */
  size?: "sm";
  /** Con el ícono de descuento (10×10) antes del nombre. */
  icon?: boolean;
};

/** El nombre de un banco en un chip con su color de marca y el texto blanco (ficha, filtro de Descuentos y card). */
const BankChip = (props: Props) => (
  <span className={styles.chip} data-provider={props.id} data-size={props.size}>
    {/* Máscara de CSS (public/icons/discount.svg) y no un <svg> inline: la card lo repite decenas de veces en el HTML. */}
    {props.icon && <span className={styles.icon} aria-hidden />}
    {props.name}
  </span>
);

export default BankChip;
