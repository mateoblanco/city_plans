import { Suspense } from "react";
import { notFound } from "next/navigation";
import Header from "@/components/Header/Header";
import HeaderBack from "@/components/Header/HeaderBack/HeaderBack";
import { getPlacePage } from "@/server/places/page-data";
import { montevideoNow } from "@/server/search/hours";
import { siteUrl } from "@/server/seo/indexing";
import PlaceContact from "./PlaceContact/PlaceContact";
import PlaceInfoCard from "./PlaceInfoCard/PlaceInfoCard";
import PlaceBranches from "./PlaceBranches/PlaceBranches";
import PlaceDiscounts from "./PlaceDiscounts/PlaceDiscounts";
import PlaceHeader from "./PlaceHeader/PlaceHeader";
import PlaceHours from "./PlaceHours/PlaceHours";
import PlaceLocation from "./PlaceLocation/PlaceLocation";
import PlaceMap from "./PlaceMap/PlaceMap";
import PlacePageSkeleton from "./PlacePageSkeleton/PlacePageSkeleton";
import PlaceSummary from "./PlaceSummary/PlaceSummary";
import SimilarPlaces from "./SimilarPlaces/SimilarPlaces";
import { placeChips } from "./utils/place-options";
import { jsonLdScript, placeJsonLd } from "./utils/structured-data";
import { googleMapsHref, instagramHandle, instagramPopularHref, mainCategory, placeOpenText, priceLabel, ratingText } from "./utils/summary";
import styles from "./PlacePage.module.scss";

type DetailsProps = {
  params: Promise<{ slug: string }>;
};

// Lee el slug y la base dentro del Suspense (con cacheComponents son datos de request). Lo de Google se pide en cada
// request y no se guarda: si falla, sus partes (horarios, dirección, puntaje, abierto) se ocultan y la ficha sale igual.
const Details = async (props: DetailsProps) => {
  const { slug } = await props.params;
  const data = await getPlacePage(slug);
  if (!data) notFound();
  const { place, google } = data;

  const now = montevideoNow();
  // Estado con los textos de la card: de los horarios de la base; sin confirmar, de Google; sin ninguno, no se muestra.
  const status = placeOpenText(place.hours, google?.openNow ?? null, now);

  // Datos estructurados sólo con datos propios (la fila y el logo de R2): nunca `google`.
  const jsonLd = placeJsonLd({ place, siteUrl: siteUrl(), logoUrl: data.logoUrl, neighborhood: data.neighborhood });

  return (
    <div className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <PlaceHeader placeId={place.id} name={place.name} logoUrl={data.logoUrl} logoBgColor={place.logo_bg_color} instagram={place.instagram} />

      <div className={styles.content}>
        <div className={styles.columns}>
          <div className={styles.main}>
            <PlaceSummary
              name={place.name}
              status={status}
              category={mainCategory(place.categories)}
              price={priceLabel(place.price)}
              rating={google?.rating ? ratingText(google.rating) : null}
              description={place.description_es}
              chips={placeChips(place)}
              instagram={place.instagram}
            />
            <PlaceDiscounts providers={data.discounts} />
            {/* En mobile van al final, después de horarios, mapa y dirección (PlacePage.module.scss). */}
            <div className={styles.more}>
              <PlaceBranches branches={data.branches} />
              <SimilarPlaces name={place.name} places={data.similar} />
            </div>
          </div>

          <aside className={styles.side}>
            <PlaceInfoCard>
              <PlaceContact
                bare
                instagramHandle={instagramHandle(place.instagram)}
                popularHref={instagramPopularHref(place.name)}
                website={google?.website ?? null}
                whatsappHref={google?.whatsappHref ?? null}
              />
              {google?.week && <PlaceHours bare week={google.week} today={now.day} />}
            </PlaceInfoCard>
            <PlaceMap name={place.name} lat={place.lat} lng={place.lng} iconCategory={place.icon_category} />
            <PlaceLocation
              address={google?.address ?? null}
              neighborhood={data.neighborhood}
              locatedIn={place.located_in}
              mapsHref={place.google_place_id ? googleMapsHref(place.name, place.google_place_id) : null}
            />
          </aside>
        </div>
      </div>
    </div>
  );
};

type Props = {
  params: Promise<{ slug: string }>;
};

/**
 * Ficha del lugar. Desktop: info y secciones a la izquierda; horarios, mapa y dirección fijos a la derecha. Mobile: una
 * sola columna (el mismo DOM, reordenado con CSS) y en el header sólo la flecha de volver.
 */
const PlacePage = (props: Props) => {
  return (
    <section>
      <Header compactBelow="ml">
        <HeaderBack below="ml" />
      </Header>
      <Suspense fallback={<PlacePageSkeleton />}>
        <Details params={props.params} />
      </Suspense>
    </section>
  );
};

export default PlacePage;
