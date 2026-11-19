import { notFound } from "next/navigation";
import { breadcrumbJsonLd } from "@/components/GuideBreadcrumb/utils/structured-data";
import GuidesShell from "@/components/GuidesShell/GuidesShell";
import { guidePath } from "@/server/guides/catalog";
import { getGuidePage } from "@/server/guides/page-data";
import { siteUrl } from "@/server/seo/indexing";
import { jsonLdScript } from "../PlacePage/utils/structured-data";
import GuideHeader from "./GuideHeader/GuideHeader";
import GuidePlaces from "./GuidePlaces/GuidePlaces";
import { guideItemListJsonLd } from "./utils/structured-data";
import styles from "./GuidePage.module.scss";

/** Qué guía: de barrio (barrio y slug) o de toda la ciudad (barrio null). */
export type GuideKey = { barrio: string | null; slug: string };

type ContentProps = {
  guide: Promise<GuideKey>;
};

/**
 * El contenido de una guía (dentro del Suspense de GuidesShell). Igual para todos y cacheado (getGuidePage, 'use
 * cache'): sin headers(), cookies, hora ni ubicación en el servidor, y nada de Google. Lo que depende del momento
 * (abierto o cerrado) y del navegador (bot o no, el mapa) se decide en el cliente, así el HTML prerenderizado nunca
 * queda viejo. Lo usan /guides/montevideo/[segment]/[slug] (de barrio) y /guides/montevideo/[segment] (de ciudad).
 */
export const GuideContent = async (props: ContentProps) => {
  const key = await props.guide;
  const data = await getGuidePage(key.barrio, key.slug);
  if (!data) notFound();
  const { guide } = data;

  const base = siteUrl();
  const jsonLd = [
    guideItemListJsonLd({ title: guide.title, url: guidePath(guide), siteUrl: base, places: data.places }),
    breadcrumbJsonLd(data.breadcrumb, base),
  ];

  return (
    <div className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <GuidePlaces
        guideSlug={guide.slug}
        places={data.places}
        header={
          <GuideHeader
            breadcrumb={data.breadcrumb}
            group={data.groupLabel}
            title={guide.title}
            updatedAt={guide.updatedAt}
            intro={guide.intro}
          />
        }
      />
    </div>
  );
};

type Props = {
  params: Promise<{ segment: string; slug: string }>;
};

/**
 * Guía de barrio: una lista numerada de lugares elegidos a mano. Desktop: la lista a la izquierda y el mapa fijo a la
 * derecha, sincronizados. Mobile: una columna y el mapa a pantalla completa con "Ver mapa".
 */
const GuidePage = (props: Props) => (
  <GuidesShell>
    <GuideContent guide={props.params.then((params) => ({ barrio: params.segment, slug: params.slug }))} />
  </GuidesShell>
);

export default GuidePage;
