import Button from "@/components/base/Button/Button";
import ArrowExternal from "@/assets/arrow_external.svg";
import Instagram from "@/assets/instagram.svg";
import Whatsapp from "@/assets/whatsapp.svg";
import styles from "./PlaceContact.module.scss";

type Props = {
  instagramHandle: string | null;
  popularHref: string | null;
  /** De Google (sin Instagram ni WhatsApp); null si no vino. */
  website: string | null;
  whatsappHref: string | null;
  /** Sin tarjeta propia (va dentro de PlaceInfoCard). */
  bare?: boolean;
};

const external = <ArrowExternal aria-hidden width={8} height={8} />;

/** Prueba: Instagram, "Lo que publica la gente" y lo que Google tenga de contacto (web y WhatsApp; el teléfono fijo no). */
const PlaceContact = (props: Props) => {
  const hasAny = props.instagramHandle || props.popularHref || props.website || props.whatsappHref;
  if (!hasAny) return null;

  return (
    <section className={styles.card} data-bare={props.bare || undefined}>
      <h2 className={styles.title}>Contacto</h2>
      <div className={styles.links}>
        {props.instagramHandle && (
          <Button href={`https://www.instagram.com/${props.instagramHandle}/`} external label="Instagram" icon={<Instagram aria-hidden />} variant="tertiary" size="sm" />
        )}
        {props.whatsappHref && <Button href={props.whatsappHref} external label="WhatsApp"  icon={<Whatsapp aria-hidden />}  variant="tertiary" size="sm" />}
        {props.website && <Button href={props.website} external label="Website" iconEnd={external} variant="tertiary" size="sm" />}
        {props.popularHref && (
          <Button href={props.popularHref} external label="Lo que publica la gente" iconEnd={external} variant="tertiary" size="sm" />
        )}
      </div>
    </section>
  );
};

export default PlaceContact;
