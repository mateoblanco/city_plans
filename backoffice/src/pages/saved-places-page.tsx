import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Database, LoaderCircle, PencilLine, RotateCcw, Search, Send, Star } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { PlaceEditDialog } from '@/components/place-edit-dialog'
import { PlaceIcon } from '@/components/place-icon'
import { PlaceLogo } from '@/components/place-logo'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CATEGORIES } from '@/data/tags'
import { neighborhoodDisplayName } from '@/data/neighborhood-names'
import { reviewReasonLabel } from '@/data/review-reasons'
import { PRICE_LEVELS } from '@/data/manual-overrides'
import { googleMapsUrl } from '@/lib/google-maps-url'
import { GOOGLE_RATINGS_BATCH, getGoogleRatings, listSavedNeighborhoods, listSavedPlaceIds, listSavedPlaces, publishPlace, savePlaceEdit, setPlaceFeatured } from '@/lib/places-api'
import { PLACE_LIST_CATEGORIES, PLACE_LIST_MISSING, type GoogleRating, type PlaceListItem, type PlaceNeighborhoodCount, type PlaceListMissing, type PlaceListPage, type PlaceListQuery, type PriceLevel } from '@/types/places'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; page: PlaceListPage }

type Tab = 'all' | 'published' | 'review'

/** Orden por puntaje de Google: se arma en el cliente, porque el puntaje no está en la base. */
type RatingSort = 'rating_desc' | 'rating_asc'

type RatingRun =
  | { status: 'idle' }
  | { status: 'counting' }
  | { status: 'confirm'; ids: string[]; withoutGoogleId: number }
  | { status: 'loading'; total: number }
  | { status: 'done'; loaded: number; failed: number; withoutGoogleId: number }
  | { status: 'error'; message: string }

export const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300
const STATUS_LABELS: Record<string, string> = { draft: 'Borrador', published: 'Publicado', review: 'A revisar', hidden: 'Oculto' }
const HOURS_LABELS: Record<string, string> = { exact: 'Exacto', partial: 'Parcial', vague: 'Vago', none: 'Sin horario' }
const SORT_LABELS: Record<PlaceListQuery['sort'], string> = { recent: 'Más reciente', prominence: 'Prominencia', name: 'Nombre' }
const RATING_SORT_LABELS: Record<RatingSort, string> = { rating_desc: 'Puntaje de Google (mayor primero)', rating_asc: 'Puntaje de Google (menor primero)' }
// Place Details Enterprise (rating y userRatingCount), primer tramo; los primeros 1.000 del mes son gratis.
const PLACE_DETAILS_USD = 0.02
const MISSING_LABELS: Record<PlaceListMissing, string> = { price: 'Precio', hours: 'Horario', logo: 'Logo', instagram: 'Instagram' }
const PRICE_LABELS: Record<PriceLevel, string> = { low: '$', moderate: '$$', high: '$$$', very_high: '$$$$', unknown: 'Sin precio' }
// Sin precio al final, como en la lista de opciones.
const PRICE_OPTIONS: PriceLevel[] = [...PRICE_LEVELS.filter((id) => id !== 'unknown'), 'unknown']
// Cuánto queda "Guardado" en la celda.
const SAVED_FEEDBACK_MS = 2500

/** Opciones del filtro de barrio: los que tienen lugares, con la cantidad. El elegido queda aunque ya no tenga (0). */
function neighborhoodOptions(counts: PlaceNeighborhoodCount[], selected: string | undefined) {
  const all = selected && !counts.some((item) => item.id === selected) ? [...counts, { id: selected, count: 0 }] : counts
  return all
    .map((item) => ({ id: item.id, name: neighborhoodDisplayName(item.id) ?? item.id, count: item.count }))
    .map((item) => ({ ...item, label: `${item.name} (${item.count})` }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}
const selectClass = 'h-9 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

function categoryLabel(id: string) {
  return CATEGORIES[id as keyof typeof CATEGORIES]?.label.es ?? id
}

function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' })
}

const tabOf = (status: PlaceListQuery['status']): Tab => status ?? 'all'

const formatUsd = (value: number) => `US$ ${value.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function formatRating({ rating, userRatingCount }: GoogleRating) {
  if (rating === null) return 'Sin puntaje'
  const value = rating.toLocaleString('es-UY', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return userRatingCount === null ? value : `${value} (${userRatingCount.toLocaleString('es-UY')})`
}

/**
 * Ids ordenados por puntaje; a igual puntaje, más reseñas primero. Los que no tienen puntaje (o todavía no se pidió) van
 * al final, en el orden del servidor.
 */
function sortByRating(ids: string[], ratings: Record<string, GoogleRating>, sort: RatingSort) {
  const sign = sort === 'rating_desc' ? -1 : 1
  return ids
    .map((id, index) => ({ id, index, rating: ratings[id]?.rating ?? null, count: ratings[id]?.userRatingCount ?? 0 }))
    .sort((a, b) => {
      if (a.rating === null || b.rating === null) return a.rating === b.rating ? a.index - b.index : a.rating === null ? 1 : -1
      return sign * (a.rating - b.rating) || b.count - a.count || a.index - b.index
    })
    .map((item) => item.id)
}

/** La página: con el orden por puntaje, todos los ids filtrados, ordenados acá, y la página pedida por ids. */
async function loadPage(query: PlaceListQuery, ratingSort: RatingSort | null, ratings: Record<string, GoogleRating> | null, signal: AbortSignal): Promise<PlaceListPage> {
  if (!ratingSort || !ratings) return listSavedPlaces(query, signal)
  const { ids } = await listSavedPlaceIds(query, signal)
  const ordered = sortByRating(ids, ratings, ratingSort)
  const pageIds = ordered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
  const page = await listSavedPlaces(pageIds.length ? { ...query, ids: pageIds, page: 1 } : query, signal)
  return { ...page, places: pageIds.length ? page.places : [], total: ordered.length }
}

/**
 * Lugares guardados en la base, con búsqueda, filtros, orden y paginación en el servidor. El destacado y Publicar se
 * hacen en la fila; el resto, en el modal de edición (clic en la fila).
 */
export function SavedPlacesPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState<PlaceListQuery>({ sort: 'recent', page: 1, pageSize: PAGE_SIZE })
  // Ids con el destacado guardándose y errores del último intento por fila.
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set())
  const [featuredErrors, setFeaturedErrors] = useState<Record<string, string>>({})
  const [publishing, setPublishing] = useState<ReadonlySet<string>>(new Set())
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({})
  // Precio editado desde la fila: guardando, guardado (unos segundos) o el error, por id.
  const [priceStates, setPriceStates] = useState<Record<string, { status: 'saving' } | { status: 'saved' } | { status: 'error'; message: string }>>({})
  const priceTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [editing, setEditing] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Puntaje de Google por id: sólo en memoria de esta sesión (términos de Google), nunca en la base ni en localStorage.
  const [ratings, setRatings] = useState<Record<string, GoogleRating>>({})
  const [ratingErrors, setRatingErrors] = useState<Record<string, string>>({})
  const [ratingRun, setRatingRun] = useState<RatingRun>({ status: 'idle' })
  const [ratingSort, setRatingSort] = useState<RatingSort | null>(null)
  // Barrios con lugares guardados. Si falla, el filtro sólo ofrece "Todos": no bloquea la lista.
  const [neighborhoods, setNeighborhoods] = useState<PlaceNeighborhoodCount[]>([])

  // Al entrar y con cada recarga (después de guardar o borrar, un barrio puede aparecer o quedar vacío).
  useEffect(() => {
    const controller = new AbortController()
    listSavedNeighborhoods(controller.signal).then(setNeighborhoods).catch(() => {})
    return () => controller.abort()
  }, [attempt])

  // La búsqueda por nombre espera a que se deje de escribir; cambiarla vuelve a la primera página.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery((current) => (current.q ?? '') === search.trim() ? current : { ...current, q: search.trim() || undefined, page: 1 })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  // Sin el orden por puntaje, cargar puntajes no vuelve a pedir la página.
  const sortRatings = ratingSort ? ratings : null
  useEffect(() => {
    const controller = new AbortController()
    loadPage(query, ratingSort, sortRatings, controller.signal)
      .then((page) => setState({ status: 'success', page }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: error instanceof Error ? error.message : 'No se pudieron cargar los lugares.' })
      })
    return () => controller.abort()
  }, [query, attempt, ratingSort, sortRatings])

  function changeSort(value: string) {
    if (value === 'rating_desc' || value === 'rating_asc') {
      setRatingSort(value)
      filter({})
      return
    }
    setRatingSort(null)
    filter({ sort: value as PlaceListQuery['sort'] })
  }

  /** Cuenta los filtrados (todas las páginas) sin puntaje todavía y pide confirmar el costo. */
  async function prepareRatings() {
    setRatingRun({ status: 'counting' })
    try {
      const { ids, withoutGoogleId } = await listSavedPlaceIds(query)
      const without = new Set(withoutGoogleId)
      const pending = ids.filter((id) => !without.has(id) && !ratings[id])
      setRatingRun(pending.length
        ? { status: 'confirm', ids: pending, withoutGoogleId: without.size }
        : { status: 'done', loaded: 0, failed: 0, withoutGoogleId: without.size })
    } catch (error) {
      setRatingRun({ status: 'error', message: error instanceof Error ? error.message : 'No se pudieron contar los lugares.' })
    }
  }

  // En lotes de GOOGLE_RATINGS_BATCH. Un lote que falla entero no corta los demás; lo que falló se vuelve a pedir con el botón.
  async function runRatings(ids: string[]) {
    setRatingRun({ status: 'loading', total: ids.length })
    const loaded: Record<string, GoogleRating> = {}
    const failed: Record<string, string> = {}
    let withoutGoogleId = 0
    let fatal: string | null = null
    for (let start = 0; start < ids.length; start += GOOGLE_RATINGS_BATCH) {
      const batch = ids.slice(start, start + GOOGLE_RATINGS_BATCH)
      try {
        const result = await getGoogleRatings(batch)
        Object.assign(loaded, result.ratings)
        for (const item of result.failed) failed[item.id] = item.message
        withoutGoogleId += result.skipped
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo consultar Google Places.'
        fatal ??= message
        for (const id of batch) failed[id] = message
      }
    }
    setRatings((current) => ({ ...current, ...loaded }))
    setRatingErrors((current) => {
      const next = { ...current, ...failed }
      for (const id of Object.keys(loaded)) delete next[id]
      return next
    })
    const loadedCount = Object.keys(loaded).length
    setRatingRun(loadedCount === 0 && fatal
      ? { status: 'error', message: fatal }
      : { status: 'done', loaded: loadedCount, failed: Object.keys(failed).length, withoutGoogleId })
  }

  /** Cambia un filtro u orden: vuelve a la primera página. */
  function filter(patch: Partial<PlaceListQuery>) {
    setQuery((current) => ({ ...current, ...patch, page: 1 }))
  }

  function retry() {
    setState({ status: 'loading' })
    setAttempt((current) => current + 1)
  }

  /** Vuelve a pedir la página actual sin mostrar el esqueleto (después de publicar, editar o borrar). */
  function refresh() {
    setAttempt((current) => current + 1)
  }

  function updateRow(id: string, patch: Partial<PlaceListItem>) {
    setState((current) => current.status === 'success'
      ? { ...current, page: { ...current.page, places: current.page.places.map((place) => place.id === id ? { ...place, ...patch } : place) } }
      : current)
  }

  // Optimista: se marca enseguida y se revierte si no se pudo guardar.
  async function toggleFeatured(place: PlaceListItem) {
    const featured = !place.featured
    updateRow(place.id, { featured })
    setSaving((current) => new Set(current).add(place.id))
    setFeaturedErrors(({ [place.id]: _previous, ...rest }) => rest)
    try {
      await setPlaceFeatured(place.id, featured)
    } catch (error) {
      updateRow(place.id, { featured: !featured })
      setFeaturedErrors((current) => ({ ...current, [place.id]: error instanceof Error ? error.message : 'No se pudo guardar el destacado.' }))
    } finally {
      setSaving((current) => {
        const next = new Set(current)
        next.delete(place.id)
        return next
      })
    }
  }

  useEffect(() => {
    const timers = priceTimers.current
    return () => timers.forEach((timer) => clearTimeout(timer))
  }, [])

  // Optimista, como el destacado: el precio queda enseguida y vuelve al anterior si no se pudo guardar. Se guarda como la
  // edición del modal (override price), sin abrirlo.
  async function changePrice(place: PlaceListItem, price: PriceLevel) {
    if (price === place.price) return
    clearTimeout(priceTimers.current.get(place.id))
    updateRow(place.id, { price })
    setPriceStates((current) => ({ ...current, [place.id]: { status: 'saving' } }))
    try {
      const { place: saved } = await savePlaceEdit(place.id, { price })
      updateRow(place.id, { price: saved.price, editedFields: saved.editedFields })
      setPriceStates((current) => ({ ...current, [place.id]: { status: 'saved' } }))
      priceTimers.current.set(place.id, setTimeout(() => {
        setPriceStates(({ [place.id]: _previous, ...rest }) => rest)
        priceTimers.current.delete(place.id)
      }, SAVED_FEEDBACK_MS))
    } catch (error) {
      updateRow(place.id, { price: place.price })
      setPriceStates((current) => ({ ...current, [place.id]: { status: 'error', message: error instanceof Error ? error.message : 'No se pudo guardar el precio.' } }))
    }
  }

  // Optimista: queda publicado enseguida; vuelve con el error si no se pudo. Después se recarga la página (sale de "A revisar").
  async function publish(place: PlaceListItem) {
    updateRow(place.id, { status: 'published' })
    setPublishing((current) => new Set(current).add(place.id))
    setPublishErrors(({ [place.id]: _previous, ...rest }) => rest)
    try {
      await publishPlace(place.id)
      refresh()
    } catch (error) {
      updateRow(place.id, { status: place.status })
      setPublishErrors((current) => ({ ...current, [place.id]: error instanceof Error ? error.message : 'No se pudo publicar el lugar.' }))
    } finally {
      setPublishing((current) => {
        const next = new Set(current)
        next.delete(place.id)
        return next
      })
    }
  }

  const page = state.status === 'success' ? state.page : null
  const places = page?.places ?? []
  const tab = tabOf(query.status)
  const reviewTab = tab === 'review'
  const pages = page ? Math.max(1, Math.ceil(page.total / query.pageSize)) : 1
  const filtered = Boolean(query.q || query.neighborhood || query.category || query.edited || query.missing?.length)
  const missing = query.missing ?? []
  const hasRatings = Object.keys(ratings).length > 0
  const showRatings = hasRatings || Object.keys(ratingErrors).length > 0
  const ratingBusy = ratingRun.status === 'counting' || ratingRun.status === 'loading'

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <section aria-labelledby="saved-places-title">
        <div className="mb-7 max-w-2xl">
          <h2 id="saved-places-title" className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
            Lugares
          </h2>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            Lugares guardados en la base. Hacé clic en uno para editarlo: lo que cambies queda editado a mano y el pipeline no lo pisa. En «A revisar» están los que el pipeline no publicó, con su motivo.
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="Filtrar lugares">
          <label className="relative min-w-56 flex-1">
            <span className="sr-only">Buscar por nombre</span>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input className="h-9 pl-8" placeholder="Buscar por nombre" value={search} maxLength={200} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Barrio
            <select className={selectClass} value={query.neighborhood ?? ''} onChange={(event) => filter({ neighborhood: event.target.value || undefined })}>
              <option value="">Todos</option>
              {neighborhoodOptions(neighborhoods, query.neighborhood).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Categoría
            <select className={selectClass} value={query.category ?? ''} onChange={(event) => filter({ category: (event.target.value || undefined) as PlaceListQuery['category'] })}>
              <option value="">Todas</option>
              {PLACE_LIST_CATEGORIES.map((id) => <option key={id} value={id}>{categoryLabel(id)}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Orden
            <select className={selectClass} value={ratingSort ?? query.sort} onChange={(event) => changeSort(event.target.value)}>
              {(Object.keys(SORT_LABELS) as PlaceListQuery['sort'][]).map((id) => <option key={id} value={id}>{SORT_LABELS[id]}</option>)}
              {(Object.keys(RATING_SORT_LABELS) as RatingSort[]).map((id) => (
                <option key={id} value={id} disabled={!hasRatings}>{RATING_SORT_LABELS[id]}</option>
              ))}
            </select>
          </label>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={Boolean(query.edited)} onChange={(event) => filter({ edited: event.target.checked || undefined })} />
            Editado a mano
          </label>
          <Popover>
            <PopoverTrigger render={<Button type="button" variant="outline" className="h-9" aria-label={missing.length ? `Le falta… (${missing.length})` : 'Le falta…'} />}>
              {missing.length ? `Le falta… (${missing.length})` : 'Le falta…'}
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56">
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-xs text-muted-foreground">Le falta cualquiera de estos</legend>
                {PLACE_LIST_MISSING.map((id) => (
                  <label key={id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={missing.includes(id)}
                      onChange={(event) => {
                        const next = event.target.checked ? [...missing, id] : missing.filter((item) => item !== id)
                        filter({ missing: next.length ? PLACE_LIST_MISSING.filter((item) => next.includes(item)) : undefined })
                      }}
                    />
                    {MISSING_LABELS[id]}
                  </label>
                ))}
              </fieldset>
            </PopoverContent>
          </Popover>
          <Button type="button" variant="outline" className="h-9" disabled={ratingBusy} onClick={() => void prepareRatings()}>
            {ratingBusy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Star className="size-3.5" aria-hidden="true" />}
            {ratingRun.status === 'loading' ? `Consultando ${ratingRun.total}…` : 'Ver puntaje de Google'}
          </Button>
        </div>

        <RatingRunStatus run={ratingRun} />

        {notice && (
          <Alert className="mb-4 rounded-xl bg-background">
            <AlertTitle>{notice}</AlertTitle>
          </Alert>
        )}

        {state.status === 'error' && (
          <Alert variant="destructive" className="mb-4 rounded-xl bg-background">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>No se pudieron cargar los lugares</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{state.message}</span>
              <Button type="button" variant="outline" size="sm" onClick={retry}>
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {state.status !== 'error' && (
          <div className="overflow-hidden rounded-xl border bg-background">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 sm:px-5">
              <p className="text-sm font-semibold tabular-nums" role="status">
                {page ? `${page.total} ${page.total === 1 ? 'lugar' : 'lugares'}` : 'Cargando…'}
              </p>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Lugares por status">
                {([['all', 'Todos', page?.counts.all], ['published', 'Publicados', page?.counts.published], ['review', 'A revisar', page?.counts.review]] as const).map(([id, label, count]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => filter({ status: id === 'all' ? undefined : id })}
                    aria-pressed={tab === id}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      tab === id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {count === undefined ? label : `${label} (${count})`}
                  </button>
                ))}
              </div>
            </div>

            {state.status === 'loading' && (
              <div className="p-4 sm:p-5" aria-label="Cargando lugares">
                {[0, 1, 2, 3, 4].map((row) => (
                  <div key={row} className="flex gap-6 border-b py-4 last:border-0">
                    <Skeleton className="h-5 w-2/5" />
                    <Skeleton className="h-5 w-1/4" />
                  </div>
                ))}
              </div>
            )}

            {page && places.length === 0 && (
              <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
                <Database className="mb-4 size-6 text-muted-foreground" aria-hidden="true" />
                <p className="font-medium">
                  {filtered ? 'Ningún lugar coincide con los filtros' : reviewTab ? 'No hay lugares para revisar' : tab === 'published' ? 'No hay lugares publicados' : 'Todavía no hay lugares guardados'}
                </p>
              </div>
            )}

            {places.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="px-4 sm:px-5" aria-sort={!ratingSort && query.sort === 'name' ? 'ascending' : 'none'}>Nombre</TableHead>
                      <TableHead className="px-4 whitespace-nowrap sm:px-5">Google Maps</TableHead>
                      <TableHead className="px-4 sm:px-5">Categorías</TableHead>
                      <TableHead className="px-4 sm:px-5">Instagram</TableHead>
                      <TableHead className="px-4 sm:px-5">Precio</TableHead>
                      {showRatings && (
                        <TableHead className="px-4 whitespace-nowrap sm:px-5" aria-sort={ratingSort === 'rating_desc' ? 'descending' : ratingSort === 'rating_asc' ? 'ascending' : 'none'}>
                          Puntaje de Google
                        </TableHead>
                      )}
                      <TableHead className="px-4 sm:px-5">Logo</TableHead>
                      <TableHead className="px-4 sm:px-5">Barrio</TableHead>
                      <TableHead className="px-4 text-right sm:px-5">Tags</TableHead>
                      <TableHead className="px-4 sm:px-5">Status</TableHead>
                      {reviewTab && <TableHead className="px-4 sm:px-5">Motivos</TableHead>}
                      {reviewTab && <TableHead className="px-4 sm:px-5">Acciones</TableHead>}
                      <TableHead className="px-4 sm:px-5">Horario</TableHead>
                      <TableHead className="px-4 text-center sm:px-5">Embedding</TableHead>
                      <TableHead className="px-4 text-right sm:px-5" aria-sort={!ratingSort && query.sort === 'prominence' ? 'descending' : 'none'}>Prominencia</TableHead>
                      <TableHead className="px-4 text-right sm:px-5">Seguidores</TableHead>
                      <TableHead className="px-4 sm:px-5">Marca</TableHead>
                      <TableHead className="px-4 text-center sm:px-5">Destacado</TableHead>
                      <TableHead className="px-4 sm:px-5" aria-sort={!ratingSort && query.sort === 'recent' ? 'descending' : 'none'}>Última actualización</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {places.map((place) => (
                      <TableRow key={place.id} className="cursor-pointer" onClick={() => setEditing(place.id)}>
                        <TableCell className="px-4 py-3 font-medium sm:px-5">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 text-left hover:underline"
                            onClick={(event) => { event.stopPropagation(); setEditing(place.id) }}
                            aria-label={`Editar ${place.name}`}
                          >
                            {place.name}
                            {place.editedFields.length > 0 && (
                              <PencilLine className="size-3.5 text-amber-700" aria-label="Editado a mano" />
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="px-4 py-3 whitespace-nowrap sm:px-5">
                          <GoogleMapsLink place={place} />
                        </TableCell>
                        <TableCell className="px-4 py-3 text-muted-foreground sm:px-5">
                          {place.categories.length > 0 ? place.categories.map(categoryLabel).join(', ') : '—'}
                        </TableCell>
                        <TableCell className="px-4 py-3 whitespace-nowrap sm:px-5">
                          {place.instagram ? (
                            <a
                              href={`https://www.instagram.com/${place.instagram}/`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                              onClick={(event) => event.stopPropagation()}
                            >
                              @{place.instagram}
                            </a>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="px-4 py-3 sm:px-5" onClick={(event) => event.stopPropagation()}>
                          <select
                            className="h-8 rounded-lg border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
                            value={place.price}
                            disabled={priceStates[place.id]?.status === 'saving'}
                            onChange={(event) => void changePrice(place, event.target.value as PriceLevel)}
                            aria-label={`Precio de ${place.name}`}
                          >
                            {PRICE_OPTIONS.map((id) => <option key={id} value={id}>{PRICE_LABELS[id]}</option>)}
                          </select>
                          <p className="mt-1 min-h-4 text-xs whitespace-nowrap" aria-live="polite" aria-label={`Guardado del precio de ${place.name}`}>
                            {priceStates[place.id]?.status === 'saving' && <span className="text-muted-foreground">Guardando…</span>}
                            {priceStates[place.id]?.status === 'saved' && <span className="text-emerald-700">Guardado</span>}
                          </p>
                          {priceStates[place.id]?.status === 'error' && (
                            <p className="mt-1 max-w-48 text-xs text-destructive" role="alert">
                              {(priceStates[place.id] as { message: string }).message}
                            </p>
                          )}
                        </TableCell>
                        {showRatings && (
                          <TableCell className="px-4 py-3 whitespace-nowrap tabular-nums sm:px-5">
                            {ratings[place.id]
                              ? <span className={ratings[place.id].rating === null ? 'text-muted-foreground' : undefined}>{formatRating(ratings[place.id])}</span>
                              : ratingErrors[place.id]
                                ? <span className="text-destructive" title={ratingErrors[place.id]}>Error</span>
                                : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        )}
                        <TableCell className="px-4 py-3 sm:px-5">
                          <span className="flex items-center gap-2.5">
                            <PlaceIcon category={place.iconCategory} />
                            <PlaceLogo name={place.name} url={place.logoUrl} kind={place.logoKind} bgColor={place.logoBgColor} color={place.logoColor} />
                          </span>
                        </TableCell>
                        <TableCell className="px-4 py-3 text-muted-foreground sm:px-5">{neighborhoodDisplayName(place.neighborhoodId)}</TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums sm:px-5">{place.tags.length}</TableCell>
                        <TableCell className="px-4 py-3 sm:px-5">
                          {STATUS_LABELS[place.status] ?? place.status}
                          {publishErrors[place.id] && (
                            <p className="mt-1 text-xs text-destructive" role="alert">{publishErrors[place.id]}</p>
                          )}
                        </TableCell>
                        {reviewTab && (
                          <TableCell className="px-4 py-3 text-muted-foreground sm:px-5">
                            {place.reviewReasons.length > 0 ? place.reviewReasons.map(reviewReasonLabel).join(' · ') : '—'}
                          </TableCell>
                        )}
                        {reviewTab && (
                          <TableCell className="px-4 py-3 sm:px-5" onClick={(event) => event.stopPropagation()}>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={publishing.has(place.id) || place.status !== 'review'}
                              onClick={() => void publish(place)}
                              aria-label={`Publicar ${place.name}`}
                            >
                              {publishing.has(place.id)
                                ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                                : <Send className="size-3.5" aria-hidden="true" />}
                              Publicar
                            </Button>
                          </TableCell>
                        )}
                        <TableCell className="px-4 py-3 text-muted-foreground sm:px-5">
                          {HOURS_LABELS[place.hoursStatus] ?? place.hoursStatus ?? '—'}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-center sm:px-5">
                          {place.hasEmbedding
                            ? <span className="font-medium text-emerald-700" aria-label="Con embedding">✓</span>
                            : <span className="text-muted-foreground" aria-label="Sin embedding">✗</span>}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums sm:px-5">{place.prominence.toFixed(2)}</TableCell>
                        <TableCell className="px-4 py-3 text-right text-muted-foreground tabular-nums sm:px-5">
                          {place.igFollowers === null ? '—' : place.igFollowers.toLocaleString('es-UY')}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-muted-foreground sm:px-5">{place.brandKey ?? '—'}</TableCell>
                        <TableCell className="px-4 py-3 text-center sm:px-5" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="size-4 cursor-pointer accent-primary disabled:cursor-wait"
                            checked={place.featured}
                            disabled={saving.has(place.id)}
                            onChange={() => void toggleFeatured(place)}
                            aria-label={`Destacar ${place.name}`}
                          />
                          {featuredErrors[place.id] && (
                            <p className="mt-1 text-xs text-destructive" role="alert">{featuredErrors[place.id]}</p>
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums sm:px-5">
                          {formatUpdatedAt(place.updatedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {page && page.total > query.pageSize && (
              <nav className="flex items-center justify-between gap-2 border-t px-4 py-2.5 text-sm sm:px-5" aria-label="Páginas">
                <Button type="button" variant="outline" size="sm" disabled={query.page <= 1} onClick={() => setQuery((current) => ({ ...current, page: current.page - 1 }))}>
                  <ChevronLeft className="size-3.5" aria-hidden="true" />
                  Anterior
                </Button>
                <span className="text-muted-foreground tabular-nums">Página {query.page} de {pages}</span>
                <Button type="button" variant="outline" size="sm" disabled={query.page >= pages} onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}>
                  Siguiente
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </Button>
              </nav>
            )}
          </div>
        )}
      </section>

      <Dialog open={ratingRun.status === 'confirm'} onOpenChange={(open) => { if (!open) setRatingRun({ status: 'idle' }) }}>
        <DialogContent className="sm:max-w-md">
          {ratingRun.status === 'confirm' && (
            <>
              <DialogHeader>
                <DialogTitle>¿Ver el puntaje de Google de {ratingRun.ids.length === 1 ? '1 lugar' : `${ratingRun.ids.length} lugares`}?</DialogTitle>
                <DialogDescription>
                  {ratingRun.ids.length === 1 ? 'Es 1 pedido' : `Son ${ratingRun.ids.length} pedidos`} a Google Place Details Enterprise (sólo rating y cantidad de reseñas),
                  de {formatUsd(PLACE_DETAILS_USD)} cada uno: ≈ {formatUsd(ratingRun.ids.length * PLACE_DETAILS_USD)}. Los primeros 1.000 del mes son gratis.
                  {' '}Son los lugares de los filtros actuales (todas las páginas) que todavía no tienen puntaje en esta sesión.
                  {ratingRun.withoutGoogleId > 0 && ` ${ratingRun.withoutGoogleId} sin Google Place ID quedan afuera.`}
                </DialogDescription>
              </DialogHeader>
              <p className="rounded-lg bg-muted p-3 text-sm">El puntaje sólo se muestra en esta sesión: no se guarda en la base.</p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRatingRun({ status: 'idle' })}>Volver</Button>
                <Button type="button" onClick={() => void runRatings(ratingRun.ids)}>Consultar</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <PlaceEditDialog
        placeId={editing}
        onClose={() => setEditing(null)}
        onSaved={(place) => {
          setNotice(`Se guardó ${place.name}.`)
          refresh()
        }}
        onDeleted={(id) => {
          const name = places.find((place) => place.id === id)?.name ?? 'el lugar'
          setEditing(null)
          setNotice(`Se eliminó ${name}.`)
          refresh()
        }}
      />
    </div>
  )
}

/** Link a la ficha exacta en Google Maps, sin abrir el modal; sin googlePlaceId, un guion. */
function GoogleMapsLink({ place }: { place: PlaceListItem }) {
  const href = googleMapsUrl(place)
  if (!href) return <span className="text-muted-foreground">—</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
      onClick={(event) => event.stopPropagation()}
      aria-label={`Ver ${place.name} en Google Maps`}
    >
      Ver en Maps
      <ArrowUpRight className="size-3.5" aria-hidden="true" />
    </a>
  )
}

/** Resultado de la última consulta del puntaje de Google, debajo de los filtros. */
function RatingRunStatus({ run }: { run: RatingRun }) {
  if (run.status === 'error') {
    return (
      <Alert variant="destructive" className="mb-4 rounded-xl bg-background">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>No se pudo consultar el puntaje de Google</AlertTitle>
        <AlertDescription>{run.message}</AlertDescription>
      </Alert>
    )
  }
  if (run.status !== 'done') return null
  const parts = [
    run.loaded === 0 && run.failed === 0 ? 'Todos los lugares filtrados ya tienen el puntaje de Google.' : `Puntaje de Google de ${run.loaded} ${run.loaded === 1 ? 'lugar' : 'lugares'}.`,
    run.withoutGoogleId > 0 ? `${run.withoutGoogleId} sin Google Place ID.` : '',
  ].filter(Boolean)
  return (
    <div className="mb-4 text-sm" role="status">
      <span className="text-muted-foreground">{parts.join(' ')}</span>
      {run.failed > 0 && (
        <span className="ml-1 text-destructive">
          {run.failed === 1 ? '1 no se pudo consultar' : `${run.failed} no se pudieron consultar`}: volvé a tocar «Ver puntaje de Google» para reintentar sólo esos.
        </span>
      )}
    </div>
  )
}
