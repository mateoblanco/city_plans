import GuideRow from "@/components/GuideRow/GuideRow";
import GuidesShell from "@/components/GuidesShell/GuidesShell";
import { getCityPage } from "@/server/guides/city-data";
import { siteUrl } from "@/server/seo/indexing";
import { jsonLdScript } from "../PlacePage/utils/structured-data";
import CityHeader from "./CityHeader/CityHeader";
import NeighborhoodGrid from "./NeighborhoodGrid/NeighborhoodGrid";
import { cityCollectionJsonLd } from "./utils/structured-data";
import styles from "./GuidesCityPage.module.scss";

/** Igual para todos y cacheado (getCityPage, 'use cache'): sin datos del pedido ni Google. */
const Content = async () => {
  const data = await getCityPage();
  const jsonLd = cityCollectionJsonLd({ title: data.title, description: data.seoDescription, path: data.path, siteUrl: siteUrl(), groups: data.groups });

  return (
    <div className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />
      <div className={styles.content}>
        <CityHeader title={data.title} intro={data.intro} />
      </div>
      <div className={styles.rows}>
        {data.groups.map((row) => (
          <GuideRow key={row.group} id={row.group} title={row.title} guides={row.guides} />
        ))}
      </div>
      {data.neighborhoods.length > 0 && (
        <div className={styles.content}>
          <NeighborhoodGrid neighborhoods={data.neighborhoods} />
        </div>
      )}
    </div>
  );
};

/**
 * Guías de Montevideo: el título y la intro (sin migas: es la raíz), una fila por grupo (Comer, Tomar algo, Cafés,
 * Postres) con las guías destacadas de barrio y de ciudad, y los barrios con guías.
 */
const GuidesCityPage = () => (
  <GuidesShell>
    <Content />
  </GuidesShell>
);

export default GuidesCityPage;
