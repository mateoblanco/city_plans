import Button from "@/components/base/Button/Button";
import ArrowExternal from "@/assets/arrow_external.svg";
import Instagram from "@/assets/instagram.svg";
import Whatsapp from "@/assets/whatsapp.svg";
import type { ExternalLink } from "@/lib/product-analytics/events";
import { trackAttrs } from "@/lib/product-analytics/track";
import styles from "./PlaceContact.module.scss";

type Props = {
  instagramHandle: string | null;
  popularHref: string | null;
  /** De Google (sin Instagram ni WhatsApp); null si no vino. */
  website: string | null;
  whatsappHref: string | null;
  /** Para la analítica de producto (external_link_clicked). */
  place: { id: string; slug: string };
  /** Sin tarjeta propia (va dentro de PlaceInfoCard). */
  bare?: boolean;
};

const external = <ArrowExternal aria-hidden width={8} height={8} />;

/** Prueba: Instagram, "Lo que publica la gente" y lo que Google tenga de contacto (web y WhatsApp; el teléfono fijo no). */
const PlaceContact = (props: Props) => {
  const hasAny = props.instagramHandle || props.popularHref || props.website || props.whatsappHref;
  if (!hasAny) return null;
  const analytics = (link: ExternalLink) => trackAttrs("external_link_clicked", { place_id: props.place.id, slug: props.place.slug, link });

  return (
    <section className={styles.card} data-bare={props.bare || undefined}>
      <h2 className={styles.title}>Contacto</h2>
      <div className={styles.links}>
        {props.instagramHandle && (
          <Button href={`https://www.instagram.com/${props.instagramHandle}/`} external label="Instagram" analytics={analytics("instagram")} icon={<Instagram aria-hidden />} variant="outline" size="sm" />
        )}
        {props.whatsappHref && <Button href={props.whatsappHref} external label="WhatsApp" analytics={analytics("whatsapp")}  icon={<Whatsapp aria-hidden />}  variant="outline" size="sm" />}
        {props.website && <Button href={props.website} external label="Website" analytics={analytics("web")} iconEnd={external} variant="outline" size="sm" />}
        {props.popularHref && (
          <Button href={props.popularHref} external label="Lo que publica la gente" iconEnd={external} variant="outline" size="sm" />
        )}
      </div>
    </section>
  );
};

export default PlaceContact;
