import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GuidesShell from "@/components/GuidesShell/GuidesShell";
import { GuideContent } from "@/components/pages/GuidePage/GuidePage";
import { NeighborhoodContent } from "@/components/pages/GuideNeighborhoodPage/GuideNeighborhoodPage";
import { cityGuideParams, neighborhoodParams, resolveCitySegment } from "@/server/guides/catalog";
import { guideMetadata, neighborhoodMetadata } from "@/server/guides/metadata";

// /guides/montevideo/<segmento> es un barrio o una guía de toda la ciudad (los dos se prerenderizan en el build).
export async function generateStaticParams() {
  return [...neighborhoodParams(), ...cityGuideParams()];
}

export async function generateMetadata({ params }: PageProps<"/guides/montevideo/[segment]">): Promise<Metadata> {
  const { segment } = await params;
  const resolved = resolveCitySegment(segment);
  if (!resolved) notFound();
  if (resolved.kind === "guide") return guideMetadata(resolved.guide);
  const metadata = await neighborhoodMetadata(segment);
  if (!metadata) notFound();
  return metadata;
}

type ContentProps = {
  segment: Promise<string>;
};

/** Primero un barrio; si no, una guía de toda la ciudad (resolveCitySegment); si no, 404. */
const SegmentContent = async (props: ContentProps) => {
  const segment = await props.segment;
  const resolved = resolveCitySegment(segment);
  if (!resolved) notFound();
  if (resolved.kind === "neighborhood") return <NeighborhoodContent barrio={Promise.resolve(segment)} />;
  return <GuideContent guide={Promise.resolve({ barrio: null, slug: segment })} />;
};

export default function CitySegment({ params }: PageProps<"/guides/montevideo/[segment]">) {
  return (
    <GuidesShell>
      <SegmentContent segment={params.then((value) => value.segment)} />
    </GuidesShell>
  );
}
