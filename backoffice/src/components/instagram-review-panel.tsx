import { ArrowUpRight, LoaderCircle, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ExtractionRow } from '@/hooks/use-extraction-batch'
import { initialDraft, instagramChoiceFor, reviewRank, type ReviewDraft } from '@/lib/instagram-review'
import type { InstagramDiscovery, PlaceSummary } from '@/types/places'

type InstagramReviewPanelProps = {
  rows: Record<string, ExtractionRow>
  drafts: Record<string, ReviewDraft>
  /** Lugares de la corrida: dan el nombre y la ficha de Google Maps de cada fila. */
  places: readonly Pick<PlaceSummary, 'placeId' | 'name' | 'googleMapsUri'>[]
  running: boolean
  invalidCount: number
  onDraftChange: (id: string, draft: ReviewDraft) => void
  onContinue: () => void
}

const CANDIDATE_REASONS: Record<string, string> = {
  identity_or_location_mismatch: 'no coincide con el lugar',
  not_returned_by_provider: 'Apify no trajo el perfil',
  shared_with_other_place: 'cuenta de otro lugar',
  personal_account: 'cuenta personal',
  multiple_valid_profiles: 'empate con otro perfil',
  instagram_provider_not_configured: 'Apify sin configurar',
}

/** Por qué es dudoso: "sólo por el nombre", "empate entre @a y @b", "rechazado: cuenta personal". */
function doubtLabel(discovery: InstagramDiscovery) {
  if (discovery.doubt === 'name_only') return 'sólo por el nombre, sin señales del local'
  if (discovery.doubt === 'tie') {
    const tied = discovery.candidates.filter((candidate) => candidate.reason === 'multiple_valid_profiles')
    return `empate entre ${tied.map((candidate) => `@${candidate.handle}`).join(' y ')}`
  }
  const candidate = discovery.candidates.find((item) => item.handle === discovery.handle)
  return `rechazado: ${candidate ? CANDIDATE_REASONS[candidate.reason] ?? candidate.reason : 'sin motivo'}`
}

const STATUS_DOT: Record<InstagramDiscovery['status'], { className: string; label: string }> = {
  approved: { className: 'bg-emerald-500', label: 'Aprobado por la validación' },
  doubtful: { className: 'bg-amber-400', label: 'Con dudas' },
  none: { className: 'border border-muted-foreground/40', label: 'Sin Instagram' },
}

/**
 * Revisión del Instagram entre el descubrimiento y la extracción: por lugar, el Instagram encontrado con su estado,
 * el input para pegar o corregir el handle y "No tiene Instagram". Arriba, los que necesitan revisión.
 */
export function InstagramReviewPanel({ rows, drafts, places, running, invalidCount, onDraftChange, onContinue }: InstagramReviewPanelProps) {
  const byId = new Map(places.map((place) => [place.placeId, place]))
  const discovering = Object.entries(rows).filter(([, row]) => row.status === 'discovering' || (row.status === 'queued' && row.phase === 'discover'))
  const reviewing = Object.entries(rows)
    .flatMap(([id, row]) => row.status === 'reviewing' && row.discovery ? [{ id, row, discovery: row.discovery }] : [])
    .sort((left, right) => reviewRank(left.discovery, left.row.instagramError) - reviewRank(right.discovery, right.row.instagramError))
  // Cargados a mano: un handle distinto del aprobado o "No tiene Instagram".
  const manualCount = reviewing.filter(({ id, discovery }) => {
    const choice = instagramChoiceFor(discovery, drafts[id] ?? initialDraft(discovery))
    return choice !== 'invalid' && choice.mode !== 'auto'
  }).length

  if (reviewing.length === 0 && discovering.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">No hay lugares para revisar.</p>
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table aria-label="Revisión de Instagram">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="px-4 sm:px-5">Lugar</TableHead>
              <TableHead className="px-4 sm:px-5">Instagram encontrado</TableHead>
              <TableHead className="px-4 sm:px-5">Instagram a usar</TableHead>
              <TableHead className="px-4 sm:px-5">Sin Instagram</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reviewing.map(({ id, row, discovery }) => {
              const place = byId.get(id)
              const name = place?.name ?? id
              const draft = drafts[id] ?? initialDraft(discovery)
              const invalid = instagramChoiceFor(discovery, draft) === 'invalid'
              const dot = STATUS_DOT[discovery.status]
              return (
                <TableRow key={id}>
                  <TableCell className="px-4 py-3 align-top sm:px-5">
                    <span className="block font-medium">{name}</span>
                    {place?.googleMapsUri && (
                      <a href={place.googleMapsUri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline">
                        Ver en Google Maps
                        <ArrowUpRight className="size-3" aria-hidden="true" />
                        <span className="sr-only">(abre Google Maps en una nueva pestaña)</span>
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3 align-top sm:px-5">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className={`size-2.5 shrink-0 rounded-full ${dot.className}`} role="img" aria-label={dot.label} title={dot.label} />
                      {discovery.handle ? (
                        <a href={`https://www.instagram.com/${discovery.handle}/`} target="_blank" rel="noreferrer" className="text-sm underline-offset-4 hover:underline">
                          @{discovery.handle}
                        </a>
                      ) : (
                        <span className="text-sm text-muted-foreground">Sin candidato</span>
                      )}
                      {discovery.status === 'doubtful' && discovery.handle && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={running || draft.none}
                          aria-label={`Usar @${discovery.handle} para ${name}`}
                          onClick={() => onDraftChange(id, { text: discovery.handle!, none: false })}
                        >
                          Usar este
                        </Button>
                      )}
                    </span>
                    {discovery.status === 'doubtful' && <span className="mt-1 block text-xs text-muted-foreground">{doubtLabel(discovery)}</span>}
                    {discovery.saved && <span className="mt-1 block text-xs text-muted-foreground">Cargado a mano en un procesamiento anterior</span>}
                  </TableCell>
                  <TableCell className="min-w-56 px-4 py-3 align-top sm:px-5">
                    <Input
                      value={draft.text}
                      placeholder="@handle o URL del perfil"
                      aria-label={`Instagram de ${name}`}
                      aria-invalid={invalid || Boolean(row.instagramError)}
                      disabled={running || draft.none}
                      onChange={(event) => onDraftChange(id, { ...draft, text: event.target.value })}
                    />
                    {invalid && <span className="mt-1 block text-xs text-destructive">No es un perfil de Instagram.</span>}
                    {row.instagramError && <span className="mt-1 block text-xs text-destructive">{row.instagramError}</span>}
                  </TableCell>
                  <TableCell className="px-4 py-3 align-top sm:px-5">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.none}
                        disabled={running}
                        onChange={(event) => onDraftChange(id, { ...draft, none: event.target.checked })}
                        className="size-4 accent-foreground"
                      />
                      No tiene Instagram
                    </label>
                  </TableCell>
                </TableRow>
              )
            })}
            {discovering.map(([id]) => (
              <TableRow key={id}>
                <TableCell className="px-4 py-3 sm:px-5">
                  <span className="block font-medium">{byId.get(id)?.name ?? id}</span>
                </TableCell>
                <TableCell colSpan={3} className="px-4 py-3 sm:px-5">
                  <span className="sr-only">Descubriendo…</span>
                  <Skeleton className="h-4 w-48" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3 sm:px-5">
        <p className="text-xs text-muted-foreground">
          {manualCount === 1 ? '1 Instagram cargado a mano' : `${manualCount} Instagram cargados a mano`} · se guardan y un reproceso no los pisa
        </p>
        <span className="flex flex-wrap items-center gap-3">
          <span className="font-sans text-xs font-normal tracking-normal whitespace-nowrap text-[#5e5e5e]" translate="no" aria-label="Google Maps">
            Google Maps
          </span>
          <Button type="button" size="sm" disabled={running || reviewing.length === 0 || invalidCount > 0} onClick={onContinue}>
            {running ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
            Continuar con la extracción ({reviewing.length})
          </Button>
        </span>
      </div>
    </>
  )
}
