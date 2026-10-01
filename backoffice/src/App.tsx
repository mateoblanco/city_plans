import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  LoaderCircle,
  MapPin,
  RotateCcw,
  Search,
  Utensils,
} from 'lucide-react'
import { SearchCombobox, type ComboboxOption } from '@/components/search-combobox'
import { PlaceExplorerDialog } from '@/components/place-explorer-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import {
  FOOD_PLACE_TYPE_GROUPS,
  FOOD_PLACE_TYPES,
  getFoodPlaceTypeLabel,
} from '@/data/food-place-types'
import { CATEGORIES } from '@/data/tags'
import { MONTEVIDEO_NEIGHBORHOODS } from '@/data/neighborhoods'
import { searchPlaces } from '@/lib/places-api'
import type { PlaceSummary, PlacesSearchRequest } from '@/types/places'

type SearchStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'partial'

const neighborhoodOptions: readonly ComboboxOption[] = MONTEVIDEO_NEIGHBORHOODS.map(
  (neighborhood) => ({ value: neighborhood, label: neighborhood }),
)

const categoryOptions: readonly ComboboxOption[] = FOOD_PLACE_TYPE_GROUPS.flatMap(
  (group) =>
    FOOD_PLACE_TYPES.filter((type) => type.group === group)
      .map((type) => ({ value: type.value, label: type.label, group }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es')),
)

const seedCategoryOptions: readonly ComboboxOption[] = Object.entries(CATEGORIES)
  .map(([value, definition]) => ({ value, label: definition.label.es }))
  .sort((a, b) => a.label.localeCompare(b.label, 'es'))

function mergePlaces(
  current: readonly PlaceSummary[],
  incoming: readonly PlaceSummary[],
): PlaceSummary[] {
  const byId = new Map(current.map((place) => [place.placeId, place]))
  for (const place of incoming) byId.set(place.placeId, place)
  return [...byId.values()]
}

function App() {
  const [searchMode, setSearchMode] = useState<'filters' | 'text'>('filters')
  const [barrio, setBarrio] = useState('')
  const [placeType, setPlaceType] = useState('')
  const [textQuery, setTextQuery] = useState('')
  const [textSeedCategory, setTextSeedCategory] = useState('')
  const [places, setPlaces] = useState<PlaceSummary[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [pagesLoaded, setPagesLoaded] = useState(0)
  const [activeSearch, setActiveSearch] = useState<PlacesSearchRequest | null>(null)
  const [failedPageToken, setFailedPageToken] = useState<string | undefined>()
  const [selectedPlace, setSelectedPlace] = useState<PlaceSummary | null>(null)
  const abortController = useRef<AbortController | null>(null)

  useEffect(() => () => abortController.current?.abort(), [])

  const activeDescription = useMemo(() => {
    if (!activeSearch) return ''
    return activeSearch.mode === 'filters'
      ? `${getFoodPlaceTypeLabel(activeSearch.placeType)} en ${activeSearch.barrio}`
      : `“${activeSearch.query}” en Montevideo · ${CATEGORIES[activeSearch.seedCategory].label.es}`
  }, [activeSearch])

  async function loadAllPages(
    criteria: PlacesSearchRequest,
    startToken?: string,
    keepCurrentResults = false,
  ) {
    abortController.current?.abort()
    const controller = new AbortController()
    abortController.current = controller

    let accumulated = keepCurrentResults ? [...places] : []
    let pageToken = startToken
    const seenTokens = new Set<string>(startToken ? [startToken] : [])
    let loadedPages = keepCurrentResults ? pagesLoaded : 0

    if (!keepCurrentResults) {
      setPlaces([])
      setPagesLoaded(0)
    }
    setActiveSearch(
      criteria.mode === 'filters'
        ? {
            mode: 'filters',
            barrio: criteria.barrio,
            placeType: criteria.placeType,
          }
        : { mode: 'text', query: criteria.query, seedCategory: criteria.seedCategory },
    )
    setStatus('loading')
    setErrorMessage('')
    setFailedPageToken(undefined)

    try {
      do {
        const response = await searchPlaces(
          { ...criteria, ...(pageToken ? { pageToken } : {}) },
          controller.signal,
        )

        accumulated = mergePlaces(accumulated, response.items)
        loadedPages += 1
        setPlaces(accumulated)
        setPagesLoaded(loadedPages)

        const nextToken = response.nextPageToken ?? undefined
        if (nextToken && seenTokens.has(nextToken)) {
          throw new Error('Google devolvió un token de paginación repetido.')
        }
        if (nextToken) seenTokens.add(nextToken)
        pageToken = nextToken
      } while (pageToken)

      setStatus(accumulated.length > 0 ? 'success' : 'empty')
      setFailedPageToken(undefined)
    } catch (error) {
      if (controller.signal.aborted) return
      setFailedPageToken(pageToken)
      setErrorMessage(
        error instanceof Error ? error.message : 'No se pudo completar la búsqueda.',
      )
      setStatus(accumulated.length > 0 ? 'partial' : 'error')
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (searchMode === 'filters') {
      if (!barrio || !placeType) return
      void loadAllPages({ mode: 'filters', barrio, placeType })
      return
    }

    const query = textQuery.trim()
    if (query.length < 2 || query.length > 200) return
    if (!textSeedCategory || !(textSeedCategory in CATEGORIES)) return
    void loadAllPages({ mode: 'text', query, seedCategory: textSeedCategory as keyof typeof CATEGORIES })
  }

  function retryFailedPage() {
    if (!activeSearch) return
    void loadAllPages(activeSearch, failedPageToken, places.length > 0)
  }

  const isLoading = status === 'loading'
  const hasResults = places.length > 0
  const canSearch = searchMode === 'filters'
    ? Boolean(barrio && placeType)
    : textQuery.trim().length >= 2 && textQuery.trim().length <= 200 && Boolean(textSeedCategory)

  return (
    <div className="min-h-svh bg-[#f7f7f5] text-foreground">
      <header className="border-b border-border/80 bg-background">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex size-10 items-center justify-center rounded-xl bg-foreground text-background">
            <Utensils className="size-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Montevideo
            </p>
            <h1 className="text-lg font-semibold tracking-tight">City Plans Backoffice</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <section aria-labelledby="search-title">
          <div className="mb-7 max-w-2xl">
            <h2 id="search-title" className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              Encontrá lugares gastronómicos
            </h2>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              Buscá por barrio y categoría o escribí el nombre de un lugar específico de Montevideo.
            </p>
          </div>

          <div
            className="mb-3 inline-flex rounded-xl border bg-background p-1"
            aria-label="Modo de búsqueda"
          >
            <button
              type="button"
              onClick={() => setSearchMode('filters')}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                searchMode === 'filters'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={searchMode === 'filters'}
            >
              Barrio y categoría
            </button>
            <button
              type="button"
              onClick={() => setSearchMode('text')}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                searchMode === 'text'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={searchMode === 'text'}
            >
              Texto libre
            </button>
          </div>

          <form
            onSubmit={handleSubmit}
            className={`grid gap-4 rounded-2xl border bg-background p-4 shadow-[0_1px_2px_rgb(0_0_0/0.03)] lg:items-end lg:p-5 ${
              searchMode === 'filters'
                ? 'sm:grid-cols-2 lg:grid-cols-[1fr_1.35fr_auto]'
                : 'sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]'
            }`}
          >
            {searchMode === 'filters' ? (
              <>
                <SearchCombobox
                  id="barrio"
                  label="Barrio"
                  placeholder="Seleccionar barrio"
                  searchPlaceholder="Buscar barrio..."
                  emptyMessage="No encontramos ese barrio."
                  options={neighborhoodOptions}
                  value={barrio}
                  onChange={setBarrio}
                />
                <SearchCombobox
                  id="categoria"
                  label="Categoría"
                  placeholder="Seleccionar categoría"
                  searchPlaceholder="Buscar categoría..."
                  emptyMessage="No encontramos esa categoría."
                  options={categoryOptions}
                  value={placeType}
                  onChange={setPlaceType}
                />
              </>
            ) : (
              <>
                <label htmlFor="text-query" className="grid gap-2 text-sm font-medium">
                  Nombre del lugar
                  <Input
                    id="text-query"
                    value={textQuery}
                    onChange={(event) => setTextQuery(event.target.value)}
                    minLength={2}
                    maxLength={200}
                    placeholder="Ej. Café Brasilero"
                    className="h-11 rounded-xl"
                  />
                </label>
                <SearchCombobox
                  id="categoria-semilla"
                  label="Categoría semilla"
                  placeholder="Seleccionar categoría"
                  searchPlaceholder="Buscar categoría..."
                  emptyMessage="No encontramos esa categoría."
                  options={seedCategoryOptions}
                  value={textSeedCategory}
                  onChange={setTextSeedCategory}
                />
              </>
            )}
            <Button
              type="submit"
              size="lg"
              className="h-11 rounded-xl px-5 sm:col-span-2 lg:col-span-1"
              disabled={!canSearch || isLoading}
            >
              {isLoading ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="size-4" aria-hidden="true" />
              )}
              {isLoading ? 'Buscando' : 'Buscar lugares'}
            </Button>
          </form>
        </section>

        <section className="mt-8" aria-labelledby="results-title">
          {(status === 'error' || status === 'partial') && (
            <Alert variant="destructive" className="mb-4 rounded-xl bg-background">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>
                {status === 'partial' ? 'La búsqueda quedó incompleta' : 'No pudimos buscar lugares'}
              </AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{errorMessage}</span>
                <Button type="button" variant="outline" size="sm" onClick={retryFailedPage}>
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="overflow-hidden rounded-2xl border bg-background shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
            <div className="flex min-h-16 flex-col justify-center gap-1 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h2 id="results-title" className="text-sm font-semibold">
                  Resultados
                </h2>
                <p className="text-sm text-muted-foreground">
                  {activeDescription || 'Todavía no realizaste una búsqueda'}
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm" aria-live="polite">
                {isLoading && <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />}
                {hasResults && (
                  <span className="font-medium tabular-nums">
                    {places.length} {places.length === 1 ? 'lugar' : 'lugares'}
                  </span>
                )}
                {isLoading && pagesLoaded > 0 && (
                  <span className="text-muted-foreground">· buscando más</span>
                )}
                {status === 'success' && (
                  <CheckCircle2 className="size-4 text-emerald-600" aria-label="Búsqueda completa" />
                )}
              </div>
            </div>

            {status === 'idle' && (
              <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
                <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted">
                  <MapPin className="size-5 text-muted-foreground" aria-hidden="true" />
                </div>
                <p className="font-medium">Tu búsqueda empieza acá</p>
                <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                  Seleccioná los dos criterios para consultar lugares en Google Maps.
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
                  Probá con otra categoría o con un barrio cercano.
                </p>
              </div>
            )}

            {status === 'error' && !hasResults && (
              <div className="min-h-40 bg-muted/20" aria-hidden="true" />
            )}

            {hasResults && (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead className="w-1/2 px-4 sm:px-5">Nombre</TableHead>
                        <TableHead className="px-4 sm:px-5">Tipo</TableHead>
                        <TableHead className="px-4 text-right sm:px-5">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {places.map((place) => (
                        <TableRow key={place.placeId}>
                          <TableCell className="px-4 py-3 font-medium sm:px-5">
                            <a
                              href={place.googleMapsUri}
                              target="_blank"
                              rel="noreferrer"
                              className="group inline-flex items-center gap-1.5 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                            >
                              {place.name}
                              <ArrowUpRight
                                className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                                aria-hidden="true"
                              />
                              <span className="sr-only">(abre Google Maps en una nueva pestaña)</span>
                            </a>
                          </TableCell>
                          <TableCell className="px-4 py-3 text-muted-foreground sm:px-5">
                            {place.type}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-right sm:px-5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              aria-label={`Buscar información de ${place.name}`}
                              onClick={() => setSelectedPlace(place)}
                            >
                              <Search className="size-3.5" aria-hidden="true" />
                              Buscar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between gap-4 border-t bg-muted/20 px-4 py-3 sm:px-5">
                  <p className="text-xs text-muted-foreground">
                    {pagesLoaded} {pagesLoaded === 1 ? 'página consultada' : 'páginas consultadas'}
                  </p>
                  <span
                    className="font-sans text-xs font-normal tracking-normal whitespace-nowrap text-[#5e5e5e]"
                    translate="no"
                    aria-label="Google Maps"
                  >
                    Google Maps
                  </span>
                </div>
              </>
            )}
          </div>
        </section>
      </main>
      <PlaceExplorerDialog
        place={selectedPlace}
        onClose={() => setSelectedPlace(null)}
      />
    </div>
  )
}

export default App
