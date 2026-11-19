import { notFound } from "next/navigation";
import { breadcrumbJsonLd } from "@/components/GuideBreadcrumb/utils/structured-data";
import GuideRow from "@/components/GuideRow/GuideRow";
import GuidesShell from "@/components/GuidesShell/GuidesShell";
import { getNeighborhoodPage } from "@/server/guides/neighborhood-data";
import { siteUrl } from "@/server/seo/indexing";
import { jsonLdScript } from "../PlacePage/utils/structured-data";
import NeighborhoodHeader from "./NeighborhoodHeader/NeighborhoodHeader";
import { neighborhoodItemListJsonLd } from "./utils/structured-data";
import styles from "./GuideNeighborhoodPage.module.scss";

type ContentProps = {
  barrio: Promise<string>;
};

/**
 * El contenido de la página de un barrio (dentro del Suspense de GuidesShell). Como la guía: igual para todos y
 * cacheado (getNeighborhoodPage, 'use cache'), sin datos del pedido ni Google.
 */
export const NeighborhoodContent = async (props: ContentProps) => {
  const data = await getNeighborhoodPage(await props.barrio);
  if (!data) notFound();

  const base = siteUrl();
  const jsonLd = [
    neighborhoodItemListJsonLd({ name: data.name, path: data.path, siteUrl: base, groups: data.groups }),
    breadcrumbJsonLd(data.breadcrumb, base),
  ];

  return (
    <div className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <div className={styles.content}>
        <NeighborhoodHeader breadcrumb={data.breadcrumb} name={data.name} intro={data.intro} />
      </div>
      <div className={styles.rows}>
        {data.groups.map((row) => (
          <GuideRow key={row.group} id={row.group} title={row.title} guides={row.guides} />
        ))}
      </div>
    </div>
  );
};

type Props = {
  barrio: Promise<string>;
};

/**
 * Guías de un barrio: una fila por grupo (Comer, Tomar algo, Cafés, Postres) con las tarjetas de sus guías. Sin mapa.
 * Mobile: cada fila con scroll horizontal, como las de la home; desde md, las tarjetas en grilla.
 */
const GuideNeighborhoodPage = (props: Props) => (
  <GuidesShell>
    <NeighborhoodContent barrio={props.barrio} />
  </GuidesShell>
);

export default GuideNeighborhoodPage;
