import { useEffect, useState } from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Database, LoaderCircle, PencilLine, RotateCcw, Search, Send } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlaceEditDialog } from '@/components/place-edit-dialog'
import { PlaceIcon } from '@/components/place-icon'
import { PlaceLogo } from '@/components/place-logo'
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
import { NEIGHBORHOOD_NAMES, neighborhoodDisplayName } from '@/data/neighborhood-names'
import { reviewReasonLabel } from '@/data/review-reasons'
import { listSavedPlaces, publishPlace, setPlaceFeatured } from '@/lib/places-api'
import { PLACE_LIST_CATEGORIES, type PlaceListItem, type PlaceListPage, type PlaceListQuery } from '@/types/places'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; page: PlaceListPage }

type Tab = 'all' | 'published' | 'review'

export const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300
const STATUS_LABELS: Record<string, string> = { draft: 'Borrador', published: 'Publicado', review: 'A revisar', hidden: 'Oculto' }
const HOURS_LABELS: Record<string, string> = { exact: 'Exacto', partial: 'Parcial', vague: 'Vago', none: 'Sin horario' }
const SORT_LABELS: Record<PlaceListQuery['sort'], string> = { recent: 'Más reciente', prominence: 'Prominencia', name: 'Nombre' }
// Los ids del shapefile con su nombre (sin cargar barrios.json, que es el GeoJSON entero).
const NEIGHBORHOOD_OPTIONS = Object.entries(NEIGHBORHOOD_NAMES)
  .map(([id, name]) => ({ id, name }))
  .sort((a, b) => a.name.localeCompare(b.name, 'es'))
const selectClass = 'h-9 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

function categoryLabel(id: string) {
  return CATEGORIES[id as keyof typeof CATEGORIES]?.label.es ?? id
}

function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' })
}

const tabOf = (status: PlaceListQuery['status']): Tab => status ?? 'all'

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
  const [editing, setEditing] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // La búsqueda por nombre espera a que se deje de escribir; cambiarla vuelve a la primera página.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery((current) => (current.q ?? '') === search.trim() ? current : { ...current, q: search.trim() || undefined, page: 1 })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const controller = new AbortController()
    listSavedPlaces(query, controller.signal)
      .then((page) => setState({ status: 'success', page }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: error instanceof Error ? error.message : 'No se pudieron cargar los lugares.' })
      })
    return () => controller.abort()
  }, [query, attempt])

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
  const filtered = Boolean(query.q || query.neighborhood || query.category || query.edited || query.noLogo || query.noHours)

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
              {NEIGHBORHOOD_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
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
            <select className={selectClass} value={query.sort} onChange={(event) => filter({ sort: event.target.value as PlaceListQuery['sort'] })}>
              {(Object.keys(SORT_LABELS) as PlaceListQuery['sort'][]).map((id) => <option key={id} value={id}>{SORT_LABELS[id]}</option>)}
            </select>
          </label>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={Boolean(query.edited)} onChange={(event) => filter({ edited: event.target.checked || undefined })} />
            Editado a mano
          </label>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={Boolean(query.noLogo)} onChange={(event) => filter({ noLogo: event.target.checked || undefined })} />
            Sin logo
          </label>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={Boolean(query.noHours)} onChange={(event) => filter({ noHours: event.target.checked || undefined })} />
            Sin horario
          </label>
        </div>

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
                      <TableHead className="px-4 sm:px-5" aria-sort={query.sort === 'name' ? 'ascending' : 'none'}>Nombre</TableHead>
                      <TableHead className="px-4 sm:px-5">Logo</TableHead>
                      <TableHead className="px-4 sm:px-5">Barrio</TableHead>
                      <TableHead className="px-4 sm:px-5">Categorías</TableHead>
                      <TableHead className="px-4 text-right sm:px-5">Tags</TableHead>
                      <TableHead className="px-4 sm:px-5">Status</TableHead>
                      {reviewTab && <TableHead className="px-4 sm:px-5">Motivos</TableHead>}
                      {reviewTab && <TableHead className="px-4 sm:px-5">Acciones</TableHead>}
                      <TableHead className="px-4 sm:px-5">Horario</TableHead>
                      <TableHead className="px-4 text-center sm:px-5">Embedding</TableHead>
                      <TableHead className="px-4 text-right sm:px-5" aria-sort={query.sort === 'prominence' ? 'descending' : 'none'}>Prominencia</TableHead>
                      <TableHead className="px-4 text-right sm:px-5">Seguidores</TableHead>
                      <TableHead className="px-4 sm:px-5">Marca</TableHead>
                      <TableHead className="px-4 sm:px-5">Instagram</TableHead>
                      <TableHead className="px-4 text-center sm:px-5">Destacado</TableHead>
                      <TableHead className="px-4 sm:px-5" aria-sort={query.sort === 'recent' ? 'descending' : 'none'}>Última actualización</TableHead>
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
                        <TableCell className="px-4 py-3 sm:px-5">
                          <span className="flex items-center gap-2.5">
                            <PlaceIcon category={place.iconCategory} />
                            <PlaceLogo name={place.name} url={place.logoUrl} kind={place.logoKind} bgColor={place.logoBgColor} color={place.logoColor} />
                          </span>
                        </TableCell>
                        <TableCell className="px-4 py-3 text-muted-foreground sm:px-5">{neighborhoodDisplayName(place.neighborhoodId)}</TableCell>
                        <TableCell className="px-4 py-3 text-muted-foreground sm:px-5">
                          {place.categories.length > 0 ? place.categories.map(categoryLabel).join(', ') : '—'}
                        </TableCell>
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
