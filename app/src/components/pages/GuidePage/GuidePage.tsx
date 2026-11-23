import { notFound } from "next/navigation";
import { breadcrumbJsonLd } from "@/components/GuideBreadcrumb/utils/structured-data";
import GuidesShell from "@/components/GuidesShell/GuidesShell";
import { guidePath } from "@/server/guides/catalog";
import { getGuidePage, type GuidePageData } from "@/server/guides/page-data";
import { SITE_URL } from "@/lib/site";
import { jsonLdScript } from "../PlacePage/utils/structured-data";
import GuideHeader from "./GuideHeader/GuideHeader";
import GuidePlaces from "./GuidePlaces/GuidePlaces";
import GuideRow from "@/components/GuideRow/GuideRow";
import { guideItemListJsonLd } from "./utils/structured-data";
import styles from "./GuidePage.module.scss";

type ContentProps = {
  /** El slug de la guía (/guides/montevideo/<slug>), de barrio o de toda la ciudad. */
  slug: Promise<string>;
};

type ViewProps = {
  data: GuidePageData;
};

/**
 * La guía armada (lista, mapa, encabezado y JSON-LD). La usan la guía pública (GuideContent, cacheada) y la vista previa
 * (app/guide-preview, sin cache); el HTML es el mismo.
 */
export const GuideView = (props: ViewProps) => {
  const { guide } = props.data;
  const base = SITE_URL;
  const jsonLd = [
    guideItemListJsonLd({ title: guide.title, url: guidePath(guide), siteUrl: base, places: props.data.places }),
    breadcrumbJsonLd(props.data.breadcrumb, base),
  ];

  return (
    <div className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <GuidePlaces
        guideSlug={guide.slug}
        places={props.data.places}
        header={
          <GuideHeader
            breadcrumb={props.data.breadcrumb}
            neighborhood={props.data.neighborhoodLabel}
            title={guide.title}
            updatedAt={guide.updatedAt}
            intro={guide.intro}
          />
        }
      />
      {/* "Más guías": hasta 4 relacionadas, sin la actual (relatedGuides). Sin otras guías, nada. */}
      {props.data.related.length > 0 && (
        <div className={styles.more}>
          <GuideRow id="more-guides" title="Más guías" guides={props.data.related} />
        </div>
      )}
    </div>
  );
};

/**
 * El contenido de una guía (dentro del Suspense de GuidesShell). Igual para todos y cacheado (getGuidePage, 'use
 * cache'): sin headers(), cookies, hora ni ubicación en el servidor, y nada de Google. Lo que depende del momento
 * (abierto o cerrado) y del navegador (bot o no, el mapa) se decide en el cliente, así el HTML prerenderizado nunca
 * queda viejo. Lo usa /guides/montevideo/[segment] cuando el segmento es una guía.
 */
export const GuideContent = async (props: ContentProps) => {
  const data = await getGuidePage(await props.slug);
  if (!data) notFound();
  return <GuideView data={data} />;
};

type Props = {
  slug: Promise<string>;
};

/**
 * Una guía: una lista numerada de lugares elegidos a mano. Desktop: la lista a la izquierda y el mapa fijo a la
 * derecha, sincronizados. Mobile: una columna y el mapa a pantalla completa con "Ver mapa".
 */
const GuidePage = (props: Props) => (
  <GuidesShell>
    <GuideContent slug={props.slug} />
  </GuidesShell>
);

export default GuidePage;
