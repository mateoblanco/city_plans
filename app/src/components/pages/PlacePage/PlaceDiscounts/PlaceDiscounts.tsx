import type { PlaceDiscountProvider } from "@/server/discounts";
import PlaceSection from "../PlaceSection/PlaceSection";
import ProviderDiscounts from "./ProviderDiscounts/ProviderDiscounts";
import styles from "./PlaceDiscounts.module.scss";

type Props = {
  providers: PlaceDiscountProvider[];
};

/** "Descuentos": una card con un bloque por proveedor (separados), en el orden de la config. Sin descuentos, no se muestra. */
const PlaceDiscounts = (props: Props) => {
  if (props.providers.length === 0) return null;

  return (
    <PlaceSection title="Descuentos">
      <div className={styles.card}>
        {props.providers.map((provider) => (
          <div key={provider.id} className={styles.item}>
            <ProviderDiscounts id={provider.id} name={provider.name} benefits={provider.benefits} />
          </div>
        ))}
      </div>
    </PlaceSection>
  );
};

export default PlaceDiscounts;
