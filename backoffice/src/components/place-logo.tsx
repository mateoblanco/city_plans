import { ISSUE_LABELS, KIND_LABELS } from '@/lib/logo-labels'
import type { LogoIssue, LogoKind } from '@/types/places'

type PlaceLogoProps = {
  name: string
  url: string | null
  kind: LogoKind | null
  bgColor: string | null
  color: string | null
  /** Por qué no hay logo, o qué paso falló (review.logo.reason). */
  issue?: LogoIssue | null
}

function Swatch({ label, hex }: { label: string; hex: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" title={`${label}: ${hex ?? 'sin dato'}`}>
      <span
        aria-hidden="true"
        className="size-3 shrink-0 rounded-sm border border-black/15"
        style={hex ? { backgroundColor: hex } : undefined}
      />
      <span className="sr-only">{label}:</span>
      <span className="font-mono">{hex ?? '—'}</span>
    </span>
  )
}

/** Miniatura del logo en R2 con su clasificación y las muestras de fondo y color principal. */
export function PlaceLogo({ name, url, kind, bgColor, color, issue }: PlaceLogoProps) {
  if (!url) {
    return (
      <span className="flex flex-col text-muted-foreground">
        Sin logo
        {issue && <span className="text-xs">{ISSUE_LABELS[issue]}</span>}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-2.5">
      <img src={url} alt={`Logo de ${name}`} width={40} height={40} loading="lazy" className="size-10 shrink-0 rounded-md border object-cover" />
      <span className="flex flex-col gap-0.5 text-xs">
        <span className="font-medium">{kind ? KIND_LABELS[kind] : 'Sin clasificar'}</span>
        {issue && <span className="text-amber-700">{ISSUE_LABELS[issue]}</span>}
        <Swatch label="Fondo" hex={bgColor} />
        <Swatch label="Principal" hex={color} />
      </span>
    </span>
  )
}
