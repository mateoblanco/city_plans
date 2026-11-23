import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowLeft, ExternalLink, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { MIN_GUIDE_PLACES, MIN_NEIGHBORHOOD_GUIDES, publishIssues, SEO_DESCRIPTION_MAX, slugify, slugIssues, type GuideGroup } from '@/data/guides'
import { DEFAULT_GUIDE_COLOR, GUIDE_COLOR_FAMILIES, guideColorLabel, type GuideColor } from '@/data/guide-colors'
import { NEIGHBORHOOD_NAMES, neighborhoodDisplayName } from '@/data/neighborhood-names'
import { formatGuideDate, GROUP_OPTIONS, STATUS_LABELS } from '@/lib/guide-labels'
import { formatAiCost, getGuide, getGuideNeighborhoodCounts, guidePreviewUrl, saveGuide, searchPublishedPlaces, setGuidePublished } from '@/lib/guides-api'
import { AiButton, AiCreditNotice } from '@/components/guide-ai'
import { useGuideAi, type GuideAi } from '@/hooks/use-guide-ai'
import { GuideCandidates } from '@/components/guide-candidates'
import { GuideDeleteDialog } from '@/components/guide-delete-dialog'
import type { GuideCandidate, GuideDetail, GuideGenerateDraft, GuideInput, GuideNeighborhoodCountsResponse, GuidePlaceDetail } from '@/types/guides'
import type { PlaceListItem } from '@/types/places'

type Form = Omit<GuideInput, 'places'> & { places: GuidePlaceDetail[] }

const EMPTY: Form = {
  slug: '',
  city: 'montevideo',
  neighborhoodId: null,
  group: 'eat',
  title: '',
  seoTitle: '',
  seoDescription: '',
  intro: '',
  featured: false,
  color: DEFAULT_GUIDE_COLOR,
  places: [],
}

const NEIGHBORHOOD_OPTIONS = Object.keys(NEIGHBORHOOD_NAMES)
  .map((id) => ({ id, name: neighborhoodDisplayName(id) ?? id }))
  .sort((a, b) => a.name.localeCompare(b.name, 'es'))

const formOf = (guide: GuideDetail): Form => ({
  slug: guide.slug,
  city: guide.city,
  neighborhoodId: guide.neighborhoodId,
  group: guide.group,
  title: guide.title,
  seoTitle: guide.seoTitle,
  seoDescription: guide.seoDescription,
  intro: guide.intro,
  featured: guide.featured,
  color: guide.color,
  places: guide.places,
})

const inputOf = (form: Form): GuideInput => ({ ...form, places: form.places.map(({ placeId, text }) => ({ placeId, text })) })

/** Lo del formulario que va a la generación: los lugares sólo como ids (y su texto, para saber cuáles están vacíos). */
const draftOf = (form: Form, idea: string): GuideGenerateDraft => ({
  idea,
  title: form.title,
  intro: form.intro,
  neighborhoodId: form.neighborhoodId,
  group: form.group,
  places: form.places.map(({ placeId, text }) => ({ placeId, text })),
})

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

type Action = 'save' | 'publish' | 'unpublish' | 'preview'
type Notice = { kind: 'success' | 'error'; text: string } | null

const fieldClass = 'grid gap-1.5 text-sm font-medium'
const selectClass = 'h-9 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

type Props = {
  /** null = guía nueva. */
  guideId: string | null
  onBack: () => void
  /** Después de crear: el id nuevo (para que la URL de la pantalla lo use). */
  onCreated?: (id: string) => void
}

/** Crear y editar una guía: todos los campos, los lugares en el orden en que se agregan y publicar con validación. */
export function GuideEditor({ guideId, onBack, onCreated }: Props) {
  const [id, setId] = useState(guideId)
  const [load, setLoad] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' }>(guideId ? { status: 'loading' } : { status: 'ready' })
  const [attempt, setAttempt] = useState(0)
  const [saved, setSaved] = useState<GuideDetail | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [keepDate, setKeepDate] = useState(false)
  const [busy, setBusy] = useState<Action | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  // La idea de la guía: para buscar candidatos y como contexto de la IA. No se guarda.
  const [idea, setIdea] = useState('')
  // El slug sigue al título mientras la guía nunca se publicó y nadie lo tocó a mano.
  const [slugTouched, setSlugTouched] = useState(false)
  const ai = useGuideAi({ initialTotal: 0 })
  // Cuántas guías cuentan para la página de cada barrio en la app (publicadas con algún lugar publicado).
  const [counts, setCounts] = useState<GuideNeighborhoodCountsResponse | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getGuideNeighborhoodCounts(controller.signal).then(setCounts).catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!guideId) return
    const controller = new AbortController()
    getGuide(guideId, controller.signal)
      .then(({ guide }) => {
        setSaved(guide)
        setForm(formOf(guide))
        // Un slug que no es el del título lo puso alguien a mano: no se pisa.
        setSlugTouched(guide.slug !== slugify(guide.title))
        ai.setTotal(guide.aiCostUsd)
        setLoad({ status: 'ready' })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: 'error', message: errorMessage(error, 'No se pudo leer la guía.') })
      })
    return () => controller.abort()
    // ai.setTotal es estable (setState); no hace falta como dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideId, attempt])

  const dirty = useMemo(() => !saved || JSON.stringify(inputOf(form)) !== JSON.stringify(inputOf(formOf(saved))), [form, saved])
  const issues = useMemo(
    () => publishIssues({ ...form, places: form.places.map((place) => ({ placeId: place.placeId, text: place.text, published: place.status === 'published' })) }),
    [form],
  )
  const slugProblems = slugIssues(form.slug)
  const published = saved?.status === 'published'

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setNotice(null)
    setForm((current) => ({ ...current, [key]: value }))
  }

  /** Publicada alguna vez: el slug queda fijo (sólo a mano). */
  const slugLocked = Boolean(saved?.publishedAt)
  const setTitle = (title: string) => {
    setNotice(null)
    setForm((current) => ({ ...current, title, ...(slugLocked || slugTouched ? {} : { slug: slugify(title) }) }))
  }

  const generate = (key: string, request: Parameters<GuideAi['run']>[1]) =>
    ai.run(key, { guideId: id, ...request }, (value) => {
      setNotice(null)
      if (value.kind === 'title') setTitle(value.title)
      else if (value.kind === 'seo') setForm((current) => ({ ...current, seoTitle: value.seoTitle, seoDescription: value.seoDescription }))
      else if (value.kind === 'intro') setForm((current) => ({ ...current, intro: value.intro }))
      else if (value.kind === 'place') setForm((current) => ({ ...current, places: current.places.map((place) => (place.placeId === value.placeId ? { ...place, text: value.text } : place)) }))
      else if (value.kind === 'places-empty') {
        const texts = new Map(value.texts.map((item) => [item.placeId, item.text]))
        // Sólo los que siguen vacíos: si mientras tanto escribiste uno, no se pisa.
        setForm((current) => ({ ...current, places: current.places.map((place) => (!place.text.trim() && texts.has(place.placeId) ? { ...place, text: texts.get(place.placeId)! } : place)) }))
      }
    })

  async function persist(): Promise<GuideDetail> {
    const { guide } = await saveGuide(id, { guide: inputOf(form), keepDate, ...(!id && ai.pending > 0 ? { aiCostUsd: ai.pending } : {}) })
    if (!id) ai.clearPending()
    setSaved(guide)
    setForm(formOf(guide))
    setKeepDate(false)
    if (!id) {
      setId(guide.id)
      onCreated?.(guide.id)
    }
    return guide
  }

  async function run(action: Action) {
    setBusy(action)
    setNotice(null)
    // La pestaña se abre ya (en el click), si no el navegador la bloquea; la URL llega después.
    const preview = action === 'preview' ? window.open('about:blank', '_blank') : null
    try {
      if (action === 'save') {
        await persist()
        setNotice({ kind: 'success', text: 'Guardada.' })
      } else if (action === 'preview') {
        const guide = dirty ? await persist() : saved!
        const url = await guidePreviewUrl(guide.id)
        if (preview) preview.location.href = url
        else window.open(url, '_blank')
      } else {
        const guide = dirty ? await persist() : saved!
        const { guide: updated } = await setGuidePublished(guide.id, action === 'publish')
        setSaved(updated)
        setNotice({ kind: 'success', text: action === 'publish' ? 'Publicada. Aparece en la app cuando vence la caché (horas).' : 'Despublicada. Sale de la app cuando vence la caché.' })
      }
    } catch (error) {
      preview?.close()
      setNotice({ kind: 'error', text: errorMessage(error, 'No se pudo completar.') })
    } finally {
      setBusy(null)
    }
  }

  const addPlace = (place: PlaceListItem) =>
    set('places', [...form.places, { placeId: place.id, text: '', name: place.name, slug: '', neighborhoodId: place.neighborhoodId, status: place.status }])
  /** Un candidato de la búsqueda (todos publicados) al final de la guía, como agregarlo por nombre. */
  const addCandidate = (candidate: GuideCandidate) =>
    set('places', [...form.places, { placeId: candidate.id, text: '', name: candidate.name, slug: '', neighborhoodId: candidate.neighborhood, status: 'published' }])
  const draft = draftOf(form, idea)
  const noPlaces = form.places.length === 0
  const removePlace = (placeId: string) => set('places', form.places.filter((place) => place.placeId !== placeId))
  const setPlaceText = (placeId: string, text: string) => set('places', form.places.map((place) => (place.placeId === placeId ? { ...place, text } : place)))

  if (load.status === 'loading')
    return (
      <div className="grid gap-3 rounded-xl border bg-background p-6" aria-busy="true" aria-label="Cargando guía">
        {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-8 w-full" />)}
      </div>
    )

  if (load.status === 'error')
    return (
      <div className="grid gap-4">
        <BackButton onBack={onBack} />
        <Alert variant="destructive" className="rounded-xl bg-background">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>No se pudo cargar la guía</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{load.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => {
              setLoad({ status: 'loading' })
              setAttempt((value) => value + 1)
            }}>
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <BackButton onBack={onBack} />
        <h3 className="text-xl font-semibold tracking-tight">{id ? form.title || 'Guía sin título' : 'Nueva guía'}</h3>
        {saved && (
          <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${published ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-muted text-muted-foreground'}`}>
            {STATUS_LABELS[saved.status]}
          </span>
        )}
        {dirty && <span className="text-xs text-muted-foreground">Cambios sin guardar</span>}
      </div>

      <AiCreditNotice ai={ai} />

      <section aria-label="Datos de la guía" className="grid gap-4 rounded-xl border bg-background p-5 sm:grid-cols-2">
        <div className={fieldClass}>
          <FieldHeader htmlFor="guide-title" label="Título">
            <AiButton ai={ai} slotKey="title" hasValue={Boolean(form.title)} what="el título" disabled={noPlaces} onClick={() => void generate('title', { kind: 'title', draft })} />
          </FieldHeader>
          <Input id="guide-title" value={form.title} onChange={(event) => setTitle(event.target.value)} placeholder="Cafés donde nadie te apura" />
        </div>
        <label className={fieldClass}>
          Slug
          <Input
            value={form.slug}
            onChange={(event) => {
              setSlugTouched(true)
              set('slug', event.target.value.trim())
            }}
            placeholder="cafes-donde-nadie-te-apura"
            aria-invalid={slugProblems.length > 0}
          />
          <span className="text-xs font-normal text-muted-foreground">
            {slugLocked ? 'Fijo: la guía ya se publicó (cambiarlo rompe los links).' : slugTouched ? 'Editado a mano: ya no sigue al título.' : 'Sale del título mientras la guía no se publique.'}
          </span>
          {slugProblems.map((issue) => <span key={issue.code} className="text-xs font-normal text-destructive">{issue.message}</span>)}
        </label>
        <div className={fieldClass}>
          <label htmlFor="guide-neighborhood">Barrio</label>
          <select
            id="guide-neighborhood"
            className={selectClass}
            value={form.neighborhoodId ?? ''}
            onChange={(event) => set('neighborhoodId', event.target.value || null)}
            aria-describedby={form.neighborhoodId ? 'guide-neighborhood-hint' : undefined}
          >
            <option value="">Toda la ciudad</option>
            {NEIGHBORHOOD_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
          {form.neighborhoodId && <NeighborhoodPageHint counts={counts} neighborhoodId={form.neighborhoodId} />}
        </div>
        <label className={fieldClass}>
          Grupo
          <select className={selectClass} value={form.group} onChange={(event) => set('group', event.target.value as GuideGroup)}>
            {GROUP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <ColorPicker value={form.color} onChange={(color) => set('color', color)} />
        <div className={fieldClass}>
          <FieldHeader htmlFor="guide-seo-title" label="Título para Google">
            <AiButton ai={ai} slotKey="seo" hasValue={Boolean(form.seoTitle || form.seoDescription)} what="el título y la descripción para Google" disabled={noPlaces} onClick={() => void generate('seo', { kind: 'seo', draft })} />
          </FieldHeader>
          <Input id="guide-seo-title" value={form.seoTitle} onChange={(event) => set('seoTitle', event.target.value)} />
          <span className="text-xs font-normal text-muted-foreground">{form.seoTitle.length} caracteres (hasta ~60 se ve entero)</span>
        </div>
        <label className={fieldClass}>
          Descripción para Google
          <Textarea rows={2} value={form.seoDescription} onChange={(event) => set('seoDescription', event.target.value)} />
          <span className={`text-xs font-normal ${form.seoDescription.length > SEO_DESCRIPTION_MAX ? 'text-amber-700' : 'text-muted-foreground'}`}>
            {form.seoDescription.length} / {SEO_DESCRIPTION_MAX} caracteres
          </span>
        </label>
        <div className={`${fieldClass} sm:col-span-2`}>
          <FieldHeader htmlFor="guide-intro" label="Introducción">
            <AiButton ai={ai} slotKey="intro" hasValue={Boolean(form.intro)} what="la introducción" disabled={noPlaces} onClick={() => void generate('intro', { kind: 'intro', draft })} />
          </FieldHeader>
          <Textarea id="guide-intro" rows={5} value={form.intro} onChange={(event) => set('intro', event.target.value)} />
          <span className="text-xs font-normal text-muted-foreground">Separá los párrafos con una línea en blanco.</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm sm:col-span-2">
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" className="size-4 accent-primary" checked={form.featured} onChange={(event) => set('featured', event.target.checked)} />
            Destacada en la página de la ciudad
          </label>
          <span className="text-muted-foreground">Publicada: {formatGuideDate(saved?.publishedAt ?? null)}</span>
          <span className="text-muted-foreground">Actualizada: {formatGuideDate(saved?.contentUpdatedAt ?? null)}</span>
        </div>
      </section>

      <GuideCandidates idea={idea} onIdea={setIdea} neighborhoodId={form.neighborhoodId} group={form.group} added={new Set(form.places.map((place) => place.placeId))} onAdd={addCandidate} />

      <PlacesSection
        places={form.places}
        onAdd={addPlace}
        onRemove={removePlace}
        onText={setPlaceText}
        ai={ai}
        onGenerate={(placeId) => void generate(`place:${placeId}`, { kind: 'place', draft, placeId })}
        onGenerateEmpty={() => void generate('places-empty', { kind: 'places-empty', draft })}
      />

      <section aria-label="Guardar y publicar" className="grid gap-3 rounded-xl border bg-background p-5">
        {issues.length > 0 ? (
          <div className="text-sm">
            <p className="font-medium">Para publicar falta:</p>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {[...new Set(issues.map((issue) => issue.message))].map((text) => <li key={text}>{text}</li>)}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-emerald-800">Lista para publicar.</p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={keepDate} onChange={(event) => setKeepDate(event.target.checked)} />
          Sólo corrección, no cambiar la fecha de actualización
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void run('save')} disabled={busy !== null || !form.slug || !dirty || (published && issues.length > 0)}>
            {busy === 'save' ? 'Guardando…' : 'Guardar'}
          </Button>
          {published ? (
            <Button type="button" variant="outline" onClick={() => void run('unpublish')} disabled={busy !== null}>
              {busy === 'unpublish' ? 'Despublicando…' : 'Despublicar'}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => void run('publish')} disabled={busy !== null || issues.length > 0}>
              {busy === 'publish' ? 'Publicando…' : 'Publicar'}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => void run('preview')} disabled={busy !== null || !form.slug || slugProblems.length > 0}>
            <ExternalLink aria-hidden="true" />
            {busy === 'preview' ? 'Abriendo…' : 'Vista previa'}
          </Button>
          {id && (
            <Button type="button" variant="destructive" className="ml-auto" onClick={() => setConfirmDelete(true)} disabled={busy !== null || published}>
              <Trash2 aria-hidden="true" />
              Eliminar guía
            </Button>
          )}
        </div>
        {id && published && <p className="text-xs text-muted-foreground">Para eliminar una guía publicada, despublicala primero.</p>}
        {published && issues.length > 0 && <p className="text-xs text-muted-foreground">Una guía publicada sólo se guarda completa: despublicala para guardar un borrador.</p>}
        <p className="text-xs text-muted-foreground tabular-nums">
          Gastado en IA en esta guía: {formatAiCost(ai.total)}
          {ai.pending > 0 && ' (se suma a la guía al guardarla)'}
          {ai.status && ` · ${ai.status.model}`}
          {ai.status?.balanceUsd != null && ` · Crédito del Gateway: US$ ${ai.status.balanceUsd.toLocaleString('es-UY', { maximumFractionDigits: 2 })}`}
        </p>
        {notice && (
          <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${notice.kind === 'error' ? 'text-destructive' : 'text-emerald-800'}`}>
            {notice.text}
          </p>
        )}
      </section>
      <GuideDeleteDialog guide={confirmDelete && id ? { id, title: form.title } : null} onClose={() => setConfirmDelete(false)} onDeleted={() => onBack()} />
    </div>
  )
}

/** "La página de este barrio aparece cuando tiene 3 guías publicadas (hoy: N)": la regla de la app (MIN_NEIGHBORHOOD_GUIDES). */
function NeighborhoodPageHint({ counts, neighborhoodId }: { counts: GuideNeighborhoodCountsResponse | null; neighborhoodId: string }) {
  const min = counts?.min ?? MIN_NEIGHBORHOOD_GUIDES
  const today = counts ? (counts.counts[neighborhoodId] ?? 0) : null
  return (
    <span id="guide-neighborhood-hint" className="text-xs font-normal text-muted-foreground">
      {today !== null && today >= min
        ? `La página de este barrio ya aparece: tiene ${today} guías publicadas (mínimo ${min}).`
        : `La página de este barrio aparece cuando tiene ${min} guías publicadas${today === null ? '' : ` (hoy: ${today})`}.`}
    </span>
  )
}

function FieldHeader({ htmlFor, label, children }: { htmlFor: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  )
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onBack}>
      <ArrowLeft aria-hidden="true" />
      Volver al listado
    </Button>
  )
}

type PlacesSectionProps = {
  places: GuidePlaceDetail[]
  onAdd: (place: PlaceListItem) => void
  onRemove: (placeId: string) => void
  onText: (placeId: string, text: string) => void
  ai: GuideAi
  onGenerate: (placeId: string) => void
  onGenerateEmpty: () => void
}

/** Los lugares, numerados en el orden en que se agregaron; sacar uno renumera. Arriba, el buscador de publicados. */
function PlacesSection({ places, onAdd, onRemove, onText, ai, onGenerate, onGenerateEmpty }: PlacesSectionProps) {
  const empty = places.filter((place) => !place.text.trim()).length
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; places: PlaceListItem[] }>({ status: 'idle' })
  const added = new Set(places.map((place) => place.placeId))

  const q = query.trim()
  // Con menos de 2 letras no se busca y no se muestra nada (sin setState en el efecto).
  const shown = q.length < 2 ? ({ status: 'idle' } as const) : results

  useEffect(() => {
    if (q.length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setResults({ status: 'loading' })
      searchPublishedPlaces(q, controller.signal)
        .then((found) => setResults({ status: 'ready', places: found }))
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setResults({ status: 'error', message: errorMessage(error, 'No se pudo buscar.') })
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [q])

  return (
    <section aria-labelledby="guide-places-title" className="grid gap-4 rounded-xl border bg-background p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id="guide-places-title" className="font-semibold">Lugares ({places.length})</h4>
        <span className="text-xs text-muted-foreground">Mínimo {MIN_GUIDE_PLACES} publicados. Salen en el orden en que los agregás.</span>
      </div>
      {places.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <AiButton ai={ai} slotKey="places-empty" hasValue={false} what={`los textos vacíos (${empty})`} disabled={empty === 0} onClick={onGenerateEmpty} />
          <span className="text-xs text-muted-foreground">{empty === 0 ? 'Todos los lugares tienen texto.' : empty === 1 ? 'Genera el texto vacío; no toca los que ya escribiste.' : `Genera los ${empty} textos vacíos; no toca los que ya escribiste.`}</span>
        </div>
      )}

      <div className="grid gap-2">
        <label className="relative">
          <span className="sr-only">Buscar lugares publicados por nombre</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar lugares publicados por nombre" />
        </label>
        {shown.status === 'loading' && <p className="text-sm text-muted-foreground" aria-live="polite">Buscando…</p>}
        {shown.status === 'error' && <p className="text-sm text-destructive" role="alert">{shown.message}</p>}
        {shown.status === 'ready' && shown.places.length === 0 && <p className="text-sm text-muted-foreground">Ningún lugar publicado con ese nombre.</p>}
        {shown.status === 'ready' && shown.places.length > 0 && (
          <ul aria-label="Resultados" className="divide-y rounded-lg border">
            {shown.places.map((place) => (
              <li key={place.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{place.name}</span>
                  <span className="text-muted-foreground"> · {neighborhoodDisplayName(place.neighborhoodId) ?? place.neighborhoodId}</span>
                </span>
                <Button type="button" size="sm" variant="outline" disabled={added.has(place.id)} onClick={() => onAdd(place)} aria-label={added.has(place.id) ? `${place.name} ya está agregado` : `Agregar ${place.name}`}>
                  <Plus aria-hidden="true" />
                  {added.has(place.id) ? 'Agregado' : 'Agregar'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {places.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Todavía no hay lugares. Buscalos arriba y agregalos en el orden en que van.</p>
      ) : (
        <ol className="grid gap-3" aria-label="Lugares de la guía">
          {places.map((place, index) => (
            <li key={place.placeId} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[2rem_1fr_auto]">
              <span className="text-lg font-semibold tabular-nums" aria-hidden="true">{index + 1}</span>
              <div className="grid gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <p>
                  <span className="font-medium">{place.name}</span>
                  <span className="text-muted-foreground"> · {neighborhoodDisplayName(place.neighborhoodId) ?? place.neighborhoodId ?? '—'}</span>
                  {place.status !== 'published' && (
                    <span className="ml-2 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200">No está publicado: la app lo saltea</span>
                  )}
                </p>
                <AiButton ai={ai} slotKey={`place:${place.placeId}`} hasValue={Boolean(place.text.trim())} what={`el texto de ${place.name}`} onClick={() => onGenerate(place.placeId)} />
                </div>
                <Textarea rows={2} value={place.text} onChange={(event) => onText(place.placeId, event.target.value)} aria-label={`Texto de ${place.name}`} placeholder="2–3 líneas: por qué está en la guía." />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(place.placeId)} aria-label={`Sacar ${place.name}`}>
                <X aria-hidden="true" />
                Sacar
              </Button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * El color de la franja de la tarjeta en la app (debajo de los logos): uno de la paleta, agrupado por familia. Radios
 * nativos (flechas y Tab como cualquier grupo), con el nombre accesible "Naranja 2" y una vista previa al lado.
 */
function ColorPicker({ value, onChange }: { value: GuideColor; onChange: (color: GuideColor) => void }) {
  return (
    <fieldset className="grid gap-2 text-sm sm:col-span-2">
      <legend className="mb-1.5 font-medium">Color de la tarjeta</legend>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex max-w-3xl flex-1 flex-wrap gap-x-4 gap-y-2">
          {GUIDE_COLOR_FAMILIES.map((family) => (
            <div key={family.id} className="flex gap-1.5" title={family.name}>
              {family.colors.map((color) => (
                <label key={color} className="relative cursor-pointer">
                  <input
                    type="radio"
                    name="guide-color"
                    className="peer sr-only"
                    value={color}
                    checked={value === color}
                    onChange={() => onChange(color)}
                    aria-label={guideColorLabel(color)}
                  />
                  <span
                    className="block size-7 rounded-full ring-offset-2 ring-offset-background peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring"
                    style={{ backgroundColor: color }}
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="grid justify-items-center gap-1">
          <span className="block h-14 w-24 rounded-lg" style={{ backgroundColor: value }} aria-hidden />
          <span className="text-xs text-muted-foreground">{guideColorLabel(value)}</span>
        </div>
      </div>
    </fieldset>
  )
}
