import DiscountIcon from "@/assets/discount.svg";
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
    {props.icon && <DiscountIcon className={styles.icon} aria-hidden />}
    {props.name}
  </span>
);

export default BankChip;
