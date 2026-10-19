import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowDown, ArrowUpDown, Database, LoaderCircle, RotateCcw, Send } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
import { reviewReasonLabel } from '@/data/review-reasons'
import { listSavedPlaces, publishPlace, setPlaceFeatured } from '@/lib/places-api'
import type { PlaceListItem } from '@/types/places'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; places: PlaceListItem[] }

type SortOrder = 'recent' | 'prominence'
type Tab = 'all' | 'review'

const STATUS_LABELS: Record<string, string> = { draft: 'Borrador', published: 'Publicado', review: 'A revisar', hidden: 'Oculto' }
const HOURS_LABELS: Record<string, string> = { exact: 'Exacto', partial: 'Parcial', vague: 'Vago', none: 'Sin horario' }

function categoryLabel(id: string) {
  return CATEGORIES[id as keyof typeof CATEGORIES]?.label.es ?? id
}

function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' })
}

const byRecent = (a: PlaceListItem, b: PlaceListItem) => b.updatedAt.localeCompare(a.updatedAt)
const byProminence = (a: PlaceListItem, b: PlaceListItem) => b.prominence - a.prominence || byRecent(a, b)

/** Lugares guardados en la base. Sólo lectura, salvo el destacado y publicar los que están a revisar (curaduría manual). */
export function SavedPlacesPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [sort, setSort] = useState<SortOrder>('recent')
  // Ids con el destacado guardándose y errores del último intento por fila.
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set())
  const [featuredErrors, setFeaturedErrors] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<Tab>('all')
  const [publishing, setPublishing] = useState<ReadonlySet<string>>(new Set())
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const controller = new AbortController()
    listSavedPlaces(controller.signal)
      .then((places) => setState({ status: 'success', places }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: error instanceof Error ? error.message : 'No se pudieron cargar los lugares.' })
      })
    return () => controller.abort()
  }, [attempt])

  function retry() {
    setState({ status: 'loading' })
    setAttempt((current) => current + 1)
  }

  function updateFeatured(id: string, featured: boolean) {
    setState((current) => current.status === 'success'
      ? { ...current, places: current.places.map((place) => place.id === id ? { ...place, featured } : place) }
      : current)
  }

  // Optimista: se marca enseguida y se revierte si no se pudo guardar.
  async function toggleFeatured(place: PlaceListItem) {
    const featured = !place.featured
    updateFeatured(place.id, featured)
    setSaving((current) => new Set(current).add(place.id))
    setFeaturedErrors(({ [place.id]: _previous, ...rest }) => rest)
    try {
      await setPlaceFeatured(place.id, featured)
    } catch (error) {
      updateFeatured(place.id, !featured)
      setFeaturedErrors((current) => ({ ...current, [place.id]: error instanceof Error ? error.message : 'No se pudo guardar el destacado.' }))
    } finally {
      setSaving((current) => {
        const next = new Set(current)
        next.delete(place.id)
        return next
      })
    }
  }

  function updateStatus(id: string, status: string) {
    setState((current) => current.status === 'success'
      ? { ...current, places: current.places.map((place) => place.id === id ? { ...place, status } : place) }
      : current)
  }

  // Optimista: sale de "A revisar" enseguida y vuelve con el error si no se pudo publicar.
  async function publish(place: PlaceListItem) {
    updateStatus(place.id, 'published')
    setPublishing((current) => new Set(current).add(place.id))
    setPublishErrors(({ [place.id]: _previous, ...rest }) => rest)
    try {
      await publishPlace(place.id)
    } catch (error) {
      updateStatus(place.id, place.status)
      setPublishErrors((current) => ({ ...current, [place.id]: error instanceof Error ? error.message : 'No se pudo publicar el lugar.' }))
    } finally {
      setPublishing((current) => {
        const next = new Set(current)
        next.delete(place.id)
        return next
      })
    }
  }

  const loaded = state.status === 'success' ? state.places : null
  const sorted = useMemo(() => loaded ? [...loaded].sort(sort === 'prominence' ? byProminence : byRecent) : [], [loaded, sort])
  const reviewCount = sorted.filter((place) => place.status === 'review').length
  const places = tab === 'review' ? sorted.filter((place) => place.status === 'review') : sorted
  const reviewTab = tab === 'review'

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <section aria-labelledby="saved-places-title">
        <div className="mb-7 max-w-2xl">
          <h2 id="saved-places-title" className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
            Lugares
          </h2>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            Lugares guardados en la base, del más reciente al más viejo o por prominencia. En «A revisar» están los que el pipeline no publicó, con su motivo.
          </p>
        </div>

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
                {state.status === 'loading' ? 'Cargando…' : `${places.length} ${places.length === 1 ? 'lugar' : 'lugares'}`}
              </p>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Lugares por status">
                {([['all', 'Todos', sorted.length], ['review', 'A revisar', reviewCount]] as const).map(([id, label, count]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    aria-pressed={tab === id}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      tab === id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {state.status === 'success' ? `${label} (${count})` : label}
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

            {state.status === 'success' && places.length === 0 && (
              <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
                <Database className="mb-4 size-6 text-muted-foreground" aria-hidden="true" />
                <p className="font-medium">{reviewTab ? 'No hay lugares para revisar' : 'Todavía no hay lugares guardados'}</p>
              </div>
            )}

            {places.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="px-4 sm:px-5">Nombre</TableHead>
                      <TableHead className="px-4 sm:px-5">Logo</TableHead>
                      <TableHead className="px-4 sm:px-5">Barrio</TableHead>
                      <TableHead className="px-4 sm:px-5">Categorías</TableHead>
                      <TableHead className="px-4 text-right sm:px-5">Tags</TableHead>
                      <TableHead className="px-4 sm:px-5">Status</TableHead>
                      {reviewTab && <TableHead className="px-4 sm:px-5">Motivos</TableHead>}
                      {reviewTab && <TableHead className="px-4 sm:px-5">Acciones</TableHead>}
                      <TableHead className="px-4 sm:px-5">Horario</TableHead>
                      <TableHead className="px-4 text-center sm:px-5">Embedding</TableHead>
                      <TableHead className="px-4 text-right sm:px-5" aria-sort={sort === 'prominence' ? 'descending' : 'none'}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-mr-2 h-7 px-2"
                          onClick={() => setSort((current) => current === 'prominence' ? 'recent' : 'prominence')}
                          title={sort === 'prominence' ? 'Ordenar por más reciente' : 'Ordenar por prominencia'}
                        >
                          Prominencia
                          {sort === 'prominence'
                            ? <ArrowDown className="size-3.5" aria-hidden="true" />
                            : <ArrowUpDown className="size-3.5 text-muted-foreground" aria-hidden="true" />}
                        </Button>
                      </TableHead>
                      <TableHead className="px-4 text-right sm:px-5">Seguidores</TableHead>
                      <TableHead className="px-4 text-center sm:px-5">Destacado</TableHead>
                      <TableHead className="px-4 sm:px-5">Última actualización</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {places.map((place) => (
                      <TableRow key={place.id}>
                        <TableCell className="px-4 py-3 font-medium sm:px-5">{place.name}</TableCell>
                        <TableCell className="px-4 py-3 sm:px-5">
                          <span className="flex items-center gap-2.5">
                            <PlaceIcon category={place.iconCategory} />
                            <PlaceLogo name={place.name} url={place.logoUrl} kind={place.logoKind} bgColor={place.logoBgColor} color={place.logoColor} />
                          </span>
                        </TableCell>
                        <TableCell className="px-4 py-3 text-muted-foreground sm:px-5">{place.neighborhoodId}</TableCell>
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
                          <TableCell className="px-4 py-3 sm:px-5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={publishing.has(place.id)}
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
                        <TableCell className="px-4 py-3 text-center sm:px-5">
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
          </div>
        )}
      </section>
    </div>
  )
}
