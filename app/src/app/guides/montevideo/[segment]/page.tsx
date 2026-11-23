import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GuidesShell from "@/components/GuidesShell/GuidesShell";
import { GuideContent } from "@/components/pages/GuidePage/GuidePage";
import { NeighborhoodContent } from "@/components/pages/GuideNeighborhoodPage/GuideNeighborhoodPage";
import { liveGuides, resolveCitySegment, segmentParams } from "@/server/guides/catalog";
import { guideMetadata, neighborhoodMetadata } from "@/server/guides/metadata";
import { publishedGuides, publishedGuidesUncached } from "@/server/guides/published";

// /guides/montevideo/<segmento> es un barrio con página (con el mínimo de guías) o una guía, de barrio o de toda la
// ciudad (los dos se prerenderizan en el build; lo que se publica después se arma en el primer pedido y queda cacheado).
// La vieja /guides/montevideo/<barrio>/<slug> ya no existe: 404 (no hay ruta, y el proxy tampoco la conoce).
export async function generateStaticParams() {
  return segmentParams(await publishedGuides());
}

// Al publicar, el proxy ya dejó pasar la ruta con la lista fresca. Si la caché de datos todavía no la incorporó, se
// confirma una vez en la base para que metadata y contenido no respondan 404 en esa primera visita.
const resolve = async (segment: string) => {
  const cached = resolveCitySegment(segment, liveGuides(await publishedGuides()));
  return cached ?? resolveCitySegment(segment, liveGuides(await publishedGuidesUncached()));
};

export async function generateMetadata({ params }: PageProps<"/guides/montevideo/[segment]">): Promise<Metadata> {
  const { segment } = await params;
  const resolved = await resolve(segment);
  if (!resolved) notFound();
  if (resolved.kind === "guide") return guideMetadata(resolved.guide);
  const metadata = await neighborhoodMetadata(segment);
  if (!metadata) notFound();
  return metadata;
}

type ContentProps = {
  segment: Promise<string>;
};

/** Un barrio con página o una guía (resolveCitySegment); si no, 404. */
const SegmentContent = async (props: ContentProps) => {
  const segment = await props.segment;
  const resolved = await resolve(segment);
  if (!resolved) notFound();
  if (resolved.kind === "neighborhood") return <NeighborhoodContent barrio={Promise.resolve(segment)} />;
  return <GuideContent slug={Promise.resolve(segment)} />;
};

export default function CitySegment({ params }: PageProps<"/guides/montevideo/[segment]">) {
  return (
    <GuidesShell>
      <SegmentContent segment={params.then((value) => value.segment)} />
    </GuidesShell>
  );
}
