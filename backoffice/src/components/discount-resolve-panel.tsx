import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import { ArrowRight, ArrowUpRight, EyeOff, LoaderCircle, MapPin, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { neighborhoodDisplayName } from '@/data/neighborhood-names'
import { getCandidateNames, getOurPlaceSuggestions, lookupPlaceInGoogle, pickPlaceSearchCandidate, searchOurPlaces, setDiscountIgnoredMany, setDiscountLinks } from '@/lib/discounts-api'
import type { ResolveOutcome, ResolveTarget } from '@/lib/discount-resolve'
import { googleMapsUrl } from '@/lib/google-maps-url'
import type { DiscountPlace, GoogleCandidateView, OurPlaceOption, OurPlaceStatus, PlaceSearchJobRow, StoredPlaceSearch } from '@/types/discounts'

export const RESOLVE_SEARCH_DEBOUNCE_MS = 300
/** Lo que cuesta "Buscar en Google" (Text Search Pro), para mostrarlo en el botón. */
const GOOGLE_SEARCH_USD = 0.032

const OUR_STATUS_LABELS: Record<OurPlaceStatus, string> = { published: 'Publicado', review: 'En revisión', hidden: 'Oculto', draft: 'Borrador' }
const OUR_STATUS_STYLES: Record<OurPlaceStatus, string> = {
  published: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  review: 'bg-amber-50 text-amber-800 ring-amber-200',
  hidden: 'bg-muted text-muted-foreground ring-border',
  draft: 'bg-muted text-muted-foreground ring-border',
}
const REASON_LABELS: Record<NonNullable<OurPlaceOption['reason']>, string> = { candidate: 'candidato del cruce', instagram: 'mismo Instagram', near: 'cerca', name: 'nombre parecido' }

const message = (error: unknown) => (error instanceof Error ? error.message : 'No se pudo completar la consulta.')
const neighborhood = (id: string | null) => (id ? neighborhoodDisplayName(id) ?? id : null)
const usd = (value: number) => `US$ ${value.toFixed(3).replace('.', ',')}`

function Tag({ children, className = 'bg-muted text-muted-foreground ring-border' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ${className}`}>{children}</span>
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function OurPlaceItem({ place, linked, busy, onLink }: { place: OurPlaceOption; linked: boolean; busy: boolean; onLink: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border px-3 py-2">
      {place.logoUrl
        ? <img src={place.logoUrl} alt="" width={32} height={32} loading="lazy" className="size-8 shrink-0 rounded-md border object-cover" />
        : <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-xs font-semibold text-muted-foreground">{place.name.slice(0, 1).toUpperCase()}</span>}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{place.name}</span>
          <Tag className={OUR_STATUS_STYLES[place.status]}>{OUR_STATUS_LABELS[place.status]}</Tag>
        </span>
        <span className="text-xs text-muted-foreground">
          {[
            neighborhood(place.neighborhoodId),
            place.categories.slice(0, 3).join(', ') || null,
            place.meters !== null ? `a ${place.meters} m` : null,
            place.score !== null && place.reason !== 'near' ? `${Math.round(place.score * 100)}%` : null,
            place.reason ? REASON_LABELS[place.reason] : null,
            place.instagram ? `@${place.instagram}` : null,
          ].filter(Boolean).join(' · ')}
        </span>
      </span>
      {linked
        ? <Tag className="bg-sky-50 text-sky-800 ring-sky-200">Vinculado</Tag>
        : <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onLink} aria-label={`Vincular ${place.name}`}>Vincular</Button>}
    </li>
  )
}

type Loadable<T> = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'done'; value: T }

/**
 * Panel «Resolver» de un lugar del banco que no cruzó (o quedó dudoso): buscar en todos nuestros lugares y vincular
 * (manual, uno o varios por las sucursales), buscar en Google y agregarlo al pipeline (siempre a "A revisar"), o
 * descartarlo. Los nombres de Google se muestran en el momento y no se guardan.
 */
export function DiscountResolvePanel({
  target, places, search, live, providers, hasNext, finalFocus, onClose, onPlaces, onSearches, onAdded, onDone, onNext,
}: {
  target: ResolveTarget | null
  /** Los lugares del proveedor del target, como están ahora en la pantalla. */
  places: DiscountPlace[]
  /** La búsqueda en Google guardada de la fila (sólo filas de "No están en la base"). */
  search: StoredPlaceSearch | null
  /** La fila en el trabajo de búsqueda en curso, si está ahí. */
  live: PlaceSearchJobRow | null
  providers: Map<string, string>
  hasNext: boolean
  finalFocus?: RefObject<HTMLElement | null>
  onClose: () => void
  onPlaces: (places: DiscountPlace[]) => void
  onSearches: (searches: Record<string, StoredPlaceSearch[]>) => void
  /** Se mandó a extracción: la vista vuelve a consultar el progreso. */
  onAdded: () => void
  onDone: (outcome: ResolveOutcome) => void
  onNext: () => void
}) {
  return (
    <Sheet open={target !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent finalFocus={finalFocus}>
        {target && (
          <PanelBody
            key={target.key}
            target={target}
            places={places}
            search={search}
            live={live}
            providers={providers}
            hasNext={hasNext}
            onClose={onClose}
            onPlaces={onPlaces}
            onSearches={onSearches}
            onAdded={onAdded}
            onDone={onDone}
            onNext={onNext}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function PanelBody({ target, places, search, live, providers, hasNext, onClose, onPlaces, onSearches, onAdded, onDone, onNext }: Omit<Parameters<typeof DiscountResolvePanel>[0], 'target' | 'finalFocus'> & { target: ResolveTarget }) {
  const [query, setQuery] = useState(target.name)
  const [results, setResults] = useState<Loadable<OurPlaceOption[]>>({ status: 'idle' })
  const [suggestions, setSuggestions] = useState<Loadable<OurPlaceOption[]>>({ status: 'loading' })
  const savedCandidates = target.rowKey && search?.candidates.length ? search.candidates.length : 0
  // Sólo al abrir: después de "Buscar de nuevo" la lista ya viene con los nombres.
  const [refreshOnOpen] = useState(() => (savedCandidates > 0 ? target.rowKey : null))
  const [google, setGoogle] = useState<Loadable<GoogleCandidateView[]>>(refreshOnOpen ? { status: 'loading' } : { status: 'idle' })
  const [googleCost, setGoogleCost] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const links = useMemo(() => {
    const byId = new Map<string, { placeId: string; name: string; neighborhoodId: string }>()
    for (const place of places) for (const link of place.match.links) byId.set(link.placeId, link)
    return [...byId.values()]
  }, [places])
  const linkedIds = new Set(links.map((link) => link.placeId))
  const working = live !== null && live.state !== 'done'

  // Sugerencias al abrir: cerca, mismo Instagram, nombres parecidos y candidatos del cruce.
  useEffect(() => {
    const controller = new AbortController()
    getOurPlaceSuggestions({ name: target.name, coordinates: target.coordinates, instagram: target.instagram, candidateIds: target.candidateIds }, controller.signal)
      .then((value) => setSuggestions({ status: 'done', value }))
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setSuggestions({ status: 'error', message: message(failure) })
      })
    return () => controller.abort()
  }, [target])

  // Los candidatos de Google guardados: nombre y dirección de nuevo (de la memoria del servidor o de Google).
  useEffect(() => {
    if (!refreshOnOpen) return
    const controller = new AbortController()
    getCandidateNames(refreshOnOpen, controller.signal)
      .then((response) => {
        setGoogle({ status: 'done', value: response.results })
        setGoogleCost(response.costUsd)
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setGoogle({ status: 'error', message: message(failure) })
      })
    return () => controller.abort()
  }, [refreshOnOpen])

  // Buscador sobre todos nuestros lugares: parcial, sin tildes ni mayúsculas, también por Instagram y marca.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setResults({ status: 'loading' })
      searchOurPlaces(q, target.coordinates, controller.signal)
        .then((value) => setResults({ status: 'done', value }))
        .catch((failure: unknown) => {
          if (!controller.signal.aborted) setResults({ status: 'error', message: message(failure) })
        })
    }, RESOLVE_SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, target.coordinates])

  async function act<T>(action: () => Promise<T>): Promise<T | null> {
    setBusy(true)
    setError(null)
    try {
      return await action()
    } catch (failure) {
      setError(message(failure))
      return null
    } finally {
      setBusy(false)
    }
  }

  /** Vincular nuestro lugar con todos los lugares del proveedor del target (cruce manual; se suman a los que tenían). */
  const link = (placeId: string) => act(async () => {
    const updated = await Promise.all(places.map((place) => setDiscountLinks(place.id, [
      ...place.match.links.map((item) => ({ placeId: item.placeId, wholeBrand: item.wholeBrand })),
      ...(place.match.links.some((item) => item.placeId === placeId) ? [] : [{ placeId, wholeBrand: false }]),
    ])))
    onPlaces(updated)
  })
  const unlink = (placeId: string) => act(async () => {
    onPlaces(await Promise.all(places.map((place) => setDiscountLinks(place.id, place.match.links.filter((item) => item.placeId !== placeId).map((item) => ({ placeId: item.placeId, wholeBrand: item.wholeBrand }))))))
  })
  const discard = () => act(async () => {
    onPlaces(await setDiscountIgnoredMany(target.discountPlaceIds, true))
    onDone('discarded')
  })
  const lookup = () => act(async () => {
    setGoogle({ status: 'loading' })
    try {
      const response = await lookupPlaceInGoogle(target.rowKey!)
      setGoogle({ status: 'done', value: response.results })
      setGoogleCost((cost) => cost + response.costUsd)
      onSearches(response.searches)
    } catch (failure) {
      setGoogle({ status: 'error', message: message(failure) })
    }
  })
  const pick = (placeId: string | null) => act(async () => {
    onSearches(await pickPlaceSearchCandidate(target.rowKey!, placeId))
    if (placeId) onAdded()
    onDone(placeId ? 'added' : 'none')
  })

  const located = target.coordinates ? `${target.coordinates.lat.toFixed(5)}, ${target.coordinates.lng.toFixed(5)}` : null
  const searching = query.trim().length >= 2
  const searched = results.status === 'done' && searching
  const doubtful = search?.status === 'doubtful'
  const suggestionList = suggestions.status === 'done' ? suggestions.value : []
  const near = suggestionList.filter((item) => item.reason === 'near')
  const others = suggestionList.filter((item) => item.reason !== 'near')

  return (
    <>
      <SheetHeader>
        <SheetTitle>Resolver «{target.name}»</SheetTitle>
        <SheetDescription render={<div />} className="grid gap-1">
          <span className="flex flex-wrap items-center gap-1">
            {target.providerIds.map((id) => <Tag key={id}>{providers.get(id) ?? id}</Tag>)}
            {neighborhood(target.neighborhoodId) && <Tag>{neighborhood(target.neighborhoodId)}</Tag>}
          </span>
          <span>{target.address ?? 'Sin dirección en la fuente'}{located ? ` · ${located}` : ''}{target.instagram ? ` · @${target.instagram}` : ''}</span>
          <a className="inline-flex w-fit items-center gap-1 underline" href={target.sourceUrl} target="_blank" rel="noreferrer">Ver en el sitio del banco <ArrowUpRight className="size-3.5" aria-hidden="true" /></a>
        </SheetDescription>
      </SheetHeader>

      <SheetBody>
        {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}

        {links.length > 0 && (
          <Section title={`Vinculados (${links.length})`}>
            <ul className="grid gap-1">
              {links.map((item) => (
                <li key={item.placeId} className="flex items-center justify-between gap-2">
                  <span>{item.name} <span className="text-muted-foreground">· {neighborhood(item.neighborhoodId)}</span></span>
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void unlink(item.placeId)} aria-label={`Desvincular ${item.name}`}>Desvincular</Button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Buscar en mis lugares">
          <label className="relative">
            <span className="sr-only">Buscar en mis lugares</span>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input className="h-9 pl-8" placeholder="Nombre, Instagram o marca" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {searching && results.status === 'loading' && <p className="text-xs text-muted-foreground">Buscando…</p>}
          {searching && results.status === 'error' && <p className="text-xs text-destructive" role="alert">{results.message}</p>}
          {searched && results.value.length === 0 && <p className="text-xs text-muted-foreground">Ningún lugar nuestro coincide con «{query.trim()}».</p>}
          {searched && results.value.length > 0 && (
            <ul className="grid gap-1.5" aria-label="Resultados en mis lugares">
              {results.value.map((place) => <OurPlaceItem key={place.id} place={place} linked={linkedIds.has(place.id)} busy={busy} onLink={() => void link(place.id)} />)}
            </ul>
          )}

          <div className="grid gap-2">
            <h4 className="text-xs font-medium text-muted-foreground">Sugerencias</h4>
            {suggestions.status === 'loading' && <p className="text-xs text-muted-foreground">Buscando sugerencias…</p>}
            {suggestions.status === 'error' && <p className="text-xs text-destructive" role="alert">{suggestions.message}</p>}
            {suggestions.status === 'done' && suggestionList.length === 0 && <p className="text-xs text-muted-foreground">Ningún lugar nuestro cerca ni con un nombre parecido.</p>}
            {near.length > 0 && (
              <ul className="grid gap-1.5" aria-label="Cerca (hasta 300 m)">
                <li className="text-xs text-muted-foreground"><MapPin className="mr-1 inline size-3" aria-hidden="true" />A 300 m o menos, aunque el nombre sea otro</li>
                {near.map((place) => <OurPlaceItem key={place.id} place={place} linked={linkedIds.has(place.id)} busy={busy} onLink={() => void link(place.id)} />)}
              </ul>
            )}
            {others.length > 0 && (
              <ul className="grid gap-1.5" aria-label="Nombres parecidos">
                {others.map((place) => <OurPlaceItem key={place.id} place={place} linked={linkedIds.has(place.id)} busy={busy} onLink={() => void link(place.id)} />)}
              </ul>
            )}
          </div>
        </Section>

        {target.rowKey && (
          <Section
            title="Buscar en Google"
            aside={(
              <Button type="button" size="sm" variant="outline" disabled={busy || working} onClick={() => void lookup()}>
                {google.status === 'loading' ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Search className="size-3.5" aria-hidden="true" />}
                {google.status === 'done' || savedCandidates ? 'Buscar de nuevo' : 'Buscar en Google'} ({usd(GOOGLE_SEARCH_USD)})
              </Button>
            )}
          >
            <p className="text-xs text-muted-foreground">Si no está en nuestra base: busca «{target.name}» con la dirección o el barrio en Montevideo. «Agregar» lo manda a extracción y queda en «A revisar».</p>
            {working && <p className="text-xs text-violet-800" role="status"><LoaderCircle className="mr-1 inline size-3 animate-spin" aria-hidden="true" />{live!.state === 'extracting' ? 'Extrayendo…' : live!.state === 'searching' ? 'Buscando en Google…' : 'En cola…'}</p>}
            {search?.status === 'review' && search.ourPlace && <p className="text-xs text-emerald-800">Agregado: «{search.ourPlace.name}» quedó en revisión.</p>}
            {search?.status === 'not_found' && google.status !== 'done' && <p className="text-xs text-muted-foreground">Marcado como no encontrado en Google.</p>}
            {google.status === 'error' && <p className="text-xs text-destructive" role="alert">{google.message}</p>}
            {google.status === 'done' && google.value.length === 0 && <p className="text-xs text-muted-foreground">Google no trajo ningún lugar de Montevideo.</p>}
            {google.status === 'done' && google.value.length > 0 && (
              <ul className="grid gap-1.5" aria-label="Resultados de Google">
                {google.value.map((result) => {
                  const url = googleMapsUrl({ googlePlaceId: result.placeId, name: result.name ?? target.name })
                  return (
                    <li key={result.placeId} className="grid gap-1 rounded-lg border px-3 py-2">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0">
                          {result.name ? <span className="font-medium">{result.name}</span> : <span className="text-muted-foreground">Google ya no tiene este lugar</span>}
                          <span className="block text-xs text-muted-foreground">
                            {[result.address || null, result.meters !== null ? `a ${result.meters} m` : null].filter(Boolean).join(' · ') || '—'}
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          {url && <a className="inline-flex h-8 items-center gap-1 px-2 text-xs underline" href={url} target="_blank" rel="noreferrer">Google Maps <ArrowUpRight className="size-3" aria-hidden="true" /></a>}
                          {result.ours
                            ? (linkedIds.has(result.ours.id)
                                ? <Tag className="bg-sky-50 text-sky-800 ring-sky-200">Vinculado</Tag>
                                : <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void link(result.ours!.id)} aria-label={`Vincular ${result.ours.name}`}>Vincular</Button>)
                            : <Button type="button" size="sm" variant="outline" disabled={busy || working || !doubtful} onClick={() => void pick(result.placeId)} aria-label={`Agregar ${result.name ?? 'este lugar'}`}><Plus className="size-3.5" aria-hidden="true" />Agregar</Button>}
                        </span>
                      </span>
                      {result.ours && <span className="text-xs text-sky-800">Ya está en tu base: {result.ours.name} ({OUR_STATUS_LABELS[result.ours.status].toLowerCase()})</span>}
                    </li>
                  )
                })}
              </ul>
            )}
            {google.status === 'loading' && <p className="text-xs text-muted-foreground">Pidiendo los datos a Google…</p>}
            <div className="flex items-center justify-between gap-2">
              {doubtful
                ? <Button type="button" size="sm" variant="ghost" disabled={busy || working} onClick={() => void pick(null)} aria-label={`Ninguno para ${target.name}`}>Ninguno</Button>
                : <span />}
              <span className="text-[11px] text-muted-foreground">Datos de Google Maps{googleCost > 0 ? ` · ${usd(googleCost)} en este panel` : ''}</span>
            </div>
          </Section>
        )}
      </SheetBody>

      <SheetFooter>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void discard()} aria-label={`Descartar ${target.name}`}>
          <EyeOff className="size-3.5" aria-hidden="true" />
          Descartar
        </Button>
        <span className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cerrar</Button>
          {hasNext && (
            <Button type="button" disabled={busy} onClick={onNext}>
              Siguiente sin resolver
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Button>
          )}
        </span>
      </SheetFooter>
    </>
  )
}
