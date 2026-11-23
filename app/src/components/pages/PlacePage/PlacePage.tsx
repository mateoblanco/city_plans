import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Header from "@/components/Header/Header";
import HeaderBack from "@/components/Header/HeaderBack/HeaderBack";
import SkipLinks from "@/components/SkipLinks/SkipLinks";
import { SKIP_TARGETS } from "@/components/SkipLinks/utils/skip-targets";
import { getPlacePage } from "@/server/places/page-data";
import { staticMapSources } from "@/server/places/static-map";
import { montevideoNow } from "@/server/search/hours";
import { SITE_URL } from "@/lib/site";
import { trackEvents } from "@/server/events/config";
import { isBot } from "@/server/events/bots";
import PlaceViewBeacon from "@/components/Tracking/PlaceViewBeacon/PlaceViewBeacon";
import PlaceBranches from "./PlaceBranches/PlaceBranches";
import PlaceDiscounts from "./PlaceDiscounts/PlaceDiscounts";
import PlaceGuides from "./PlaceGuides/PlaceGuides";
import PlaceGoogle from "./PlaceGoogle/PlaceGoogle";
import PlaceHeader from "./PlaceHeader/PlaceHeader";
import PlaceInfo from "./PlaceInfo/PlaceInfo";
import PlaceLocation from "./PlaceLocation/PlaceLocation";
import PlaceMap from "./PlaceMap/PlaceMap";
import StaticMap from "./PlaceMap/StaticMap/StaticMap";
import PlacePageSkeleton from "./PlacePageSkeleton/PlacePageSkeleton";
import PlaceSummary from "./PlaceSummary/PlaceSummary";
import SimilarPlaces from "./SimilarPlaces/SimilarPlaces";
import { placeChips } from "./utils/place-options";
import { jsonLdScript, placeJsonLd } from "./utils/structured-data";
import { mapLikelyAboveFold } from "./utils/static-map";
import { googleMapsHref, instagramHandle, instagramPopularHref, mainCategory, placeOpenText, priceText, transitLines } from "./utils/summary";
import styles from "./PlacePage.module.scss";

type DetailsProps = {
  params: Promise<{ slug: string }>;
};

// Lee el slug y la base dentro del Suspense (con cacheComponents son datos de request). El render del servidor sale sólo
// con datos propios (la fila, el logo de R2, Instagram, los descuentos): nunca llama a Google. Lo de Google (puntaje,
// estado si difiere, dirección, contacto y horarios) lo pide el navegador una vez, después de hidratar y con la ficha
// visible (PlaceGoogle → /api/place-google/[id]); hasta que llega, sus partes tienen el lugar reservado y, si no llega
// (bot, falla de Google), quedan ocultas sin aviso. Sucursales y parecidos llegan después, cada uno en su Suspense.
const Details = async (props: DetailsProps) => {
  const { slug } = await props.params;
  const data = await getPlacePage(slug);
  if (!data) notFound();
  const { place } = data;

  // Un bot (por user agent, isBot de los eventos): el mapa va como recuadro liso, sin Static Maps ni Maps JS, y no se
  // pide lo de Google (la ruta igual lo corta). Sin google_place_id tampoco hay nada que pedir. En los dos casos, las
  // partes de Google no se reservan.
  const bot = isBot((await headers()).get("user-agent"));
  const inGoogle = !!place.google_place_id && !bot;

  const now = montevideoNow();
  // Estado con los textos de la card, de los horarios de la base; si no los tiene confirmados, null (y, en Google, la
  // línea queda reservada para el abierto/cerrado que llega del navegador).
  const status = placeOpenText(place.hours, null, now);

  // Datos estructurados sólo con datos propios (la fila y el logo de R2): nunca nada de Google.
  // Popularidad (TRACK_EVENTS): apagado, ni el beacon ni el contador de "Google Maps" se renderizan.
  const tracking = trackEvents();
  const mapsHref = place.google_place_id ? googleMapsHref(place.name, place.google_place_id) : null;
  const chips = placeChips(place);
  const contact = { instagramHandle: instagramHandle(place.instagram), popularHref: instagramPopularHref(place.name) };

  const jsonLd = placeJsonLd({ place, siteUrl: SITE_URL, logoUrl: data.logoUrl, neighborhood: data.neighborhood });

  return (
    <PlaceGoogle key={place.id} placeId={place.id} enabled={inGoogle}>
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
                google={inGoogle ? { fallbackHref: mapsHref } : null}
                description={place.description_es}
                chips={chips}
                instagram={place.instagram}
              />
              {/* Mapa, dirección y ómnibus, debajo del resumen. */}
              <div className={styles.location}>
                <PlaceMap name={place.name} lat={place.lat} lng={place.lng} iconCategory={place.icon_category} plain={bot}>
                  {!bot && (
                    <StaticMap
                      name={place.name}
                      sources={staticMapSources({ lat: place.lat, lng: place.lng, iconCategory: place.icon_category })}
                      mapsHref={mapsHref}
                      trackPlaceId={tracking ? place.id : null}
                      priority={mapLikelyAboveFold({ name: place.name, description: place.description_es, chips })}
                    />
                  )}
                </PlaceMap>
                <PlaceLocation
                  inGoogle={inGoogle}
                  neighborhood={data.neighborhood}
                  locatedIn={place.located_in}
                  lines={transitLines(place.transit_lines)}
                  mapsHref={mapsHref}
                  trackPlaceId={tracking ? place.id : null}
                />
              </div>
              <PlaceDiscounts providers={data.discounts} />
              <PlaceGuides guides={data.guides} />
            </div>

            <aside className={styles.side}>
              <PlaceInfo {...contact} today={now.day} />
            </aside>

            {/* Sucursales y similares: en mobile, al final (después de contacto y horarios); en desktop,
                en la columna izquierda debajo de .main (grid-template-areas en PlacePage.module.scss). El DOM sigue el
                orden de mobile, así el Tab va en el orden en que se ve. Llegan después (la base) y van al final de
                la página: aparecer no mueve nada de arriba. */}
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
    </PlaceGoogle>
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
