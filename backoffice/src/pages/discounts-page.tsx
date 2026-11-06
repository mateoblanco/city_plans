import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, ArrowUpRight, BadgePercent, Check, EyeOff, LoaderCircle, PencilLine, RefreshCw, RotateCcw, Search } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { neighborhoodDisplayName } from '@/data/neighborhood-names'
import {
  confirmDiscountMatch,
  getDiscountRunProgress,
  getDiscounts,
  resetDiscountMatch,
  setDiscountIgnored,
  setDiscountLinks,
  startDiscountRun,
} from '@/lib/discounts-api'
import {
  benefitSummary,
  capLabel,
  CARD_TYPE_LABELS,
  daysLabel,
  DEFAULT_DISCOUNT_FILTERS,
  discountSummary,
  filterDiscountPlaces,
  hasStaleValidity,
  isBenefitCurrent,
  isPlaceCurrent,
  MATCH_LABELS,
  modeLabel,
  ORIGIN_LABELS,
  placeValidity,
  validityLabel,
  type CityFilter,
  type DiscountFilters,
} from '@/lib/discounts'
import { listSavedPlaces } from '@/lib/places-api'
import type { PlaceListItem } from '@/types/places'
import {
  CARD_TYPES,
  MATCH_ORIGINS,
  MATCH_STATUSES,
  type DiscountMatch,
  type DiscountPlace,
  type DiscountRun,
  type DiscountRunProgress,
  type StoredBenefit,
} from '@/types/discounts'

export const POLL_MS = 1_500
export const SEARCH_DEBOUNCE_MS = 300
const SEARCH_PAGE_SIZE = 10

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; run: DiscountRun | null; places: DiscountPlace[] }

/** Estado de una acción en una fila (o en el diálogo). */
type ActionState = { status: 'saving' } | { status: 'saved' } | { status: 'error'; message: string }

const selectClass = 'h-9 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
const CITY_LABELS: Record<CityFilter, string> = { montevideo: 'Montevideo', outside: 'Fuera de Montevideo', all: 'Todas' }
const MATCH_STYLES: Record<DiscountMatch['status'], string> = {
  found: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  doubtful: 'bg-amber-50 text-amber-800 ring-amber-200',
  missing: 'bg-rose-50 text-rose-800 ring-rose-200',
  not_matched: 'bg-muted text-muted-foreground ring-border',
}
const PHASE_LABELS = { listing: 'listado', details: 'detalle', matching: 'cruce con la base' } as const
const SAVED_FEEDBACK_MS = 2500

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
/** El tope de cada beneficio, para el tooltip de la celda (es información extra; lo importante es % y tarjeta). */
function capsTooltip(benefits: StoredBenefit[]): string | undefined {
  const lines = [...new Set(benefits.flatMap((benefit) => (benefit.cap ? [`${CARD_TYPE_LABELS[benefit.cardType]} ${benefit.percent}%: tope ${benefit.cap.amount === null ? benefit.cap.text : capLabel(benefit.cap)}`] : [])))]
  return lines.length ? lines.join('\n') : undefined
}
/** "…/inst/restaurantesplatinum.html" → "restaurantesplatinum.html". */
const pageName = (url: string) => {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() ?? url
  } catch {
    return url
  }
}
const message = (error: unknown) => (error instanceof Error ? error.message : 'No se pudo completar la consulta.')
const neighborhood = (id: string) => neighborhoodDisplayName(id) ?? id
const dateTime = (iso: string) => new Date(iso).toLocaleString('es-UY', { dateStyle: 'medium', timeStyle: 'short' })

function Tag({ children, className = 'bg-muted text-muted-foreground ring-border' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ${className}`}>{children}</span>
}

function MatchBadges({ match }: { match: DiscountMatch }) {
  const wholeBrand = match.links.some((link) => link.wholeBrand)
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Tag className={MATCH_STYLES[match.status]}>{MATCH_LABELS[match.status]}</Tag>
      {match.status !== 'not_matched' && <Tag className={match.origin === 'manual' ? 'bg-sky-50 text-sky-800 ring-sky-200' : undefined}>{ORIGIN_LABELS[match.origin]}</Tag>}
      {wholeBrand && <Tag className="bg-violet-50 text-violet-800 ring-violet-200">Toda la marca</Tag>}
      {match.missingBranches > 0 && (
        <span title={`${plural(match.missingBranches, 'local de la fuente no tiene', 'locales de la fuente no tienen')} un lugar nuestro: se vincularon los que sí.`}>
          <Tag className="bg-orange-50 text-orange-800 ring-orange-200">Faltan sucursales en la base ({match.missingBranches})</Tag>
        </span>
      )}
    </span>
  )
}

function LinkedSummary({ match }: { match: DiscountMatch }) {
  const [first, ...rest] = match.links
  if (first) {
    return (
      <span className="text-sm" title={match.links.map((link) => `${link.name} (${neighborhood(link.neighborhoodId)}) — ${link.reasons.join(', ')}`).join('\n')}>
        {first.name} <span className="text-muted-foreground">· {neighborhood(first.neighborhoodId)}{rest.length > 0 ? ` y ${rest.length} más` : ''}</span>
      </span>
    )
  }
  if (match.candidates.length > 0) {
    const [candidate] = match.candidates
    return (
      <span className="text-sm text-muted-foreground">
        ¿{candidate.name}? · {neighborhood(candidate.neighborhoodId)} · {Math.round(candidate.score * 100)}%
        {match.candidates.length > 1 ? ` y ${match.candidates.length - 1} más` : ''}
      </span>
    )
  }
  return <span className="text-sm text-muted-foreground">—</span>
}

/** Nota (no cambia el estado): lugares nuestros cerca de un local de la fuente que no quedaron vinculados. */
function NearbyNote({ match }: { match: DiscountMatch }) {
  if (match.nearby.length === 0) return null
  const [first, ...rest] = match.nearby
  return (
    <span className="mt-1 block text-xs text-muted-foreground" title={match.nearby.map((item) => `${item.name}, a ${item.meters} m de ${item.address}`).join('\n')}>
      cerca de {first.name}, a {first.meters} m{rest.length ? ` y ${rest.length} más` : ''}
    </span>
  )
}

function RunProgress({ progress, providers }: { progress: DiscountRunProgress; providers: Map<string, string> }) {
  if (progress.status !== 'running') return null
  const provider = providers.get(progress.providerId) ?? progress.providerId
  const step = progress.total ? `${progress.done} de ${progress.total}` : '…'
  const value = progress.total && progress.phase !== 'matching' ? Math.round((progress.done / progress.total) * 100) : null
  return (
    <Alert className="mb-4 rounded-xl bg-background" role="status">
      <LoaderCircle className="animate-spin" aria-hidden="true" />
      <AlertTitle>Actualizando descuentos{provider ? ` · ${provider}` : ''}</AlertTitle>
      <AlertDescription className="grid gap-2">
        <span>{progress.phase === 'matching' ? 'Cruzando con la base y guardando…' : `${PHASE_LABELS[progress.phase]} ${step}`} · empezó {dateTime(progress.startedAt)}</span>
        {value !== null && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso">
            <div className="h-full bg-foreground transition-[width]" style={{ width: `${value}%` }} />
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}

function Summary({ run, shown, places }: { run: DiscountRun | null; shown: DiscountPlace[]; places: DiscountPlace[] }) {
  const summary = discountSummary(shown, places)
  const tiles: [string, number][] = [
    ['Lugares', summary.places],
    ['Beneficios', summary.benefits],
    ['Encontrados', summary.matches.found],
    ['Dudosos', summary.matches.doubtful],
    ['No están en la base', summary.matches.missing],
    ['Fuera de Montevideo', summary.matches.not_matched],
  ]
  const costUsd = run?.providers.reduce((total, provider) => total + provider.llm.costUsd, 0) ?? 0
  const requests = run?.providers.reduce((total, provider) => total + provider.requests, 0) ?? 0
  const notes = run?.providers.flatMap((provider) => (provider.notes ?? []).map((note) => `${provider.name}: ${note}`)) ?? []
  return (
    <div className="mb-4 grid gap-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-background px-4 py-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        {run ? `Última corrida: ${dateTime(run.startedAt)}${run.reparsedFrom ? ` (del HTML guardado de ${run.reparsedFrom})` : ''} · ${requests} pedidos · modelo US$ ${costUsd.toFixed(4)} · ` : ''}
        Según los filtros de la tabla ({plural(summary.manual, 'manual', 'manuales')}). En total: {summary.total.montevideo} de Montevideo · {summary.total.outside} fuera · {plural(summary.total.inactive, 'inactivo', 'inactivos')} · {plural(summary.total.ignored, 'ignorado', 'ignorados')}
      </p>
      {notes.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Notas de la corrida ({notes.length})</summary>
          <ul className="mt-1 grid list-disc gap-0.5 pl-5">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </details>
      )}
    </div>
  )
}

function PartialErrors({ run }: { run: DiscountRun }) {
  const failed = run.providers.filter((provider) => provider.status === 'error')
  if (run.errors.length === 0 && failed.length === 0 && run.warnings.length === 0) return null
  return (
    <Alert className="mb-4 rounded-xl border-amber-200 bg-amber-50/60">
      <AlertCircle aria-hidden="true" />
      <AlertTitle>
        {failed.length > 0 ? `No se pudo leer ${failed.map((provider) => provider.name).join(', ')} (lo guardado no se tocó)` : `${run.errors.length} ${run.errors.length === 1 ? 'página no se pudo leer' : 'páginas no se pudieron leer'}`}
        {run.warnings.length > 0 ? ` · ${run.warnings.length} ${run.warnings.length === 1 ? 'aviso' : 'avisos'}` : ''}
      </AlertTitle>
      <AlertDescription>
        <details>
          <summary className="cursor-pointer">Ver detalle</summary>
          <ul className="mt-2 grid list-disc gap-1 pl-5 text-xs">
            {failed.map((provider) => <li key={provider.providerId}>{provider.name}: {provider.error}</li>)}
            {run.errors.map((error) => <li key={`${error.url}-${error.message}`}><a className="underline" href={error.url} target="_blank" rel="noreferrer">{error.url}</a>: {error.message}</li>)}
            {run.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </details>
      </AlertDescription>
    </Alert>
  )
}

function ActionStatus({ state }: { state: ActionState | undefined }) {
  if (!state) return null
  if (state.status === 'saving') return <span className="text-xs text-muted-foreground" role="status">Guardando…</span>
  if (state.status === 'saved') return <span className="text-xs text-emerald-700" role="status">Guardado</span>
  return <span className="text-xs text-destructive" role="alert">{state.message}</span>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

type SearchState = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'done'; places: PlaceListItem[] }

/** Buscar cualquier lugar nuestro por nombre (GET /api/places?q=, sin acentos). */
function PlaceSearch({ exclude, onPick, disabled }: { exclude: Set<string>; onPick: (place: PlaceListItem) => void; disabled: boolean }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>({ status: 'idle' })

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setState({ status: 'loading' })
      listSavedPlaces({ q, sort: 'name', page: 1, pageSize: SEARCH_PAGE_SIZE }, controller.signal)
        .then((page) => setState({ status: 'done', places: page.places }))
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setState({ status: 'error', message: message(error) })
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const searching = query.trim().length >= 2
  const results = state.status === 'done' && searching ? state.places.filter((place) => !exclude.has(place.id)) : []
  return (
    <div className="grid gap-2">
      <label className="relative">
        <span className="sr-only">Buscar un lugar nuestro</span>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input className="h-9 pl-8" placeholder="Buscar un lugar nuestro por nombre" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {searching && state.status === 'loading' && <p className="text-xs text-muted-foreground">Buscando…</p>}
      {searching && state.status === 'error' && <p className="text-xs text-destructive" role="alert">{state.message}</p>}
      {searching && state.status === 'done' && results.length === 0 && <p className="text-xs text-muted-foreground">Ningún lugar coincide.</p>}
      {results.length > 0 && (
        <ul className="grid gap-1" aria-label="Resultados de la búsqueda">
          {results.map((place) => (
            <li key={place.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{place.name} <span className="text-muted-foreground">· {neighborhood(place.neighborhoodId)}</span></span>
              <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onPick(place)} aria-label={`Vincular ${place.name}`}>Vincular</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Corrección del cruce: vinculados, candidatos, búsqueda, toda la marca y volver a automático. */
function MatchEditor({ place, onChange }: { place: DiscountPlace; onChange: (place: DiscountPlace) => void }) {
  const [state, setState] = useState<ActionState | undefined>()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [wholeBrand, setWholeBrand] = useState(false)
  const saving = state?.status === 'saving'
  const linkedIds = new Set(place.match.links.map((link) => link.placeId))
  const candidates = place.match.candidates.filter((candidate) => !linkedIds.has(candidate.placeId))

  async function act(action: () => Promise<DiscountPlace>) {
    setState({ status: 'saving' })
    try {
      onChange(await action())
      setSelected(new Set())
      setState({ status: 'saved' })
    } catch (error) {
      setState({ status: 'error', message: message(error) })
    }
  }

  // Cualquier cambio deja el cruce manual: los vínculos que ya estaban se conservan (ahora manuales).
  const current = place.match.links.map((link) => ({ placeId: link.placeId, wholeBrand: link.wholeBrand }))
  const link = (ids: string[]) => act(() => setDiscountLinks(place.id, [...current, ...ids.filter((id) => !linkedIds.has(id)).map((placeId) => ({ placeId, wholeBrand }))]))
  const unlink = (placeId: string) => act(() => setDiscountLinks(place.id, current.filter((item) => item.placeId !== placeId)))

  return (
    <section aria-labelledby="match-editor-title" className="grid gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="match-editor-title" className="text-sm font-semibold">Cruce</h3>
        <div className="flex items-center gap-2">
          <MatchBadges match={place.match} />
          <ActionStatus state={state} />
        </div>
      </div>

      <div>
        <h4 className="mb-1 text-xs font-medium text-muted-foreground">Vinculados ({place.match.links.length})</h4>
        {place.match.links.length === 0 && <p className="text-sm text-muted-foreground">Ninguno.</p>}
        <ul className="grid gap-1">
          {place.match.links.map((item) => (
            <li key={item.placeId} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {item.name} <span className="text-muted-foreground">· {neighborhood(item.neighborhoodId)} · {item.reasons.join(', ')}</span>{' '}
                <Tag>{ORIGIN_LABELS[item.origin]}</Tag>{item.wholeBrand && <> <Tag className="bg-violet-50 text-violet-800 ring-violet-200">Toda la marca</Tag></>}
              </span>
              <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void unlink(item.placeId)} aria-label={`Desvincular ${item.name}`}>Desvincular</Button>
            </li>
          ))}
        </ul>
      </div>

      {candidates.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-muted-foreground">Candidatos</legend>
          <ul className="grid gap-1">
            {candidates.map((candidate) => (
              <li key={candidate.placeId}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={selected.has(candidate.placeId)}
                    onChange={(event) => setSelected((items) => {
                      const next = new Set(items)
                      if (event.target.checked) next.add(candidate.placeId)
                      else next.delete(candidate.placeId)
                      return next
                    })}
                  />
                  <span>{candidate.name} <span className="text-muted-foreground">· {neighborhood(candidate.neighborhoodId)} · {Math.round(candidate.score * 100)}% · {candidate.reasons.join(', ')}</span></span>
                </label>
              </li>
            ))}
          </ul>
          <Button type="button" size="sm" className="mt-2" disabled={saving || selected.size === 0} onClick={() => void link([...selected])}>
            Vincular seleccionados{selected.size ? ` (${selected.size})` : ''}
          </Button>
        </fieldset>
      )}

      <div className="grid gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">Vincular otro lugar</h4>
        <PlaceSearch exclude={linkedIds} disabled={saving} onPick={(item) => void link([item.id])} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={wholeBrand} onChange={(event) => setWholeBrand(event.target.checked)} />
          Los que vincule ahora son «toda la marca»
        </label>
        {place.match.origin === 'manual' && (
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void act(() => resetDiscountMatch(place.id))}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Volver a automático
          </Button>
        )}
      </div>
    </section>
  )
}

function BenefitCard({ benefit }: { benefit: StoredBenefit }) {
  return (
    <article className={`rounded-lg border p-3 ${isBenefitCurrent(benefit) ? '' : 'opacity-60'}`}>
      <p className="flex flex-wrap items-center gap-1.5 font-medium">
        {benefit.percent}% · {CARD_TYPE_LABELS[benefit.cardType]}
        {benefit.cardTiers.length > 0 ? ` ${benefit.cardTiers.join(', ')}` : ''}
        {benefit.cardProgram ? ` · sólo ${benefit.cardProgram}` : ''}
        {hasStaleValidity(benefit) && <Tag className="bg-amber-50 text-amber-800 ring-amber-200">Vigencia desactualizada en la fuente</Tag>}
        {!benefit.active && <Tag>{benefit.expired ? 'Vencido' : 'Inactivo'}</Tag>}
      </p>
      <dl className="mt-1">
        <Field label="Modalidad">{modeLabel(benefit)}</Field>
        <Field label="Tope">{capLabel(benefit.cap)}{benefit.cap && benefit.cap.amount !== null ? <span className="text-muted-foreground"> («{benefit.cap.text}»)</span> : null}</Field>
        <Field label="Días">{daysLabel(benefit.days)}{benefit.daysText ? ` («${benefit.daysText}»)` : ''}</Field>
        <Field label="Vigencia">{validityLabel(benefit.validFrom, benefit.validTo)}</Field>
        <Field label="Visto">{dateTime(benefit.firstSeenAt)} – {dateTime(benefit.lastSeenAt)}</Field>
        {benefit.sourceUrl && (
          <Field label="Página">
            <a className="underline" href={benefit.sourceUrl} target="_blank" rel="noreferrer">{pageName(benefit.sourceUrl)}</a>
          </Field>
        )}
        <Field label="Leído con">{benefit.parsedBy === 'html' ? 'Reglas sobre el HTML' : 'Modelo'}</Field>
        <Field label="Condiciones"><span className="whitespace-pre-line">{benefit.conditions ?? '—'}</span></Field>
      </dl>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Texto original</summary>
        <p className="mt-1 whitespace-pre-line">{benefit.sourceText}</p>
      </details>
    </article>
  )
}

function PlaceDialog({ place, providerName, onClose, onChange }: { place: DiscountPlace | null; providerName: string; onClose: () => void; onChange: (place: DiscountPlace) => void }) {
  return (
    <Dialog open={Boolean(place)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        {place && (
          <>
            <DialogHeader className="border-b px-5 py-4">
              <DialogTitle>{place.sourceName}</DialogTitle>
              <DialogDescription>{providerName} · {place.description ?? place.category ?? '—'}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-5 px-5 py-4">
              {place.montevideo ? <MatchEditor key={place.id} place={place} onChange={onChange} /> : <p className="text-sm text-muted-foreground">Fuera de Montevideo: no se cruza.</p>}
              <dl>
                <Field label="Ciudad">{[place.city, place.departments.join(', ')].filter(Boolean).join(' · ') || '—'}</Field>
                <Field label="Instagram">{place.instagram ? `@${place.instagram}` : '—'}</Field>
                <Field label="Web">{place.website ?? '—'}</Field>
                <Field label="Vigencia">{placeValidity(place)}</Field>
                <Field label="Fuente"><a className="inline-flex items-center gap-1 underline" href={place.sourceUrl} target="_blank" rel="noreferrer">Ver en el sitio <ArrowUpRight className="size-3.5" aria-hidden="true" /></a></Field>
                <Field label="Visto">{dateTime(place.firstSeenAt)} – {dateTime(place.lastSeenAt)}{place.active ? '' : ' (no apareció en la última corrida)'}</Field>
              </dl>

              {place.locations.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Locales ({place.locations.length})</h3>
                  <ul className="grid max-h-48 gap-1 overflow-y-auto text-sm">
                    {place.locations.map((location, index) => (
                      <li key={`${location.address}-${index}`}>
                        {location.address}
                        {location.department && <span className="text-muted-foreground"> · {location.department}</span>}
                        {location.mapsUrl && <> · <a className="underline" href={location.mapsUrl} target="_blank" rel="noreferrer">mapa</a></>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-sm font-semibold">Beneficios ({place.benefits.length})</h3>
                {place.benefits.length === 0 && <p className="text-sm text-muted-foreground">No se pudieron leer los beneficios de esta página.</p>}
                <div className="grid gap-3">
                  {[...place.benefits].sort((a, b) => Number(isBenefitCurrent(b)) - Number(isBenefitCurrent(a))).map((benefit) => <BenefitCard key={benefit.id} benefit={benefit} />)}
                </div>
              </section>
              {place.campaign.text && (
                <section>
                  <h3 className="mb-1 text-sm font-semibold">Campaña</h3>
                  <p className="text-sm text-muted-foreground">{place.campaign.text}</p>
                </section>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function DiscountsPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [progress, setProgress] = useState<DiscountRunProgress>({ status: 'idle' })
  const [runError, setRunError] = useState<string | null>(null)
  const [filters, setFilters] = useState<DiscountFilters>(DEFAULT_DISCOUNT_FILTERS)
  const [selected, setSelected] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [rowActions, setRowActions] = useState<Record<string, ActionState>>({})
  const finished = useRef<string | null>(null)
  const feedbackTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getDiscounts(controller.signal), getDiscountRunProgress(controller.signal).catch(() => ({ status: 'idle' }) as const)])
      .then(([data, current]) => {
        setState({ status: 'success', run: data.run, places: data.places })
        setProgress(current)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: message(error) })
      })
    return () => controller.abort()
  }, [attempt])

  useEffect(() => {
    const timers = feedbackTimers.current
    return () => timers.forEach((timer) => clearTimeout(timer))
  }, [])

  const reload = useCallback(async () => {
    try {
      const data = await getDiscounts()
      setState({ status: 'success', run: data.run, places: data.places })
    } catch (error) {
      setRunError(`La corrida terminó pero no se pudo cargar: ${message(error)}`)
    }
  }, [])

  // Mientras corre, se consulta el progreso; al terminar, se recarga lo guardado (o se muestra el error).
  const running = progress.status === 'running'
  useEffect(() => {
    if (!running) return
    let cancelled = false
    const timer = setInterval(() => {
      getDiscountRunProgress()
        .then((next) => {
          if (cancelled) return
          setProgress(next)
          if (next.status === 'done' || next.status === 'error') {
            if (finished.current === next.runId) return
            finished.current = next.runId
            if (next.status === 'error') setRunError(next.message)
            // También con error: un proveedor pudo haberse guardado aunque otro falló.
            void reload()
          }
        })
        .catch(() => {
          // Un corte momentáneo no frena la corrida: se vuelve a consultar en el próximo intervalo.
        })
    }, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [running, reload])

  async function start() {
    setStarting(true)
    setRunError(null)
    try {
      const { runId } = await startDiscountRun()
      setProgress({ status: 'running', runId, startedAt: new Date().toISOString(), providerId: '', phase: 'listing', done: 0, total: null })
    } catch (error) {
      setRunError(message(error))
    } finally {
      setStarting(false)
    }
  }

  const replace = useCallback((place: DiscountPlace) => {
    setState((current) => current.status === 'success' ? { ...current, places: current.places.map((item) => (item.id === place.id ? place : item)) } : current)
  }, [])

  async function rowAction(id: string, action: () => Promise<DiscountPlace>) {
    clearTimeout(feedbackTimers.current.get(id))
    setRowActions((current) => ({ ...current, [id]: { status: 'saving' } }))
    try {
      replace(await action())
      setRowActions((current) => ({ ...current, [id]: { status: 'saved' } }))
      feedbackTimers.current.set(id, setTimeout(() => setRowActions(({ [id]: _done, ...rest }) => rest), SAVED_FEEDBACK_MS))
    } catch (error) {
      setRowActions((current) => ({ ...current, [id]: { status: 'error', message: message(error) } }))
    }
  }

  const data = state.status === 'success' ? state : null
  const places = useMemo(() => data?.places ?? [], [data])
  const providers = useMemo(() => {
    const names = new Map(data?.run?.providers.map((provider) => [provider.providerId, provider.name]) ?? [])
    for (const place of places) if (!names.has(place.providerId)) names.set(place.providerId, place.providerId.toUpperCase())
    return names
  }, [data, places])
  const visible = useMemo(() => filterDiscountPlaces(places, filters), [places, filters])
  const selectedPlace = places.find((place) => place.id === selected) ?? null
  const filtered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_DISCOUNT_FILTERS)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <section aria-labelledby="discounts-title">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <h2 id="discounts-title" className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Descuentos</h2>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              Descuentos gastronómicos de bancos, leídos de sus sitios y cruzados con nuestros lugares (sólo Montevideo). Lo que corregís a mano o ignorás queda así: las corridas siguientes no lo tocan.
            </p>
          </div>
          <Button type="button" className="h-9 shrink-0" disabled={running || starting} onClick={() => void start()}>
            {running || starting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
            {running ? 'Actualizando…' : 'Actualizar descuentos'}
          </Button>
        </div>

        <RunProgress progress={progress} providers={providers} />

        {runError && (
          <Alert variant="destructive" className="mb-4 rounded-xl bg-background">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>No se pudieron actualizar los descuentos</AlertTitle>
            <AlertDescription>{runError}{places.length ? ' Lo guardado no se tocó.' : ''}</AlertDescription>
          </Alert>
        )}

        {state.status === 'error' && (
          <Alert variant="destructive" className="mb-4 rounded-xl bg-background">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>No se pudieron cargar los descuentos</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{state.message}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => { setState({ status: 'loading' }); setAttempt((value) => value + 1) }}>
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {state.status === 'loading' && (
          <div className="rounded-xl border bg-background p-4 sm:p-5" aria-label="Cargando descuentos">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex gap-6 border-b py-4 last:border-0">
                <Skeleton className="h-5 w-2/5" />
                <Skeleton className="h-5 w-1/4" />
              </div>
            ))}
          </div>
        )}

        {data && places.length === 0 && (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border bg-background px-6 py-12 text-center">
            <BadgePercent className="mb-4 size-6 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">Todavía no hay descuentos</p>
            <p className="mt-1 text-sm text-muted-foreground">Tocá «Actualizar descuentos» para leer los proveedores configurados (tarda unos minutos), o llená la base con <code>yarn discounts:reparse</code>.</p>
          </div>
        )}

        {data && places.length > 0 && (
          <>
            <Summary run={data.run} shown={visible} places={places} />
            {data.run && <PartialErrors run={data.run} />}

            <div className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="Filtrar descuentos">
              <label className="grid gap-1 text-xs text-muted-foreground">
                Proveedor
                <select className={selectClass} value={filters.providerId} onChange={(event) => setFilters({ ...filters, providerId: event.target.value })}>
                  <option value="">Todos</option>
                  {[...providers].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Cruce
                <select className={selectClass} value={filters.match} onChange={(event) => setFilters({ ...filters, match: event.target.value as DiscountFilters['match'] })}>
                  <option value="">Todos</option>
                  {MATCH_STATUSES.map((status) => <option key={status} value={status}>{MATCH_LABELS[status]}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Origen
                <select className={selectClass} value={filters.origin} onChange={(event) => setFilters({ ...filters, origin: event.target.value as DiscountFilters['origin'] })}>
                  <option value="">Todos</option>
                  {MATCH_ORIGINS.map((origin) => <option key={origin} value={origin}>{ORIGIN_LABELS[origin]}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Ciudad
                <select className={selectClass} value={filters.city} onChange={(event) => setFilters({ ...filters, city: event.target.value as CityFilter })}>
                  {(Object.keys(CITY_LABELS) as CityFilter[]).map((city) => <option key={city} value={city}>{CITY_LABELS[city]}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Tarjeta
                <select className={selectClass} value={filters.cardType} onChange={(event) => setFilters({ ...filters, cardType: event.target.value as DiscountFilters['cardType'] })}>
                  <option value="">Todas</option>
                  {CARD_TYPES.map((type) => <option key={type} value={type}>{CARD_TYPE_LABELS[type]}</option>)}
                </select>
              </label>
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={filters.showInactive} onChange={(event) => setFilters({ ...filters, showInactive: event.target.checked })} />
                Mostrar inactivos
              </label>
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={filters.showIgnored} onChange={(event) => setFilters({ ...filters, showIgnored: event.target.checked })} />
                Mostrar ignorados
              </label>
              {filtered && (
                <Button type="button" variant="outline" className="h-9" onClick={() => setFilters(DEFAULT_DISCOUNT_FILTERS)}>Limpiar filtros</Button>
              )}
            </div>

            <div className="overflow-hidden rounded-xl border bg-background">
              <div className="border-b px-4 py-2.5 sm:px-5">
                <p className="text-sm font-semibold tabular-nums" role="status">{visible.length} {visible.length === 1 ? 'lugar' : 'lugares'}</p>
              </div>
              {visible.length === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center px-6 py-12 text-center">
                  <BadgePercent className="mb-4 size-6 text-muted-foreground" aria-hidden="true" />
                  <p className="font-medium">Ningún lugar coincide con los filtros</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead className="px-4 sm:px-5">Nombre en la fuente</TableHead>
                        <TableHead className="px-4 sm:px-5">Proveedor</TableHead>
                        <TableHead className="px-4 sm:px-5">Ciudad</TableHead>
                        <TableHead className="px-4 sm:px-5">Cruce</TableHead>
                        <TableHead className="px-4 sm:px-5">Lugar</TableHead>
                        <TableHead className="px-4 sm:px-5">Acciones</TableHead>
                        <TableHead className="px-4 sm:px-5">Beneficios</TableHead>
                        <TableHead className="px-4 sm:px-5">Vigencia</TableHead>
                        <TableHead className="px-4 sm:px-5">Fuente</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.map((place) => {
                        const action = rowActions[place.id]
                        const busy = action?.status === 'saving'
                        const current = isPlaceCurrent(place)
                        const canConfirm = place.match.origin === 'auto' && place.match.links.length > 0
                        return (
                          <TableRow key={place.id} className={`cursor-pointer ${current && !place.ignored ? '' : 'text-muted-foreground'}`} onClick={() => setSelected(place.id)}>
                            <TableCell className="px-4 py-3 font-medium sm:px-5">
                              <button type="button" className="text-left hover:underline" onClick={(event) => { event.stopPropagation(); setSelected(place.id) }}>
                                {place.sourceName}
                              </button>
                              {(!current || place.ignored) && (
                                <span className="mt-1 flex gap-1">
                                  {!current && <Tag>Inactivo</Tag>}
                                  {place.ignored && <Tag>Ignorado</Tag>}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="px-4 py-3 sm:px-5">{providers.get(place.providerId) ?? place.providerId}</TableCell>
                            <TableCell className="px-4 py-3 text-sm sm:px-5">{place.city ?? (place.departments.join(', ') || '—')}</TableCell>
                            <TableCell className="px-4 py-3 sm:px-5"><MatchBadges match={place.match} /></TableCell>
                            <TableCell className="px-4 py-3 sm:px-5"><LinkedSummary match={place.match} /><NearbyNote match={place.match} /></TableCell>
                            <TableCell className="px-4 py-3 sm:px-5" onClick={(event) => event.stopPropagation()}>
                              <div className="flex flex-wrap items-center gap-1">
                                {canConfirm && (
                                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void rowAction(place.id, () => confirmDiscountMatch(place.id))} aria-label={`Confirmar cruce de ${place.sourceName}`}>
                                    <Check className="size-3.5" aria-hidden="true" />
                                    Confirmar
                                  </Button>
                                )}
                                {place.montevideo && (
                                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setSelected(place.id)} aria-label={`Corregir cruce de ${place.sourceName}`}>
                                    <PencilLine className="size-3.5" aria-hidden="true" />
                                    Corregir
                                  </Button>
                                )}
                                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void rowAction(place.id, () => setDiscountIgnored(place.id, !place.ignored))} aria-label={`${place.ignored ? 'Dejar de ignorar' : 'Ignorar'} ${place.sourceName}`}>
                                  <EyeOff className="size-3.5" aria-hidden="true" />
                                  {place.ignored ? 'Dejar de ignorar' : 'Ignorar'}
                                </Button>
                                <ActionStatus state={action} />
                              </div>
                            </TableCell>
                            <TableCell className="px-4 py-3 text-sm sm:px-5" title={capsTooltip(place.benefits.filter(isBenefitCurrent))}>{place.benefits.some(isBenefitCurrent) ? benefitSummary(place.benefits.filter(isBenefitCurrent)) : <span className="text-muted-foreground">Sin vigentes</span>}</TableCell>
                            <TableCell className="px-4 py-3 text-sm whitespace-nowrap sm:px-5">
                              {placeValidity(place)}
                              {place.benefits.some(hasStaleValidity) && (
                                <span className="mt-1 block" title="La fecha de fin ya pasó, pero el lugar sigue publicado en la fuente.">
                                  <Tag className="bg-amber-50 text-amber-800 ring-amber-200">Vigencia desactualizada en la fuente</Tag>
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="px-4 py-3 sm:px-5">
                              <a className="inline-flex items-center gap-1 text-sm underline" href={place.sourceUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                                Ver <ArrowUpRight className="size-3.5" aria-hidden="true" />
                              </a>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        )}
      </section>
      <PlaceDialog
        place={selectedPlace}
        providerName={selectedPlace ? providers.get(selectedPlace.providerId) ?? selectedPlace.providerId : ''}
        onClose={() => setSelected(null)}
        onChange={replace}
      />
    </div>
  )
}
