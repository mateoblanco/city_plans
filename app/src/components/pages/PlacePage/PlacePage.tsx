import { Suspense } from "react";
import { notFound } from "next/navigation";
import Header from "@/components/Header/Header";
import HeaderBack from "@/components/Header/HeaderBack/HeaderBack";
import SkipLinks from "@/components/SkipLinks/SkipLinks";
import { SKIP_TARGETS } from "@/components/SkipLinks/utils/skip-targets";
import { getPlacePage } from "@/server/places/page-data";
import type { PlaceGoogleInfo } from "@/server/places/google";
import { staticMapSources } from "@/server/places/static-map";
import { montevideoNow } from "@/server/search/hours";
import { siteUrl } from "@/server/seo/indexing";
import { trackEvents } from "@/server/events/config";
import PlaceViewBeacon from "@/components/Tracking/PlaceViewBeacon/PlaceViewBeacon";
import PlaceContact from "./PlaceContact/PlaceContact";
import PlaceInfoCard from "./PlaceInfoCard/PlaceInfoCard";
import PlaceBranches from "./PlaceBranches/PlaceBranches";
import PlaceDiscounts from "./PlaceDiscounts/PlaceDiscounts";
import PlaceHeader from "./PlaceHeader/PlaceHeader";
import PlaceHours from "./PlaceHours/PlaceHours";
import PlaceLocation from "./PlaceLocation/PlaceLocation";
import PlaceMap from "./PlaceMap/PlaceMap";
import StaticMap from "./PlaceMap/StaticMap/StaticMap";
import PlacePageSkeleton from "./PlacePageSkeleton/PlacePageSkeleton";
import PlaceSummary from "./PlaceSummary/PlaceSummary";
import SimilarPlaces from "./SimilarPlaces/SimilarPlaces";
import { placeChips } from "./utils/place-options";
import { jsonLdScript, placeJsonLd } from "./utils/structured-data";
import { mapLikelyAboveFold } from "./utils/static-map";
import { baseHoursKnown, googleMapsHref, instagramHandle, instagramPopularHref, mainCategory, placeOpenText, priceText, ratingInfo, transitLines } from "./utils/summary";
import styles from "./PlacePage.module.scss";

/** Una semana de mentira para reservar el alto de los horarios mientras llega Google (invisible). */
const RESERVED_WEEK = [1, 2, 3, 4, 5, 6, 0].map((day) => ({ day, ranges: ["12:00 – 00:00"], allDay: false }));

type ContactBase = { instagramHandle: string | null; popularHref: string | null };

type InfoCardProps = ContactBase & {
  google: PlaceGoogleInfo | null;
  today: number;
};

/** Contacto (lo de la base y la web y el WhatsApp de Google) y los horarios de Google, en una tarjeta. */
const InfoCard = (props: InfoCardProps) => (
  <PlaceInfoCard>
    <PlaceContact
      bare
      instagramHandle={props.instagramHandle}
      popularHref={props.popularHref}
      website={props.google?.website ?? null}
      whatsappHref={props.google?.whatsappHref ?? null}
    />
    {props.google?.week && <PlaceHours bare week={props.google.week} today={props.today} />}
  </PlaceInfoCard>
);

type GoogleInfoCardProps = ContactBase & {
  google: Promise<PlaceGoogleInfo | null>;
  today: number;
};

const GoogleInfoCard = async (props: GoogleInfoCardProps) => <InfoCard {...props} google={await props.google} />;

/**
 * Mientras llega Google: lo de contacto de la base y el lugar de los horarios ya reservado (invisible, sin foco), con el
 * alto del caso común (la semana con un turno por día). Así, cuando llegan, lo de abajo casi no se mueve.
 */
const InfoCardReserve = (props: ContactBase & { today: number }) => (
  <PlaceInfoCard>
    <PlaceContact bare instagramHandle={props.instagramHandle} popularHref={props.popularHref} website={null} whatsappHref={null} />
    <div className={styles.reserve} data-bare aria-hidden inert>
      <PlaceHours bare week={RESERVED_WEEK} today={props.today} />
    </div>
  </PlaceInfoCard>
);

type DetailsProps = {
  params: Promise<{ slug: string }>;
};

// Lee el slug y la base dentro del Suspense (con cacheComponents son datos de request). Lo de la base (header, logo,
// resumen, mapa, descuentos) sale apenas llega la fila; lo de Google (estado si la base no lo sabe, puntaje, dirección,
// contacto y horarios) y los parecidos llegan después, cada uno en su Suspense con el lugar reservado. Lo de Google se
// pide en cada request (una vez) y no se guarda: si falla, sus partes se ocultan y la ficha sale igual.
const Details = async (props: DetailsProps) => {
  const { slug } = await props.params;
  const data = await getPlacePage(slug);
  if (!data) notFound();
  const { place } = data;
  // Sin google_place_id no hay nada que esperar de Google: sus partes no se reservan.
  const inGoogle = !!place.google_place_id;

  const now = montevideoNow();
  // Estado con los textos de la card: de los horarios de la base, sin esperar a Google; sin confirmar, del abierto de
  // Google (la línea queda reservada); sin ninguno, no se muestra.
  const status = baseHoursKnown(place.hours, now) || !inGoogle
    ? placeOpenText(place.hours, null, now)
    : data.google.then((google) => placeOpenText(place.hours, google?.openNow ?? null, now));
  const address = inGoogle ? data.google.then((google) => google?.address ?? null) : null;

  // Datos estructurados sólo con datos propios (la fila y el logo de R2): nunca `google`.
  // Popularidad (TRACK_EVENTS): apagado, ni el beacon ni el contador de "Google Maps" se renderizan.
  const tracking = trackEvents();
  const mapsHref = place.google_place_id ? googleMapsHref(place.name, place.google_place_id) : null;
  const rating = inGoogle ? data.google.then((google) => ratingInfo(google, mapsHref)) : null;
  const chips = placeChips(place);
  const contact = { instagramHandle: instagramHandle(place.instagram), popularHref: instagramPopularHref(place.name) };

  const jsonLd = placeJsonLd({ place, siteUrl: siteUrl(), logoUrl: data.logoUrl, neighborhood: data.neighborhood });

  return (
    <div className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      {tracking && <PlaceViewBeacon placeId={place.id} slug={place.slug} />}
      <PlaceHeader placeId={place.id} name={place.name} logoUrl={data.logoUrl} logoBgColor={place.logo_bg_color} instagram={place.instagram} />

      <div className={styles.content}>
        <div className={styles.columns}>
          <div className={styles.main}>
            <PlaceSummary
              name={place.name}
              status={status}
              category={mainCategory(place.categories)}
              price={priceText(place.price)}
              rating={rating}
              description={place.description_es}
              chips={chips}
              instagram={place.instagram}
            />
            {/* Mapa, dirección y ómnibus, debajo del resumen. */}
            <div className={styles.location}>
              <PlaceMap name={place.name} lat={place.lat} lng={place.lng} iconCategory={place.icon_category}>
                <StaticMap
                  name={place.name}
                  sources={staticMapSources({ lat: place.lat, lng: place.lng, iconCategory: place.icon_category })}
                  mapsHref={mapsHref}
                  trackPlaceId={tracking ? place.id : null}
                  priority={mapLikelyAboveFold({ name: place.name, description: place.description_es, chips })}
                />
              </PlaceMap>
              <PlaceLocation
                address={address}
                neighborhood={data.neighborhood}
                locatedIn={place.located_in}
                lines={transitLines(place.transit_lines)}
                mapsHref={mapsHref}
                trackPlaceId={tracking ? place.id : null}
              />
            </div>
            <PlaceDiscounts providers={data.discounts} />
          </div>

          <aside className={styles.side}>
            {inGoogle ? (
              <Suspense fallback={<InfoCardReserve {...contact} today={now.day} />}>
                <GoogleInfoCard {...contact} google={data.google} today={now.day} />
              </Suspense>
            ) : (
              <InfoCard {...contact} google={null} today={now.day} />
            )}
          </aside>

          {/* Sucursales y similares: en mobile, al final (después de contacto y horarios); en desktop,
              en la columna izquierda debajo de .main (grid-template-areas en PlacePage.module.scss). El DOM sigue el
              orden de mobile, así el Tab va en el orden en que se ve. Llegan después (Google y la consulta de
              parecidos) y van al final de la página: aparecer no mueve nada de arriba. */}
          <div className={styles.more}>
            <Suspense fallback={null}>
              <PlaceBranches branches={data.branches} />
            </Suspense>
            <Suspense fallback={null}>
              <SimilarPlaces name={place.name} places={data.similar} />
            </Suspense>
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
