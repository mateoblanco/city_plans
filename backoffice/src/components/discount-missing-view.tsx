import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, ArrowUpRight, EyeOff, LoaderCircle, MapPin, Search, Wrench } from 'lucide-react'
import { DiscountResolvePanel } from '@/components/discount-resolve-panel'
import { targetFromRow, type ResolveOutcome, type ResolveTarget } from '@/lib/discount-resolve'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { groupByNeighborhood, isMissingCandidate, rowSearch, type MissingRow } from '@/lib/discount-missing'
import { getPlaceSearchEstimate, getPlaceSearchProgress, setDiscountIgnoredMany, startPlaceSearch } from '@/lib/discounts-api'
import type {
  DiscountPlace,
  OurPlaceStatus,
  PlaceSearchEstimate,
  PlaceSearchJobRow,
  PlaceSearchProgress,
  StoredPlaceSearch,
} from '@/types/discounts'

export const SEARCH_POLL_MS = 1_500
const MAX_ROWS = 200

const OUR_STATUS_LABELS: Record<OurPlaceStatus, string> = { published: 'publicado', review: 'en revisión', hidden: 'oculto', draft: 'borrador' }
const OUTCOME_LABELS = {
  review: 'En revisión',
  doubtful: 'Dudoso',
  not_found: 'No encontrado',
  exists: 'Ya existe',
  error: 'Error',
} as const
type Outcome = keyof typeof OUTCOME_LABELS
const OUTCOME_STYLES: Record<Outcome | 'interrupted' | 'running', string> = {
  review: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  doubtful: 'bg-amber-50 text-amber-800 ring-amber-200',
  not_found: 'bg-muted text-muted-foreground ring-border',
  exists: 'bg-sky-50 text-sky-800 ring-sky-200',
  error: 'bg-rose-50 text-rose-800 ring-rose-200',
  interrupted: 'bg-rose-50 text-rose-800 ring-rose-200',
  running: 'bg-violet-50 text-violet-800 ring-violet-200',
}
const STATE_LABELS = { queued: 'En cola', searching: 'Buscando en Google…', extracting: 'Extrayendo…' } as const

/** Montos chicos con 3 decimales (una búsqueda son US$ 0,032). */
const usd = (value: number) => `US$ ${value.toFixed(value < 1 ? 3 : 2).replace('.', ',')}`
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
const dateTime = (iso: string) => new Date(iso).toLocaleString('es-UY', { dateStyle: 'medium', timeStyle: 'short' })
const message = (error: unknown) => (error instanceof Error ? error.message : 'No se pudo completar la consulta.')

function Tag({ children, className = 'bg-muted text-muted-foreground ring-border' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ${className}`}>{children}</span>
}

/** Ya se buscó (y no hace falta repetirlo): "seleccionar todo" lo saltea. Los errores e interrumpidos sí entran. */
const alreadySearched = (search: StoredPlaceSearch | null) => Boolean(search && search.status !== 'error' && search.status !== 'searched')
/** Ya quedó resuelto por la búsqueda (en revisión, ya existía o no encontrado): "Siguiente sin resolver" lo saltea. */
const resolvedBySearch = (search: StoredPlaceSearch | null) => Boolean(search && ['review', 'exists', 'not_found'].includes(search.status))

type RowView = {
  row: MissingRow
  search: StoredPlaceSearch | null
  live: PlaceSearchJobRow | null
}

function SearchStatus({ view, running }: { view: RowView; running: boolean }) {
  const { live, search } = view
  if (live && running && live.state !== 'done') return <Tag className={OUTCOME_STYLES.running}>{STATE_LABELS[live.state]}</Tag>
  if (!search) return <span className="text-sm text-muted-foreground">—</span>
  const label = search.status === 'searched'
    ? <Tag className={OUTCOME_STYLES.interrupted}>Interrumpido</Tag>
    : <Tag className={OUTCOME_STYLES[search.status]}>{OUTCOME_LABELS[search.status]}{search.status === 'exists' && search.ourPlace ? ` · ${OUR_STATUS_LABELS[search.ourPlace.status]}` : ''}</Tag>
  return (
    <span className="grid gap-0.5">
      <span title={search.error ?? undefined}>{label}</span>
      {search.ourPlace && <span className="text-xs text-muted-foreground">{search.ourPlace.name}</span>}
      {search.status === 'error' && search.error && <span className="max-w-64 text-xs text-destructive">{search.error}</span>}
      <span className="text-xs text-muted-foreground">{dateTime(search.searchedAt)}</span>
    </span>
  )
}

function JobSummary({ progress }: { progress: Extract<PlaceSearchProgress, { status: 'running' | 'done' }> }) {
  const counts: Record<Outcome, number> = { review: 0, doubtful: 0, not_found: 0, exists: 0, error: 0 }
  for (const row of progress.rows) if (row.state === 'done' && row.outcome) counts[row.outcome] += 1
  const done = progress.rows.filter((row) => row.state === 'done').length
  const tiles: [string, number][] = [
    ['Enviados a revisión', counts.review],
    ['Dudosos', counts.doubtful],
    ['No encontrados', counts.not_found],
    ['Ya existían', counts.exists],
    ['Errores', counts.error],
  ]
  const running = progress.status === 'running'
  const existing = progress.rows.filter((row) => row.outcome === 'exists' && row.ourPlace)
  return (
    <Alert className="mb-4 rounded-xl bg-background" role="status">
      {running ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
      <AlertTitle>{running ? `Buscando lugares · ${done} de ${progress.rows.length}` : `Búsqueda terminada · ${plural(progress.rows.length, 'lugar', 'lugares')}`}</AlertTitle>
      <AlertDescription className="grid gap-3">
        {running && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={progress.rows.length} aria-label="Progreso de la búsqueda">
            <div className="h-full bg-foreground transition-[width]" style={{ width: `${progress.rows.length ? Math.round((done / progress.rows.length) * 100) : 0}%` }} />
          </div>
        )}
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {tiles.map(([label, value]) => (
            <div key={label} className="rounded-lg border px-3 py-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <span className="text-xs">
          Empezó {dateTime(progress.startedAt)}{progress.finishedAt ? ` · terminó ${dateTime(progress.finishedAt)}` : ''} · {plural(progress.searches, 'búsqueda', 'búsquedas')} en Google · costo real {usd(progress.costUsd)}
        </span>
        {existing.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer">Ya existían ({existing.length})</summary>
            <ul className="mt-1 grid list-disc gap-0.5 pl-5">
              {existing.map((row) => <li key={row.rowKey}>{row.name} → {row.ourPlace!.name} ({OUR_STATUS_LABELS[row.ourPlace!.status]}, en Lugares)</li>)}
            </ul>
          </details>
        )}
        {progress.stopped && <span className="text-xs text-destructive">{progress.stopped}</span>}
      </AlertDescription>
    </Alert>
  )
}

/**
 * Vista de "No están en la base": un local por fila, agrupado por barrio y sin repetir entre proveedores, con selección
 * para buscarlos en Google y mandarlos a extracción (en el servidor; siempre quedan en "A revisar").
 */
export function DiscountMissingView({ rows, places, visibleIds, searches, providers, onReload, onPlaces, onSearches }: {
  /** Las filas que arma el servidor (con todos los lugares, así las claves no dependen de los filtros). */
  rows: MissingRow[]
  /** Todos los lugares del proveedor, como están ahora (una fila sale sin recargar cuando ya ninguno falta en la base). */
  places: DiscountPlace[]
  /** Los que pasan los filtros de la pantalla: se muestran las filas con alguno de ellos. */
  visibleIds: ReadonlySet<string>
  searches: Record<string, StoredPlaceSearch[]>
  providers: Map<string, string>
  onReload: () => Promise<void>
  /** Lugares actualizados por una acción (vincular, descartar): la pantalla los reemplaza sin recargar. */
  onPlaces: (places: DiscountPlace[]) => void
  /** Búsquedas guardadas actualizadas (Google, "Ninguno", "Agregar"). */
  onSearches: (searches: Record<string, StoredPlaceSearch[]>) => void
}) {
  const [progress, setProgress] = useState<PlaceSearchProgress>({ status: 'idle' })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [confirm, setConfirm] = useState<{ status: 'loading' } | { status: 'ready'; estimate: PlaceSearchEstimate } | { status: 'error'; message: string } | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [resolving, setResolving] = useState<ResolveTarget | null>(null)
  const finished = useRef<string | null>(null)
  const resolveButtons = useRef(new Map<string, HTMLButtonElement>())
  // Al cerrar el panel después de resolver, el foco va al "Resolver" de la próxima fila sin resolver.
  const focusAfterClose = useRef<HTMLElement | null>(null)

  const byId = useMemo(() => new Map(places.map((place) => [place.id, place])), [places])
  const live = useMemo(() => new Map(progress.status === 'idle' ? [] : progress.rows.map((row) => [row.rowKey, row])), [progress])
  const views = useMemo(() => rows
    .filter((row) => row.members.some((member) => visibleIds.has(member.discountPlaceId)))
    // Vinculada o descartada desde la pantalla: sale sin recargar las filas del servidor.
    .filter((row) => row.members.some((member) => {
      const place = byId.get(member.discountPlaceId)
      return !place || isMissingCandidate(place)
    }))
    .map((row): RowView => ({ row, search: rowSearch(row, searches), live: live.get(row.key) ?? null })), [rows, visibleIds, searches, live, byId])
  const groups = useMemo(() => {
    const byKey = new Map(views.map((view) => [view.row.key, view]))
    return groupByNeighborhood(views.map((view) => view.row)).map((group) => ({ ...group, views: group.rows.map((row) => byKey.get(row.key)!) }))
  }, [views])
  const running = progress.status === 'running'

  // Las filas que ya no se ven (cambió un filtro o se recargó) dejan de estar seleccionadas.
  const visibleKeys = useMemo(() => new Set(views.map((view) => view.row.key)), [views])
  const chosen = [...selected].filter((key) => visibleKeys.has(key))
  const repeated = views.filter((view) => selected.has(view.row.key) && alreadySearched(view.search)).length

  useEffect(() => {
    const controller = new AbortController()
    getPlaceSearchProgress(controller.signal).then(setProgress).catch(() => {
      // Sin el progreso, la vista funciona igual; el próximo intento lo vuelve a pedir.
    })
    return () => controller.abort()
  }, [])

  // Mientras corre, se consulta el progreso; al terminar, se recarga lo guardado (estados de las filas).
  useEffect(() => {
    if (!running) return
    let cancelled = false
    const timer = setInterval(() => {
      getPlaceSearchProgress()
        .then((next) => {
          if (cancelled) return
          setProgress(next)
          if (next.status === 'done') {
            const id = `${next.jobId}:${next.finishedAt}`
            if (finished.current === id) return
            finished.current = id
            void onReload()
          }
        })
        .catch(() => {
          // Un corte momentáneo no frena la búsqueda: se vuelve a consultar.
        })
    }, SEARCH_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [running, onReload])

  const toggle = useCallback((key: string, on: boolean) => setSelected((current) => {
    const next = new Set(current)
    if (on) next.add(key)
    else next.delete(key)
    return next
  }), [])

  function toggleGroup(groupViews: RowView[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      for (const view of groupViews) {
        if (on && !alreadySearched(view.search)) next.add(view.row.key)
        if (!on) next.delete(view.row.key)
      }
      return next
    })
  }

  async function openConfirm() {
    setError(null)
    setConfirm({ status: 'loading' })
    try {
      setConfirm({ status: 'ready', estimate: await getPlaceSearchEstimate() })
    } catch (failure) {
      setConfirm({ status: 'error', message: message(failure) })
    }
  }

  async function start() {
    setStarting(true)
    try {
      await startPlaceSearch(chosen)
      setConfirm(null)
      setSelected(new Set())
      setProgress(await getPlaceSearchProgress())
    } catch (failure) {
      setConfirm(null)
      setError(message(failure))
    } finally {
      setStarting(false)
    }
  }

  const ordered = useMemo(() => groups.flatMap((group) => group.views), [groups])
  const unresolved = (view: RowView) => !resolvedBySearch(view.search) && !(view.live && view.live.state !== 'done')
  /** La próxima fila sin resolver después de `key` (en el orden de la tabla), sin contar `key`. */
  const nextAfter = (key: string): RowView | null => {
    const index = ordered.findIndex((view) => view.row.key === key)
    const rest = index < 0 ? ordered : [...ordered.slice(index + 1), ...ordered.slice(0, index)]
    return rest.find((view) => view.row.key !== key && unresolved(view)) ?? null
  }

  const open = (row: MissingRow) => setResolving(targetFromRow(row, places))
  function resolved(_outcome: ResolveOutcome) {
    if (!resolving) return
    const next = nextAfter(resolving.key)
    focusAfterClose.current = next ? resolveButtons.current.get(next.row.key) ?? null : null
    setResolving(null)
  }
  function openNext() {
    if (!resolving) return
    const next = nextAfter(resolving.key)
    setResolving(next ? targetFromRow(next.row, places) : null)
  }
  const resolvingView = resolving ? views.find((view) => view.row.key === resolving.key) ?? null : null
  const resolvingRow = resolving ? rows.find((row) => row.key === resolving.key) ?? null : null

  async function discardRows(keys: string[]) {
    const ids = [...new Set(rows.filter((row) => keys.includes(row.key)).flatMap((row) => row.members.map((member) => member.discountPlaceId)))]
    if (!ids.length) return
    setDiscarding(true)
    setError(null)
    try {
      onPlaces(await setDiscountIgnoredMany(ids, true))
      setSelected((current) => new Set([...current].filter((key) => !keys.includes(key))))
    } catch (failure) {
      setError(message(failure))
    } finally {
      setDiscarding(false)
    }
  }

  const refreshProgress = () => {
    getPlaceSearchProgress().then(setProgress).catch(() => {
      // El polling lo vuelve a pedir.
    })
  }

  const providerNames = (ids: string[]) => ids.map((id) => providers.get(id) ?? id)

  return (
    <>
      {progress.status !== 'idle' && progress.rows.length > 0 && <JobSummary progress={progress} />}
      {error && (
        <Alert variant="destructive" className="mb-4 rounded-xl bg-background">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>No se pudo buscar</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-hidden rounded-xl border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 sm:px-5">
          <p className="text-sm font-semibold tabular-nums" role="status">
            {plural(views.length, 'lugar', 'lugares')} sin repetir · {plural(groups.length, 'barrio', 'barrios')} · {plural(chosen.length, 'seleccionado', 'seleccionados')}
          </p>
          <span className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={discarding || chosen.length === 0 || chosen.length > MAX_ROWS} onClick={() => void discardRows(chosen)}>
              <EyeOff className="size-3.5" aria-hidden="true" />
              Descartar seleccionados ({chosen.length})
            </Button>
            <Button type="button" size="sm" disabled={running || chosen.length === 0 || chosen.length > MAX_ROWS} onClick={() => void openConfirm()}>
              <Search className="size-3.5" aria-hidden="true" />
              Buscar seleccionados ({chosen.length})
            </Button>
          </span>
        </div>
        {chosen.length > MAX_ROWS && <p className="border-b px-4 py-2 text-xs text-destructive sm:px-5">Se pueden buscar o descartar hasta {MAX_ROWS} por vez.</p>}
        {views.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center px-6 py-12 text-center">
            <MapPin className="mb-4 size-6 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">No hay lugares que falten en la base con estos filtros</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-10 px-4 sm:px-5"><span className="sr-only">Seleccionar</span></TableHead>
                  <TableHead className="px-4 sm:px-5">Nombre en la fuente</TableHead>
                  <TableHead className="px-4 sm:px-5">Proveedores</TableHead>
                  <TableHead className="px-4 sm:px-5">Dirección</TableHead>
                  <TableHead className="px-4 sm:px-5">Búsqueda</TableHead>
                  <TableHead className="px-4 sm:px-5">Acciones</TableHead>
                  <TableHead className="px-4 sm:px-5">Fuente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => {
                  const selectable = group.views.filter((view) => !alreadySearched(view.search))
                  const allOn = selectable.length > 0 && selectable.every((view) => selected.has(view.row.key))
                  return [
                    <TableRow key={`group-${group.label}`} className="bg-muted/20 hover:bg-muted/20">
                      <TableCell className="px-4 py-2 sm:px-5">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={allOn}
                          disabled={running || selectable.length === 0}
                          onChange={(event) => toggleGroup(group.views, event.target.checked)}
                          aria-label={`Seleccionar todo ${group.label}`}
                        />
                      </TableCell>
                      <TableCell colSpan={6} className="px-4 py-2 text-sm font-semibold sm:px-5">
                        {group.label} <span className="font-normal text-muted-foreground">· {group.views.length}{selectable.length < group.views.length ? ` (${group.views.length - selectable.length} ya buscados)` : ''}</span>
                      </TableCell>
                    </TableRow>,
                    ...group.views.flatMap((view) => {
                      const { row } = view
                      const firstSource = row.owners[0]
                      return [
                        <TableRow key={row.key}>
                          <TableCell className="px-4 py-3 align-top sm:px-5">
                            <input
                              type="checkbox"
                              className="size-4 accent-primary"
                              checked={selected.has(row.key)}
                              disabled={running}
                              onChange={(event) => toggle(row.key, event.target.checked)}
                              aria-label={`Seleccionar ${row.name}${row.neighborhoodId ? ` (${group.label})` : ''}`}
                            />
                          </TableCell>
                          <TableCell className="px-4 py-3 align-top font-medium sm:px-5">{row.name}</TableCell>
                          <TableCell className="px-4 py-3 align-top sm:px-5">
                            <span className="flex flex-wrap gap-1">{providerNames(row.providerIds).map((name) => <Tag key={name}>{name}</Tag>)}</span>
                          </TableCell>
                          <TableCell className="px-4 py-3 align-top text-sm sm:px-5">{row.address ?? <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="px-4 py-3 align-top sm:px-5"><SearchStatus view={view} running={running} /></TableCell>
                          <TableCell className="px-4 py-3 align-top sm:px-5">
                            <span className="flex flex-wrap gap-1">
                              <Button
                                ref={(element) => {
                                  if (element) resolveButtons.current.set(row.key, element)
                                  else resolveButtons.current.delete(row.key)
                                }}
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => open(row)}
                                aria-label={`Resolver ${row.name}`}
                              >
                                <Wrench className="size-3.5" aria-hidden="true" />
                                Resolver
                              </Button>
                              <Button type="button" size="sm" variant="ghost" disabled={discarding} onClick={() => void discardRows([row.key])} aria-label={`Descartar ${row.name}`}>
                                <EyeOff className="size-3.5" aria-hidden="true" />
                                Descartar
                              </Button>
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-3 align-top sm:px-5">
                            <a className="inline-flex items-center gap-1 text-sm underline" href={firstSource.sourceUrl} target="_blank" rel="noreferrer">
                              Ver <ArrowUpRight className="size-3.5" aria-hidden="true" />
                            </a>
                          </TableCell>
                        </TableRow>,
                      ]
                    }),
                  ]
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <DiscountResolvePanel
        target={resolving}
        places={resolving ? places.filter((place) => resolving.discountPlaceIds.includes(place.id)) : []}
        search={resolvingRow ? rowSearch(resolvingRow, searches) : null}
        live={resolvingView?.live ?? (resolving ? live.get(resolving.key) ?? null : null)}
        providers={providers}
        hasNext={resolving ? nextAfter(resolving.key) !== null : false}
        finalFocus={focusAfterClose}
        onClose={() => {
          focusAfterClose.current = null
          setResolving(null)
        }}
        onPlaces={onPlaces}
        onSearches={onSearches}
        onAdded={refreshProgress}
        onDone={resolved}
        onNext={openNext}
      />

      <Dialog open={confirm !== null} onOpenChange={(open) => { if (!open && !starting) setConfirm(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buscar {plural(chosen.length, 'lugar', 'lugares')} en Google</DialogTitle>
            <DialogDescription>
              Cada uno se busca en Google y, si el resultado es claro y no está en la base, pasa por la extracción y queda en «A revisar». Nada se publica solo.
            </DialogDescription>
          </DialogHeader>
          {confirm?.status === 'loading' && <p className="text-sm text-muted-foreground">Calculando el costo…</p>}
          {confirm?.status === 'error' && <p className="text-sm text-destructive" role="alert">No se pudo calcular el costo: {confirm.message}</p>}
          {confirm?.status === 'ready' && (
            <dl className="grid gap-1 text-sm">
              <div className="flex justify-between gap-4"><dt>Búsquedas en Google ({chosen.length} × {usd(confirm.estimate.searchUsd)})</dt><dd className="tabular-nums">{usd(chosen.length * confirm.estimate.searchUsd)}</dd></div>
              <div className="flex justify-between gap-4"><dt>Extracciones, hasta {chosen.length} × {usd(confirm.estimate.extractionUsd)}</dt><dd className="tabular-nums">{usd(chosen.length * confirm.estimate.extractionUsd)}</dd></div>
              <div className="flex justify-between gap-4 border-t pt-1 font-semibold"><dt>Hasta</dt><dd className="tabular-nums">{usd(chosen.length * (confirm.estimate.searchUsd + confirm.estimate.extractionUsd))}</dd></div>
              <p className="mt-2 text-xs text-muted-foreground">
                {confirm.estimate.basedOnPlaces > 0
                  ? `La extracción es el promedio real de ${plural(confirm.estimate.basedOnPlaces, 'lugar', 'lugares')} en los últimos ${plural(confirm.estimate.basedOnReports, 'lote', 'lotes')}.`
                  : 'No hay reportes de lotes recientes: la extracción usa un valor por defecto.'}
                {' '}Los que ya existen en la base, los dudosos y los no encontrados no se extraen.
              </p>
              {repeated > 0 && <p className="text-xs text-amber-800">{plural(repeated, 'ya se buscó antes', 'ya se buscaron antes')}: se vuelve{repeated === 1 ? '' : 'n'} a buscar.</p>}
            </dl>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={starting} onClick={() => setConfirm(null)}>Cancelar</Button>
            <Button type="button" disabled={starting || confirm?.status !== 'ready'} onClick={() => void start()}>
              {starting && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
              Buscar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
