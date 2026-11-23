import { getHomeGuides } from "@/server/guides/home-data";
import HomeGuidesList from "./HomeGuidesList/HomeGuidesList";

/**
 * La sección "Guías" al final de la home: igual para todos y cacheada (getHomeGuides, sobre la lista de guías ya
 * cacheada: sin consultas nuevas por pedido). No lee cookies. Si falla o no hay guías publicadas, no aparece.
 */
const HomeGuides = async () => {
  const guides = await getHomeGuides().catch((error) => {
    console.error("Falló la sección de guías de la home", error);
    return [];
  });
  return <HomeGuidesList guides={guides} />;
};

export default HomeGuides;
