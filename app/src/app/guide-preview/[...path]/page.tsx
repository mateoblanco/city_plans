import type { Metadata } from "next";
import GuidePreviewPage from "@/components/pages/GuidePreviewPage/GuidePreviewPage";
import { withSiteName } from "@/lib/site";

// Ruta interna: sólo se llega reescrito por el proxy desde /guides/...?preview=<clave> (directo, el proxy da 404). Lee
// la guía en el momento, también un borrador, y nunca se indexa.
export const metadata: Metadata = {
  title: withSiteName("Vista previa de la guía"),
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function GuidePreview(props: Props) {
  return <GuidePreviewPage params={props.params} searchParams={props.searchParams} />;
}
