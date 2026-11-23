import { notFound } from "next/navigation";
import GuidesShell from "@/components/GuidesShell/GuidesShell";
import { GuideView } from "@/components/pages/GuidePage/GuidePage";
import { getGuidePreview } from "@/server/guides/page-data";
import { isPreviewKey, PREVIEW_PARAM } from "@/server/guides/preview";

type ContentProps = {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * La vista previa: vuelve a chequear la clave (el proxy ya lo hizo) y arma la guía con getGuidePreview, sin cache: un
 * borrador o un cambio recién guardado se ven en el momento. Sólo /montevideo/<slug>.
 */
const Content = async (props: ContentProps) => {
  const [{ path }, search] = await Promise.all([props.params, props.searchParams]);
  const key = search[PREVIEW_PARAM];
  if (!isPreviewKey(typeof key === "string" ? key : null)) notFound();
  if (path[0] !== "montevideo" || path.length !== 2) notFound();
  const data = await getGuidePreview(path[1]);
  if (!data) notFound();
  return <GuideView data={data} />;
};

type Props = ContentProps;

/** Una guía en cualquier estado, con el mismo diseño que la pública, para revisarla antes de publicar. */
const GuidePreviewPage = (props: Props) => (
  <GuidesShell>
    <Content params={props.params} searchParams={props.searchParams} />
  </GuidesShell>
);

export default GuidePreviewPage;
