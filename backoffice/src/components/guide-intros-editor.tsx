import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { MIN_NEIGHBORHOOD_GUIDES, seoDescriptionFromIntro } from '@/data/guides'
import { NEIGHBORHOOD_NAMES, neighborhoodDisplayName } from '@/data/neighborhood-names'
import { formatGuideDate } from '@/lib/guide-labels'
import { formatAiCost, listGuideIntros, listGuides, saveGuideIntro } from '@/lib/guides-api'
import { AiButton, AiCreditNotice } from '@/components/guide-ai'
import { useGuideAi, type GuideAi } from '@/hooks/use-guide-ai'
import type { GuideIntro } from '@/types/guides'

const selectClass = 'h-9 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)
const nameOf = (id: string) => neighborhoodDisplayName(id) ?? id

type Ready = { intros: GuideIntro[]; withGuides: string[] }

/** Un texto por ciudad y por barrio: el de la ciudad, los barrios con guías o con texto, y "Agregar barrio". */
export function GuideIntrosEditor() {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & Ready)>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [extra, setExtra] = useState<string[]>([])
  const [adding, setAdding] = useState('')
  // La IA de las intros: costo por generación (no hay una guía a la que sumarlo).
  const ai = useGuideAi({ initialTotal: 0 })

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([listGuideIntros(controller.signal), listGuides({}, controller.signal)])
      .then(([{ intros }, { neighborhoods }]) => setState({ status: 'ready', intros, withGuides: neighborhoods }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: errorMessage(error, 'No se pudieron leer las introducciones.') })
      })
    return () => controller.abort()
  }, [attempt])

  const neighborhoods = useMemo(() => {
    if (state.status !== 'ready') return []
    const ids = new Set([...state.withGuides, ...state.intros.flatMap((intro) => (intro.neighborhoodId ? [intro.neighborhoodId] : [])), ...extra])
    return [...ids].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'es'))
  }, [state, extra])

  if (state.status === 'loading')
    return (
      <div className="grid gap-2 rounded-xl border bg-background p-4" aria-busy="true" aria-label="Cargando introducciones">
        {[0, 1].map((index) => <Skeleton key={index} className="h-20 w-full" />)}
      </div>
    )

  if (state.status === 'error')
    return (
      <Alert variant="destructive" className="rounded-xl bg-background">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>No se pudieron cargar las introducciones</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>{state.message}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => {
            setState({ status: 'loading' })
            setAttempt((value) => value + 1)
          }}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    )

  const find = (id: string | null) => state.intros.find((intro) => intro.neighborhoodId === id) ?? null
  const onSaved = (intros: GuideIntro[]) => setState((current) => (current.status === 'ready' ? { ...current, intros } : current))
  const available = Object.keys(NEIGHBORHOOD_NAMES).filter((id) => !neighborhoods.includes(id)).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'es'))

  return (
    <div className="grid gap-4">
      <AiCreditNotice ai={ai} />
      <IntroBlock ai={ai} title="Montevideo (página de la ciudad)" neighborhoodId={null} saved={find(null)} onSaved={onSaved} />
      {neighborhoods.map((id) => (
        <IntroBlock key={id} ai={ai} title={nameOf(id)} neighborhoodId={id} saved={find(id)} onSaved={onSaved} note={`Su página aparece en la app cuando tiene ${MIN_NEIGHBORHOOD_GUIDES} guías publicadas.`} />
      ))}
      {ai.total > 0 && <p className="text-xs text-muted-foreground tabular-nums">Gastado en IA en esta sesión: {formatAiCost(ai.total)}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Agregar barrio
          <select aria-label="Agregar barrio" className={selectClass} value={adding} onChange={(event) => setAdding(event.target.value)}>
            <option value="">Elegí un barrio</option>
            {available.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
          </select>
        </label>
        <Button type="button" variant="outline" disabled={!adding} onClick={() => {
          setExtra((current) => [...current, adding])
          setAdding('')
        }}>
          Agregar
        </Button>
      </div>
    </div>
  )
}

type IntroBlockProps = {
  ai: GuideAi
  title: string
  neighborhoodId: string | null
  saved: GuideIntro | null
  onSaved: (intros: GuideIntro[]) => void
  note?: string
}

function IntroBlock({ ai, title, neighborhoodId, saved, onSaved, note }: IntroBlockProps) {
  const [text, setText] = useState(saved?.intro ?? '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const dirty = text.trim() !== (saved?.intro ?? '')
  const id = `intro-${neighborhoodId ?? 'city'}`
  const description = seoDescriptionFromIntro(text)

  async function save() {
    setBusy(true)
    setNotice(null)
    try {
      onSaved((await saveGuideIntro('montevideo', neighborhoodId, text.trim())).intros)
      setNotice({ kind: 'success', text: text.trim() ? 'Guardada.' : 'Borrada.' })
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, 'No se pudo guardar.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-2 rounded-xl border bg-background p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id={`${id}-title`} className="font-semibold">{title}</h4>
        <span className="text-xs text-muted-foreground">Actualizada: {formatGuideDate(saved?.updatedAt ?? null)}</span>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <div>
        <AiButton
          ai={ai}
          slotKey={`intro:${neighborhoodId ?? 'city'}`}
          hasValue={Boolean(text.trim())}
          what={`la introducción de ${title}`}
          onClick={() =>
            void ai.run(`intro:${neighborhoodId ?? 'city'}`, neighborhoodId ? { kind: 'neighborhood-intro', neighborhoodId } : { kind: 'city-intro' }, (value) => {
              if (value.kind === 'area-intro') {
                setText(value.intro)
                setNotice(null)
              }
            })
          }
        />
      </div>
      <Textarea rows={4} value={text} onChange={(event) => {
        setText(event.target.value)
        setNotice(null)
      }} aria-labelledby={`${id}-title`} />
      <p className="text-xs text-muted-foreground">
        Párrafos separados por una línea en blanco. Descripción para Google: {description ? `«${description}»` : 'la plantilla (sin introducción)'}.
      </p>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? 'Guardando…' : 'Guardar'}
        </Button>
        {notice && <span role={notice.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${notice.kind === 'error' ? 'text-destructive' : 'text-emerald-800'}`}>{notice.text}</span>}
      </div>
    </section>
  )
}
