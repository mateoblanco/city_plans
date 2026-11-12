import { Suspense } from "react";
import { notFound } from "next/navigation";
import Header from "@/components/Header/Header";
import HeaderBack from "@/components/Header/HeaderBack/HeaderBack";
import SkipLinks from "@/components/SkipLinks/SkipLinks";
import { SKIP_TARGETS } from "@/components/SkipLinks/utils/skip-targets";
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
import { googleMapsHref, instagramHandle, instagramPopularHref, mainCategory, placeOpenText, priceLabel, ratingText, transitLines } from "./utils/summary";
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
  // TODO: sacar. Server Component: sale en la terminal de `yarn dev`, no en el navegador.
  console.log("transit_lines", place.slug, JSON.stringify(place.transit_lines, null, 2));

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
            {/* Mapa, dirección y ómnibus, debajo del resumen. */}
            <div className={styles.location}>
              <PlaceMap name={place.name} lat={place.lat} lng={place.lng} iconCategory={place.icon_category} />
              <PlaceLocation
                address={google?.address ?? null}
                neighborhood={data.neighborhood}
                locatedIn={place.located_in}
                lines={transitLines(place.transit_lines)}
                mapsHref={place.google_place_id ? googleMapsHref(place.name, place.google_place_id) : null}
              />
            </div>
            <PlaceDiscounts providers={data.discounts} />
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
          </aside>

          {/* Sucursales y similares: en mobile, al final (después de contacto y horarios); en desktop,
              en la columna izquierda debajo de .main (grid-template-areas en PlacePage.module.scss). El DOM sigue el
              orden de mobile, así el Tab va en el orden en que se ve. */}
          <div className={styles.more}>
            <PlaceBranches branches={data.branches} />
            <SimilarPlaces name={place.name} places={data.similar} />
          </div>
        </div>
      </div>
    </div>
  );
};

type Props = {
  params: Promise<{ slug: string }>;
};

/**
 * Ficha del lugar. Desktop: info, mapa con dirección y secciones a la izquierda; contacto y horarios fijos a la
 * derecha. Mobile: una sola columna (el mismo DOM, reordenado con CSS) y en el header sólo la flecha de volver.
 */
const PlacePage = (props: Props) => {
  return (
    <>
      <SkipLinks links={[{ target: SKIP_TARGETS.content, label: "Ir al contenido" }]} />
      <Header compactBelow="ml">
        <HeaderBack below="ml" />
      </Header>
      <main id={SKIP_TARGETS.content} data-skip-target>
        <Suspense fallback={<PlacePageSkeleton />}>
          <Details params={props.params} />
        </Suspense>
      </main>
    </>
  );
};

export default PlacePage;
