import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Map as MapIcon,
  Play,
  RotateCcw,
  Search,
  Square,
  TriangleAlert,
} from 'lucide-react'
import { SearchCombobox, type ComboboxOption } from '@/components/search-combobox'
import { PlaceExplorerDialog } from '@/components/place-explorer-dialog'
import { ExtractionResultDialog } from '@/components/extraction-result-dialog'
import { ProcessedPlacesPanel } from '@/components/processed-places-panel'
import { PlacesTable, type PlacesTableColumn } from '@/components/places-table'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { NEIGHBORHOOD_NAMES, neighborhoodDisplayName } from '@/data/neighborhood-names'
import { CATEGORIES, type CategoryId } from '@/data/tags'
import { CLOSED_REASONS, REVIEW_REASONS, isClosedReason, type ReviewReason } from '@/data/review-reasons'
import { existingPlaceIds, sweepNeighborhood, type ExtractRequest } from '@/lib/places-api'
import { APIFY_FAILURE_LIMIT, EXA_FAILURE_LIMIT, EXTRACT_CONCURRENCY } from '@/lib/extraction-config'
import { LOGO_GROUPS, type LogoSummary } from '@/lib/logo-summary'
import { closedSummary, type ClosedSummary, type ReviewSummary } from '@/lib/review-summary'
import {
  useExtractionBatch,
  type ExtractionBatchMetrics,
  type ExtractionRow,
  type ExtractionStep,
} from '@/hooks/use-extraction-batch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type {
  NeighborhoodSweepMode,
  NeighborhoodSweepPlace,
  NeighborhoodSweepSummary,
  PlaceGroup,
  SweepCallCounts,
} from '@/types/places'

type SweepStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'partial'

type ExistingStatus = 'idle' | 'loading' | 'ready' | 'error'

function withoutIds(selected: ReadonlySet<string>, ids: ReadonlySet<string>): ReadonlySet<string> {
  if (![...selected].some((id) => ids.has(id))) return selected
  return new Set([...selected].filter((id) => !ids.has(id)))
}

function existingLabel(status: ExistingStatus, count: number, hidden: boolean) {
  if (status === 'loading') return 'Consultando la base…'
  if (status === 'error') return 'No se pudo consultar la base'
  if (status !== 'ready') return null
  if (count === 0) return 'Ninguno está en la base'
  if (!hidden) return count === 1 ? '1 ya está en la base' : `${count} ya están en la base`
  return count === 1 ? '1 oculto porque ya está en la base' : `${count} ocultos porque ya están en la base`
}

type SweepProgress = {
  apiCalls: SweepCallCounts
  discardedOutside: number
  currentQuery: string
}

const neighborhoodOptions: readonly ComboboxOption[] = Object.entries(NEIGHBORHOOD_NAMES)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, 'es'))

function categoryLabel(id: string) {
  return CATEGORIES[id as CategoryId]?.label.es ?? id
}

function formatFoundBy(key: string) {
  const [prefix, ...rest] = key.split(':')
  const query = rest.join(':')
  return prefix === 'rescate' ? `Rescate · ${query}` : `${categoryLabel(prefix)} · ${query}`
}

const columns: readonly PlacesTableColumn<NeighborhoodSweepPlace>[] = [
  {
    header: 'Categorías',
    cell: (place) => place.seedCategories.map(categoryLabel).join(', '),
  },
  {
    header: 'Encontrado por',
    cell: (place) => (
      <span className="text-xs leading-5">{place.foundBy.map(formatFoundBy).join(' · ')}</span>
    ),
  },
]

const GROUPS: readonly { id: PlaceGroup; label: string }[] = [
  { id: 'accepted', label: 'Aceptados' },
  { id: 'review', label: 'A revisar' },
  { id: 'rejected', label: 'Rechazados' },
]

const reasonColumn: PlacesTableColumn<NeighborhoodSweepPlace> = {
  header: 'Motivo',
  cell: (place) => <span className="font-mono text-xs">{place.reason ?? '—'}</span>,
}

/** Motivo con el cerrado según Google en español y el botón para moverlo a mano a procesar (o volver a bloquearlo). */
function reasonColumnWithRelease(released: ReadonlySet<string>, onToggle: (place: NeighborhoodSweepPlace) => void): PlacesTableColumn<NeighborhoodSweepPlace> {
  return {
    header: 'Motivo',
    cell: (place) => {
      if (!isClosedReason(place.reason)) return reasonColumn.cell(place)
      const isReleased = released.has(place.placeId)
      return (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-amber-700">{CLOSED_REASONS[place.reason]}</span>
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onToggle(place)} aria-label={`${isReleased ? 'Volver a bloquear' : 'Permitir procesar'} ${place.name}`}>
            {isReleased ? 'Volver a bloquear' : 'Permitir procesar'}
          </Button>
        </span>
      )
    },
  }
}

const locationColumn: PlacesTableColumn<NeighborhoodSweepPlace> = {
  header: 'Ubicación',
  cell: (place) =>
    place.insideNeighborhood === false ? (
      <span className="font-medium text-amber-700">Fuera del barrio</span>
    ) : (
      'Dentro'
    ),
}

const isInside = (place: NeighborhoodSweepPlace) => place.insideNeighborhood !== false

function formatSeconds(ms: number) {
  return `${(ms / 1000).toLocaleString('es-UY', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`
}

function processingStatus(row: ExtractionRow | undefined, onOpen: () => void) {
  if (!row) return <span className="text-muted-foreground">—</span>
  if (row.status === 'queued') return 'En cola'
  if (row.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        Procesando…
      </span>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {row.status === 'done' ? (
        <span className="text-emerald-700">Listo · {formatSeconds(row.durationMs ?? 0)}</span>
      ) : (
        <span className="text-destructive">Error: {row.error}</span>
      )}
      <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onOpen}>
        Ver resultado
      </Button>
    </span>
  )
}

const STEP_LABELS: Record<ExtractionStep, string> = {
  google: 'Google',
  exa: 'Exa',
  scraping: 'Sitio web',
  instagram: 'Instagram',
  llm: 'LLM',
  transit: 'Buses',
  logo: 'Logo',
}

function incompleteRunMessage(summary: NeighborhoodSweepSummary) {
  const count = summary.failedCallCount
  return count > 0 ? `Corrida incompleta: ${count} ${count === 1 ? 'llamada fallida' : 'llamadas fallidas'}` : null
}

function partialReasons(summary: NeighborhoodSweepSummary) {
  const reasons: string[] = []
  const incomplete = incompleteRunMessage(summary)
  if (incomplete) reasons.push(`${incomplete}.`)
  if (summary.truncated) {
    reasons.push(`Se alcanzó el tope de ${summary.maxCalls} llamadas; puede haber lugares sin relevar.`)
  }
  return reasons.join(' ')
}

const totalCalls = (calls: SweepCallCounts) => calls.sweep + calls.rescue

export function NeighborhoodSweepPage() {
  const [neighborhoodId, setNeighborhoodId] = useState('')
  const [mode, setMode] = useState<NeighborhoodSweepMode>('full')
  const [activeMode, setActiveMode] = useState<NeighborhoodSweepMode>('full')
  const [activeNeighborhood, setActiveNeighborhood] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [places, setPlaces] = useState<NeighborhoodSweepPlace[]>([])
  const [status, setStatus] = useState<SweepStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [progress, setProgress] = useState<SweepProgress | null>(null)
  const [summary, setSummary] = useState<NeighborhoodSweepSummary | null>(null)
  const [selectedPlace, setSelectedPlace] = useState<NeighborhoodSweepPlace | null>(null)
  const [onlyInside, setOnlyInside] = useState(true)
  const [group, setGroup] = useState<PlaceGroup>('accepted')
  // Tab "Procesados": resultados del lote para guardar en la base.
  const [showProcessed, setShowProcessed] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  // Cerrados según Google que se movieron a mano para poder procesarlos.
  const [releasedIds, setReleasedIds] = useState<ReadonlySet<string>>(new Set())
  const [resultPlace, setResultPlace] = useState<NeighborhoodSweepPlace | null>(null)
  // googlePlaceId del barrido que ya están en places; se consultan una vez, al terminar el barrido.
  const [existingIds, setExistingIds] = useState<ReadonlySet<string>>(new Set())
  const [existingStatus, setExistingStatus] = useState<ExistingStatus>('idle')
  const [hideExisting, setHideExisting] = useState(true)
  const hideExistingRef = useRef(true)
  const batch = useExtractionBatch()
  const abortController = useRef<AbortController | null>(null)
  const existsController = useRef<AbortController | null>(null)
  const cancelledByUser = useRef(false)

  useEffect(() => () => {
    abortController.current?.abort()
    existsController.current?.abort()
  }, [])

  async function loadExisting(ids: string[]) {
    existsController.current?.abort()
    const controller = new AbortController()
    existsController.current = controller
    setExistingStatus('loading')
    try {
      const found = await existingPlaceIds(ids, controller.signal)
      if (controller.signal.aborted) return
      setExistingIds(found)
      setExistingStatus('ready')
      // Lo que se seleccionó durante el barrido y resultó estar guardado deja de estar seleccionado.
      if (hideExistingRef.current) setSelectedIds((current) => withoutIds(current, found))
    } catch {
      if (!controller.signal.aborted) setExistingStatus('error')
    }
  }

  function toggleHideExisting(hide: boolean) {
    hideExistingRef.current = hide
    setHideExisting(hide)
    if (hide) setSelectedIds((current) => withoutIds(current, existingIds))
  }

  async function runSweep(target: string, sweepMode: NeighborhoodSweepMode) {
    abortController.current?.abort()
    const controller = new AbortController()
    abortController.current = controller
    cancelledByUser.current = false

    const byId = new Map<string, NeighborhoodSweepPlace>()
    let finalSummary: NeighborhoodSweepSummary | null = null
    let streamError: string | null = null

    setActiveNeighborhood(target)
    setActiveMode(sweepMode)
    setGroup('accepted')
    setShowProcessed(false)
    setSelectedIds(new Set())
    setReleasedIds(new Set())
    setResultPlace(null)
    existsController.current?.abort()
    setExistingIds(new Set())
    setExistingStatus('idle')
    batch.reset()
    setPlaces([])
    setSummary(null)
    setProgress(null)
    setErrorMessage('')
    setStatus('loading')

    try {
      await sweepNeighborhood(target, sweepMode, (event) => {
        if (event.type === 'places') {
          for (const place of event.items) byId.set(place.placeId, place)
          setPlaces([...byId.values()])
        } else if (event.type === 'progress') {
          setProgress({ apiCalls: event.apiCalls, discardedOutside: event.discardedOutside, currentQuery: event.currentQuery })
        } else if (event.type === 'done') {
          finalSummary = event.summary
        } else if (event.type === 'error') {
          streamError = event.error.message
        }
      }, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) {
        streamError = error instanceof Error ? error.message : 'No se pudo recorrer el barrio.'
      }
    }

    if (abortController.current !== controller) return
    abortController.current = null
    // También con un barrido cancelado o incompleto: lo encontrado se puede procesar igual.
    if (byId.size > 0) void loadExisting([...byId.keys()])

    const resultCount = [...byId.values()].filter(isInside).length
    if (cancelledByUser.current) {
      setErrorMessage('Cancelaste el recorrido; los resultados pueden estar incompletos.')
      setStatus(resultCount > 0 ? 'partial' : 'idle')
      return
    }
    if (controller.signal.aborted) return

    if (streamError || !finalSummary) {
      setErrorMessage(streamError ?? 'El recorrido terminó sin un resumen.')
      setStatus(resultCount > 0 ? 'partial' : 'error')
      return
    }

    const done: NeighborhoodSweepSummary = finalSummary
    setSummary(done)
    const reasons = partialReasons(done)
    if (reasons) {
      setErrorMessage(reasons)
      setStatus(resultCount > 0 ? 'partial' : 'error')
      return
    }
    setStatus(resultCount > 0 ? 'success' : 'empty')
  }

  function confirmSweep() {
    setConfirmOpen(false)
    if (neighborhoodId) void runSweep(neighborhoodId, mode)
  }

  function cancelSweep() {
    cancelledByUser.current = true
    abortController.current?.abort()
  }

  const isLoading = status === 'loading'
  const hasResults = places.length > 0
  const insidePlaces = places.filter(isInside)
  const canFilter = activeMode === 'full'
  const showOnlyInside = canFilter && onlyInside
  // Los ya guardados se sacan antes de los filtros de ubicación y grupo: no cuentan ni se pueden seleccionar.
  const shownPlaces = hideExisting ? places.filter((place) => !existingIds.has(place.placeId)) : places
  const locationVisible = showOnlyInside ? shownPlaces.filter(isInside) : shownPlaces
  const existingInView = (showOnlyInside ? insidePlaces : places).filter((place) => existingIds.has(place.placeId)).length
  const existingText = existingLabel(existingStatus, existingInView, hideExisting)
  const groupCounts = { accepted: 0, review: 0, rejected: 0 }
  for (const place of locationVisible) if (place.group) groupCounts[place.group] += 1
  const visiblePlaces = canFilter ? locationVisible.filter((place) => place.group === group) : shownPlaces
  const tableColumns = [
    ...columns,
    ...(canFilter && group !== 'accepted' ? [group === 'review' ? reasonColumnWithRelease(releasedIds, toggleReleased) : reasonColumn] : []),
    ...(canFilter && !onlyInside ? [locationColumn] : []),
  ]
  const selectable = canFilter && group !== 'rejected'
  const hasBatch = Object.keys(batch.rows).length > 0
  const processedCount = Object.values(batch.rows).filter((row) => row.status === 'done' || row.status === 'error').length
  const processedTabOpen = showProcessed && canFilter && processedCount > 0
  if (hasBatch) {
    tableColumns.push({ header: 'Procesamiento', cell: (place) => processingStatus(batch.rows[place.placeId], () => setResultPlace(place)) })
  }
  // Un cerrado según Google no se puede seleccionar hasta moverlo a mano.
  const blocked = (place: NeighborhoodSweepPlace) => isClosedReason(place.reason) && !releasedIds.has(place.placeId)
  const selectableVisible = visiblePlaces.filter((place) => !blocked(place))
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((place) => selectedIds.has(place.placeId))

  function toggleReleased(place: NeighborhoodSweepPlace) {
    const release = !releasedIds.has(place.placeId)
    setReleasedIds((current) => {
      const next = new Set(current)
      if (release) next.add(place.placeId)
      else next.delete(place.placeId)
      return next
    })
    if (!release) setSelectedIds((current) => withoutIds(current, new Set([place.placeId])))
  }

  function toggleSelected(place: NeighborhoodSweepPlace) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(place.placeId)) next.delete(place.placeId)
      else next.add(place.placeId)
      return next
    })
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const place of selectableVisible) {
        if (allVisibleSelected) next.delete(place.placeId)
        else next.add(place.placeId)
      }
      return next
    })
  }

  // Sólo aceptados y a revisar van al pipeline; los cerrados, sólo si se movieron a mano.
  const selectedRequests: ExtractRequest[] = shownPlaces
    .filter((place) => selectedIds.has(place.placeId) && place.group !== 'rejected' && place.group !== null && !blocked(place))
    .map((place) => ({
      googlePlaceId: place.placeId,
      seedCategories: place.seedCategories,
      ...(place.insideNeighborhood === true ? { neighborhoodId: activeNeighborhood } : {}),
    }))

  const activeLabel = neighborhoodDisplayName(activeNeighborhood) ?? ''
  const selectedLabel = neighborhoodDisplayName(neighborhoodId) ?? ''

  return (
    <>
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <section aria-labelledby="sweep-title">
          <div className="mb-7 max-w-2xl">
            <h2 id="sweep-title" className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              Todos los lugares de un barrio
            </h2>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              Elegí un barrio y recorremos su polígono con Google Places para listar restaurantes, cafés, bares,
              panaderías, heladerías, parrillas y pizzerías. Los resultados quedan sólo en esta pantalla.
            </p>
          </div>

          <div className="mb-3 inline-flex rounded-xl border bg-background p-1" aria-label="Modo de recorrido">
            {([
              ['full', 'Completa'],
              ['ids', 'Sólo IDs (gratis)'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                disabled={isLoading}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  mode === value
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                aria-pressed={mode === value}
              >
                {label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (neighborhoodId && !isLoading) setConfirmOpen(true)
            }}
            className="grid gap-4 rounded-2xl border bg-background p-4 shadow-[0_1px_2px_rgb(0_0_0/0.03)] sm:grid-cols-[1fr_auto] sm:items-end lg:p-5"
          >
            <SearchCombobox
              id="barrio-recorrido"
              label="Barrio"
              placeholder="Seleccionar barrio"
              searchPlaceholder="Buscar barrio..."
              emptyMessage="No encontramos ese barrio."
              options={neighborhoodOptions}
              value={neighborhoodId}
              onChange={setNeighborhoodId}
            />
            {isLoading ? (
              <Button type="button" size="lg" variant="outline" className="h-11 rounded-xl px-5" onClick={cancelSweep}>
                <Square className="size-4" aria-hidden="true" />
                Cancelar
              </Button>
            ) : (
              <Button type="submit" size="lg" className="h-11 rounded-xl px-5" disabled={!neighborhoodId}>
                <Search className="size-4" aria-hidden="true" />
                Buscar todos los lugares
              </Button>
            )}
          </form>
        </section>

        <section className="mt-8" aria-labelledby="sweep-results-title">
          {(status === 'error' || status === 'partial') && (
            <Alert variant="destructive" className="mb-4 rounded-xl bg-background">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>
                {status === 'partial' ? 'El recorrido quedó incompleto' : 'No pudimos recorrer el barrio'}
              </AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{errorMessage}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNeighborhoodId(activeNeighborhood)
                    setConfirmOpen(true)
                  }}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="overflow-hidden rounded-2xl border bg-background shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
            <div className="flex min-h-16 flex-col justify-center gap-1 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h2 id="sweep-results-title" className="text-sm font-semibold">
                  Resultados
                </h2>
                <p className="text-sm text-muted-foreground">
                  {!activeLabel
                    ? 'Todavía no recorriste un barrio'
                    : activeMode === 'ids'
                      ? `IDs encontrados en ${activeLabel} · puede incluir lugares de barrios vecinos`
                      : `Comida y bebida en ${activeLabel}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
                {isLoading && <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />}
                {hasResults && activeMode === 'full' && (
                  <span className="font-medium tabular-nums">
                    {insidePlaces.length} dentro del barrio
                    <span className="font-normal text-muted-foreground">
                      {' '}· {places.length} encontrados en total
                    </span>
                  </span>
                )}
                {hasResults && activeMode === 'ids' && (
                  <span className="font-medium tabular-nums">
                    {places.length} {places.length === 1 ? 'lugar' : 'lugares'}
                  </span>
                )}
                {isLoading && progress && (
                  <span className="text-muted-foreground tabular-nums">
                    · {totalCalls(progress.apiCalls)} llamadas · {formatFoundBy(progress.currentQuery)}
                  </span>
                )}
                {status === 'success' && (
                  <CheckCircle2 className="size-4 text-emerald-600" aria-label="Recorrido completo" />
                )}
              </div>
            </div>

            {status === 'idle' && (
              <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
                <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted">
                  <MapIcon className="size-5 text-muted-foreground" aria-hidden="true" />
                </div>
                <p className="font-medium">Elegí un barrio para empezar</p>
                <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                  El recorrido divide el barrio en celdas y consulta Google Maps por cada tipo de lugar.
                </p>
              </div>
            )}

            {isLoading && !hasResults && (
              <div className="p-4 sm:p-5" aria-label="Cargando resultados">
                {[0, 1, 2, 3, 4].map((row) => (
                  <div key={row} className="flex gap-6 border-b py-4 last:border-0">
                    <Skeleton className="h-5 w-2/5" />
                    <Skeleton className="h-5 w-1/4" />
                  </div>
                ))}
              </div>
            )}

            {status === 'empty' && (
              <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
                <Search className="mb-4 size-6 text-muted-foreground" aria-hidden="true" />
                <p className="font-medium">No encontramos lugares</p>
                <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                  Google no devolvió lugares de comida o bebida dentro de este barrio.
                </p>
              </div>
            )}

            {status === 'error' && !hasResults && (
              <div className="min-h-40 bg-muted/20" aria-hidden="true" />
            )}

            {hasResults && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2.5 sm:px-5">
                {canFilter && (
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={onlyInside}
                      onChange={(event) => setOnlyInside(event.target.checked)}
                      className="size-4 accent-foreground"
                    />
                    Mostrar sólo lugares del barrio
                  </label>
                )}
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={hideExisting}
                      onChange={(event) => toggleHideExisting(event.target.checked)}
                      className="size-4 accent-foreground"
                    />
                    Ocultar los que ya están en la base
                  </label>
                  {existingText && (
                    <span className={existingStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'} aria-live="polite">
                      · {existingText}
                    </span>
                  )}
                </span>
              </div>
            )}

            {hasResults && canFilter && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 sm:px-5">
                <div className="flex flex-wrap gap-1" role="group" aria-label="Grupo del filtro previo">
                  {GROUPS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setGroup(item.id)
                        setShowProcessed(false)
                      }}
                      aria-pressed={!showProcessed && group === item.id}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        !showProcessed && group === item.id
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {item.label} ({groupCounts[item.id]})
                    </button>
                  ))}
                  {processedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowProcessed(true)}
                      aria-pressed={showProcessed}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        showProcessed
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Procesados ({processedCount})
                    </button>
                  )}
                </div>
                {!showProcessed && <div className="flex flex-wrap gap-2">
                  {batch.failedCount > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={batch.running}
                      onClick={() => void batch.retryFailed()}
                    >
                      <RotateCcw className="size-3.5" aria-hidden="true" />
                      Reintentar fallidos ({batch.failedCount})
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    disabled={batch.running || selectedRequests.length === 0}
                    onClick={() => void batch.run(selectedRequests)}
                  >
                    {batch.running ? (
                      <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Play className="size-3.5" aria-hidden="true" />
                    )}
                    Procesar ({selectedRequests.length})
                  </Button>
                </div>}
              </div>
            )}

            {processedTabOpen && (
              <ProcessedPlacesPanel rows={batch.rows} places={places} categoryLabel={categoryLabel} />
            )}

            {!processedTabOpen && hasResults && visiblePlaces.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">
                No hay lugares para mostrar con estos filtros.
              </p>
            )}

            {!processedTabOpen && visiblePlaces.length > 0 && (
              <PlacesTable
                places={visiblePlaces}
                columns={tableColumns}
                footerNote={
                  progress
                    ? `${totalCalls(progress.apiCalls)} llamadas a Google Places`
                    : 'Resultados en memoria'
                }
                onSelect={canFilter && group === 'accepted' ? setSelectedPlace : undefined}
                selection={
                  selectable
                    ? {
                        isSelected: (place) => selectedIds.has(place.placeId),
                        onToggle: toggleSelected,
                        allSelected: allVisibleSelected,
                        onToggleAll: toggleAllVisible,
                        isDisabled: blocked,
                      }
                    : undefined
                }
              />
            )}
          </div>

          {batch.metrics && !batch.running && (
            <BatchMetricsPanel metrics={batch.metrics} closed={closedSummary(places)} nameOf={(id) => places.find((place) => place.placeId === id)?.name ?? id} />
          )}

          {summary && <SweepSummaryPanel summary={summary} places={places} />}
        </section>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Recorrer {selectedLabel}?</DialogTitle>
            <DialogDescription>
              {mode === 'ids'
                ? 'Modo sólo IDs: usa Text Search Essentials (IDs Only), sin costo. No trae nombre ni ubicación, así que el conteo incluye lugares de celdas que tocan el borde del barrio.'
                : 'El recorrido puede hacer cientos de llamadas a Google Places Text Search Enterprise (USD 35 cada 1.000, con 1.000 gratis por mes) porque pide rating y cantidad de reseñas.'}{' '}
              El servidor se detiene al llegar al tope configurado (NEIGHBORHOOD_SWEEP_MAX_CALLS, 1500 por defecto).
              Podés cancelarlo en cualquier momento.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Los resultados no se guardan: si salís de la pantalla, hay que volver a recorrer.</span>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Volver
            </Button>
            <Button type="button" onClick={confirmSweep}>
              Empezar recorrido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PlaceExplorerDialog place={selectedPlace} onClose={() => setSelectedPlace(null)} />
      <ExtractionResultDialog
        place={resultPlace}
        row={resultPlace ? batch.rows[resultPlace.placeId] : undefined}
        onClose={() => setResultPlace(null)}
      />
    </>
  )
}

function BatchMetricsPanel({ metrics, closed, nameOf }: { metrics: ExtractionBatchMetrics; closed: ClosedSummary; nameOf: (id: string) => string }) {
  const steps = (Object.keys(STEP_LABELS) as ExtractionStep[]).filter((step) => metrics.averageStepsMs[step] !== undefined)
  return (
    <>
    {metrics.stoppedByApify && (
      <p role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Se cortó el lote: Apify falló en {APIFY_FAILURE_LIMIT} lugares seguidos. Revisá Apify y reintentá.
      </p>
    )}
    {metrics.stoppedByExa && (
      <p role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Se cortó el lote: Exa falló en {EXA_FAILURE_LIMIT} lugares seguidos. Revisá Exa y reintentá.
      </p>
    )}
    <section
      aria-label="Métricas del procesamiento"
      className="mt-4 grid gap-6 rounded-2xl border bg-background px-4 py-4 text-sm shadow-[0_1px_2px_rgb(0_0_0/0.03)] sm:grid-cols-2 sm:px-5 lg:grid-cols-3"
    >
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
        <dt className="text-muted-foreground">Tiempo total</dt>
        <dd className="font-medium tabular-nums">{formatSeconds(metrics.totalMs)}</dd>
        <dt className="text-muted-foreground">Promedio por lugar</dt>
        <dd className="font-medium tabular-nums">
          {metrics.averagePerPlaceMs === null ? '—' : formatSeconds(metrics.averagePerPlaceMs)}
        </dd>
        <dt className="text-muted-foreground">Listos</dt>
        <dd className="font-medium tabular-nums">{metrics.done}</dd>
        <dt className="text-muted-foreground">Con error</dt>
        <dd className="font-medium tabular-nums">{metrics.failed}</dd>
        <dt className="text-muted-foreground">Concurrencia</dt>
        <dd className="font-medium tabular-nums">{EXTRACT_CONCURRENCY}</dd>
      </dl>
      <div>
        <h3 className="mb-2 font-medium">Promedio por paso</h3>
        {steps.length === 0 ? (
          <p className="text-muted-foreground">Sin lugares listos.</p>
        ) : (
          <ul className="grid gap-1">
            {steps.map((step) => (
              <li key={step} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{STEP_LABELS[step]}</span>
                <span className="tabular-nums">{formatSeconds(metrics.averageStepsMs[step] ?? 0)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <LogoSummaryBlock summary={metrics.logos} />
      <ReviewSummaryBlock summary={metrics.review} closed={closed} />
      <ProviderErrorsBlock apify={metrics.apifyErrors} exa={metrics.exaErrors} shared={metrics.sharedAccounts} nameOf={nameOf} />
    </section>
    </>
  )
}

/** Lugares sin procesar por un error de Apify o de Exa (no se guardan) y cuentas agregadoras que obligaron a re-procesar. */
function ProviderErrorsBlock({ apify, exa, shared, nameOf }: { apify: string[]; exa: string[]; shared: ExtractionBatchMetrics['sharedAccounts']; nameOf: (id: string) => string }) {
  const errorRows = [
    { label: 'Error de Apify: reintentar', ids: apify },
    { label: 'Error de Exa: reintentar', ids: exa },
  ]
  return (
    <div className="sm:col-span-2 lg:col-span-1">
      <h3 className="mb-2 font-medium">Fuentes</h3>
      <ul className="grid gap-1.5" aria-label="Errores de Apify y Exa y cuentas compartidas">
        {errorRows.map(({ label, ids }) => (
          <li key={label} className={ids.length === 0 ? 'text-muted-foreground/60' : undefined}>
            <span className="flex justify-between gap-4">
              <span className={ids.length === 0 ? undefined : 'text-muted-foreground'}>{label}</span>
              <span className="tabular-nums">{ids.length}</span>
            </span>
            {ids.length > 0 && <span className="block text-xs text-muted-foreground">{ids.map(nameOf).join(', ')}</span>}
          </li>
        ))}
        <li className={shared.length === 0 ? 'text-muted-foreground/60' : undefined}>
          <span className="flex justify-between gap-4">
            <span className={shared.length === 0 ? undefined : 'text-muted-foreground'}>Cuentas compartidas descartadas</span>
            <span className="tabular-nums">{shared.length}</span>
          </span>
          {shared.length > 0 && (
            <span className="block text-xs text-muted-foreground">
              {shared.map((item) => `@${item.handle} (re-procesado: ${item.reprocessed.map(nameOf).join(', ')})`).join(', ')}
            </span>
          )}
        </li>
      </ul>
      {apify.length + exa.length > 0 && <p className="mt-2 text-xs text-muted-foreground">No se guardan: usá «Reintentar fallidos».</p>}
    </div>
  )
}

/** Lugares que se guardan con status review, por motivo, y los cerrados según Google del barrido. */
function ReviewSummaryBlock({ summary, closed }: { summary: ReviewSummary; closed: ClosedSummary }) {
  const rows = [
    ...(Object.keys(REVIEW_REASONS) as ReviewReason[]).map((id) => ({ id, label: REVIEW_REASONS[id], names: summary.byReason[id] })),
    ...(Object.keys(CLOSED_REASONS) as (keyof ClosedSummary)[]).map((id) => ({ id, label: `${CLOSED_REASONS[id]} (barrido)`, names: closed[id] })),
  ]
  return (
    <div className="sm:col-span-2 lg:col-span-1">
      <h3 className="mb-2 font-medium">A revisar</h3>
      <ul className="grid gap-1.5" aria-label="A revisar por motivo">
        {rows.map((row) => (
          <li key={row.id} className={row.names.length === 0 ? 'text-muted-foreground/60' : undefined}>
            <span className="flex justify-between gap-4">
              <span className={row.names.length === 0 ? undefined : 'text-muted-foreground'}>{row.label}</span>
              <span className="tabular-nums">{row.names.length}</span>
            </span>
            {row.names.length > 0 && <span className="block text-xs text-muted-foreground">{row.names.join(', ')}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {summary.places === 1 ? '1 procesado se guarda sin publicar' : `${summary.places} procesados se guardan sin publicar`}
      </p>
    </div>
  )
}

/** Resultado del paso del logo por motivo, con los lugares de cada uno (y el código HTTP o la clasificación). */
function LogoSummaryBlock({ summary }: { summary: LogoSummary }) {
  return (
    <div className="sm:col-span-2 lg:col-span-1">
      <h3 className="mb-2 font-medium">Logos</h3>
      <ul className="grid gap-1.5" aria-label="Logos por resultado">
        {LOGO_GROUPS.map((group) => {
          const places = summary.groups[group.id]
          return (
            <li key={group.id} className={places.length === 0 ? 'text-muted-foreground/60' : undefined}>
              <span className="flex justify-between gap-4">
                <span className={places.length === 0 ? undefined : 'text-muted-foreground'}>{group.label}</span>
                <span className="tabular-nums">{places.length}</span>
              </span>
              {places.length > 0 && (
                <span className="block text-xs text-muted-foreground">
                  {places.map((place) => place.detail ? `${place.name} (${place.detail})` : place.name).join(', ')}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {summary.fallback.searched > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="flex justify-between gap-4">
            <span>Instagram encontrado por el respaldo</span>
            <span className="tabular-nums">{summary.fallback.found.length} de {summary.fallback.searched} {summary.fallback.searched === 1 ? 'búsqueda' : 'búsquedas'}</span>
          </span>
          {summary.fallback.found.length > 0 && <span className="block">{summary.fallback.found.map((place) => place.detail ? `${place.name} (${place.detail})` : place.name).join(', ')}</span>}
        </p>
      )}
      {summary.withoutStep > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {summary.withoutStep === 1 ? '1 con error, sin paso de logo' : `${summary.withoutStep} con error, sin paso de logo`}
        </p>
      )}
    </div>
  )
}

const PREVIEW_SIZE = 10

function PreviewTable({ title, places }: { title: string; places: NeighborhoodSweepPlace[] }) {
  return (
    <div>
      <h3 className="mb-2 font-medium">
        {title} (primeros {Math.min(PREVIEW_SIZE, places.length)} de {places.length})
      </h3>
      {places.length === 0 ? (
        <p className="text-muted-foreground">Ninguno.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-3">Nombre</TableHead>
                <TableHead className="px-3">Tipo principal</TableHead>
                <TableHead className="px-3">Motivo</TableHead>
                <TableHead className="px-3 text-right">Rating</TableHead>
                <TableHead className="px-3 text-right">Reseñas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {places.slice(0, PREVIEW_SIZE).map((place) => (
                <TableRow key={place.placeId}>
                  <TableCell className="px-3 py-2 font-medium">{place.name}</TableCell>
                  <TableCell className="px-3 py-2 font-mono text-xs">{place.primaryType ?? '—'}</TableCell>
                  <TableCell className="px-3 py-2 font-mono text-xs">{place.reason ?? '—'}</TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums">{place.rating?.toFixed(1) ?? '—'}</TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums">{place.userRatingCount ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function SweepSummaryPanel({
  summary,
  places,
}: {
  summary: NeighborhoodSweepSummary
  places: NeighborhoodSweepPlace[]
}) {
  const byReason = Object.entries(summary.byReason).sort((a, b) => b[1] - a[1])
  const unknownTypes = Object.entries(summary.unknownTypes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const inside = places.filter(isInside)
  const byCategory = Object.entries(summary.bySeedCategory).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
  const byQuery = Object.entries(summary.newByQuery).sort((a, b) => b[1] - a[1])
  const rescueTotal = summary.saturatedCells.reduce((sum, cell) => sum + cell.rescueNewPlaces, 0)

  return (
    <details className="mt-4 rounded-2xl border bg-background shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold sm:px-5">
        Resumen del recorrido
        {incompleteRunMessage(summary) && (
          <span className="ml-2 font-semibold text-destructive">· {incompleteRunMessage(summary)}</span>
        )}
      </summary>
      <div className="grid gap-6 border-t px-4 py-4 text-sm sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">Modo</dt>
          <dd className="font-medium">{summary.mode === 'ids' ? 'Sólo IDs (gratis)' : 'Completa'}</dd>
          <dt className="text-muted-foreground">Total encontrado</dt>
          <dd className="font-medium tabular-nums">{summary.totalPlaces + summary.discardedOutside}</dd>
          <dt className="text-muted-foreground">Dentro del barrio</dt>
          <dd className="font-medium tabular-nums">
            {summary.mode === 'ids' ? 'No disponible en modo IDs' : summary.totalPlaces}
          </dd>
          {summary.byGroup && (
            <>
              <dt className="text-muted-foreground">Aceptados</dt>
              <dd className="font-medium tabular-nums">{summary.byGroup.accepted}</dd>
              <dt className="text-muted-foreground">A revisar</dt>
              <dd className="font-medium tabular-nums">{summary.byGroup.review}</dd>
              <dt className="text-muted-foreground">Rechazados</dt>
              <dd className="font-medium tabular-nums">{summary.byGroup.rejected}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Descartados fuera del polígono</dt>
          <dd className="font-medium tabular-nums">
            {summary.mode === 'ids' ? 'No disponible en modo IDs' : summary.discardedOutside}
          </dd>
          <dt className="text-muted-foreground">Llamadas de barrido</dt>
          <dd className="font-medium tabular-nums">{summary.apiCalls.sweep}</dd>
          <dt className="text-muted-foreground">Llamadas de rescate</dt>
          <dd className="font-medium tabular-nums">{summary.apiCalls.rescue}</dd>
          <dt className="text-muted-foreground">Celdas mínimas saturadas</dt>
          <dd className="font-medium tabular-nums">{summary.saturatedCells.length}</dd>
          <dt className="text-muted-foreground">Aporte del rescate</dt>
          <dd className="font-medium tabular-nums">{rescueTotal}</dd>
          <dt className="text-muted-foreground">Llamadas fallidas</dt>
          <dd className={`font-medium tabular-nums ${summary.failedCallCount > 0 ? 'text-destructive' : ''}`}>
            {summary.failedCallCount}
          </dd>
          <dt className="text-muted-foreground">Páginas intermedias fallidas</dt>
          <dd className={`font-medium tabular-nums ${summary.failedPageCount > 0 ? 'text-destructive' : ''}`}>
            {summary.failedPageCount}
          </dd>
        </dl>

        <div>
          <h3 className="mb-2 font-medium">Por categoría semilla</h3>
          <ul className="grid gap-1">
            {byCategory.map(([category, count]) => (
              <li key={category} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{categoryLabel(category)}</span>
                <span className="tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 font-medium">Lugares nuevos por consulta</h3>
          <ul className="grid gap-1">
            {byQuery.map(([key, count]) => (
              <li key={key} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{formatFoundBy(key)}</span>
                <span className="tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </div>

        {summary.byGroup && (
          <div>
            <h3 className="mb-2 font-medium">Por motivo (a revisar y rechazados)</h3>
            {byReason.length === 0 ? (
              <p className="text-muted-foreground">Ninguno.</p>
            ) : (
              <ul className="grid gap-1">
                {byReason.map(([reason, count]) => (
                  <li key={reason} className="flex justify-between gap-4">
                    <span className="font-mono text-xs text-muted-foreground">{reason}</span>
                    <span className="tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {summary.byGroup && (
          <div>
            <h3 className="mb-2 font-medium">Tipos en revisión sin clasificar</h3>
            {unknownTypes.length === 0 ? (
              <p className="text-muted-foreground">Ninguno.</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-muted-foreground">
                  Pasalos a ACCEPT o REJECT en neighborhood-sweep-config.ts.
                </p>
                <ul className="grid gap-1">
                  {unknownTypes.map(([type, count]) => (
                    <li key={type} className="flex justify-between gap-4">
                      <span className="font-mono text-xs text-muted-foreground">{type}</span>
                      <span className="tabular-nums">{count}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {summary.byGroup && (
          <div className="grid gap-6 sm:col-span-2 lg:col-span-3">
            <PreviewTable title="Rechazados" places={inside.filter((place) => place.group === 'rejected')} />
            <PreviewTable title="A revisar" places={inside.filter((place) => place.group === 'review')} />
          </div>
        )}

        {summary.saturatedCells.length > 0 && (
          <div className="sm:col-span-2 lg:col-span-3">
            <h3 className="mb-2 font-medium">Celdas mínimas saturadas</h3>
            <ul className="grid gap-1 text-xs">
              {summary.saturatedCells.map((cell) => (
                <li key={`${cell.bounds.south},${cell.bounds.west}`} className="flex flex-wrap justify-between gap-2">
                  <span className="font-mono text-muted-foreground">
                    {cell.bounds.south.toFixed(5)}, {cell.bounds.west.toFixed(5)} → {cell.bounds.north.toFixed(5)},{' '}
                    {cell.bounds.east.toFixed(5)}
                  </span>
                  <span>
                    {cell.saturatedBy.map((item) => `${item.googleType}: ${item.query}`).join(', ')} · rescate aportó{' '}
                    {cell.rescueNewPlaces}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}
