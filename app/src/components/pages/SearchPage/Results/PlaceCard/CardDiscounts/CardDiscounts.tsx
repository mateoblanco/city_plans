import BankChip from "@/components/BankChip/BankChip";
import styles from "./CardDiscounts.module.scss";

type Props = {
  /** Proveedores con descuento, ya en orden (y, con el filtro, sólo los elegidos). */
  providers: { id: string; name: string }[];
};

/** El chip de cada banco con descuento (ícono y nombre, 12px); sin descuentos, nada. Sin porcentajes: el detalle está en la ficha. */
const CardDiscounts = (props: Props) => {
  if (props.providers.length === 0) return null;
  return (
    <ul className={styles.discounts} aria-label="Descuentos">
      {props.providers.map((provider) => (
        <li key={provider.id}>
          <BankChip id={provider.id} name={provider.name} size="sm" icon />
        </li>
      ))}
    </ul>
  );
};

export default CardDiscounts;
