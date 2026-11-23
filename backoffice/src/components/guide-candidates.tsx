import { useState, type FormEvent } from 'react'
import { Check, Plus, Search } from 'lucide-react'
import { PlaceIcon } from '@/components/place-icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { GuideGroup } from '@/data/guides'
import type { IconCategory } from '@/data/icon-categories'
import { neighborhoodDisplayName } from '@/data/neighborhood-names'
import { label } from '@/data/tags'
import { searchGuideCandidates } from '@/lib/guides-api'
import type { GuideCandidate } from '@/types/guides'

const TAGS_SHOWN = 6
const DESCRIPTION_MAX = 160

const short = (text: string | null) => (!text ? null : text.length <= DESCRIPTION_MAX ? text : `${text.slice(0, DESCRIPTION_MAX - 1).replace(/\s+\S*$/, '')}…`)

type State = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; candidates: GuideCandidate[]; notices: string[]; scope: string }

type Props = {
  idea: string
  onIdea: (idea: string) => void
  neighborhoodId: string | null
  group: GuideGroup
  /** Los ids que ya están en la guía (se marcan y no se pueden agregar de nuevo). */
  added: ReadonlySet<string>
  onAdd: (candidate: GuideCandidate) => void
}

/**
 * "Buscar candidatos": la idea pasa por la búsqueda de la app con el barrio (o toda la ciudad) y el grupo de la guía.
 * Hasta 30 lugares con logo, tipo, tags, descripción y por qué aparecieron; "Agregar" lo suma al final de la guía.
 */
export function GuideCandidates({ idea, onIdea, neighborhoodId, group, added, onAdd }: Props) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const scope = neighborhoodId ? (neighborhoodDisplayName(neighborhoodId) ?? neighborhoodId) : 'toda la ciudad'

  async function search(event: FormEvent) {
    event.preventDefault()
    if (idea.trim().length < 2) return
    setState({ status: 'loading' })
    try {
      const { candidates, notices } = await searchGuideCandidates(idea.trim(), neighborhoodId, group)
      setState({ status: 'ready', candidates, notices, scope })
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'No se pudo buscar.' })
    }
  }

  return (
    <section aria-labelledby="guide-candidates-title" className="grid gap-4 rounded-xl border bg-background p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id="guide-candidates-title" className="font-semibold">Buscar candidatos</h4>
        <span className="text-xs text-muted-foreground">Con la búsqueda de la app, en {scope} y en el grupo de la guía.</span>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => void search(event)}>
        <label className="min-w-64 flex-1">
          <span className="sr-only">Idea</span>
          <Input value={idea} onChange={(event) => onIdea(event.target.value)} placeholder="Idea: cafés tranquilos para trabajar" maxLength={200} />
        </label>
        <Button type="submit" disabled={idea.trim().length < 2 || state.status === 'loading'}>
          <Search aria-hidden="true" />
          {state.status === 'loading' ? 'Buscando…' : 'Buscar lugares'}
        </Button>
      </form>

      {state.status === 'loading' && <p className="text-sm text-muted-foreground" aria-live="polite">Buscando en la app…</p>}
      {state.status === 'error' && <p className="text-sm text-destructive" role="alert">{state.message}</p>}
      {state.status === 'ready' && state.notices.map((notice) => <p key={notice} className="text-xs text-muted-foreground">{notice}</p>)}
      {state.status === 'ready' && state.candidates.length === 0 && <p className="text-sm text-muted-foreground">Ningún lugar para esa idea en {state.scope}.</p>}
      {state.status === 'ready' && state.candidates.length > 0 && (
        <ul aria-label="Candidatos" className="grid gap-2 md:grid-cols-2">
          {state.candidates.map((candidate) => {
            const inGuide = added.has(candidate.id)
            return (
              <li key={candidate.id} className={`flex gap-3 rounded-lg border p-3 ${inGuide ? 'bg-muted/50' : ''}`}>
                <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white text-xl" style={candidate.logoBgColor ? { backgroundColor: candidate.logoBgColor } : undefined}>
                  {candidate.logoUrl ? <img src={candidate.logoUrl} alt="" className="size-full object-contain" loading="lazy" /> : <PlaceIcon category={candidate.iconCategory as IconCategory | null} />}
                </div>
                <div className="grid min-w-0 flex-1 gap-1 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0">
                      <span className="font-medium">{candidate.name}</span>
                      <span className="text-muted-foreground">
                        {' · '}
                        {neighborhoodDisplayName(candidate.neighborhood) ?? candidate.neighborhood}
                        {candidate.categories[0] ? ` · ${label(candidate.categories[0], 'es')}` : ''}
                      </span>
                    </p>
                    {inGuide ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-800">
                        <Check className="size-3.5" aria-hidden="true" />
                        En la guía
                      </span>
                    ) : (
                      <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => onAdd(candidate)} aria-label={`Agregar ${candidate.name} a la guía`}>
                        <Plus aria-hidden="true" />
                        Agregar
                      </Button>
                    )}
                  </div>
                  {candidate.tags.length > 0 && (
                    <p className="flex flex-wrap gap-1">
                      {candidate.tags.slice(0, TAGS_SHOWN).map((tag) => (
                        <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{label(tag, 'es')}</span>
                      ))}
                    </p>
                  )}
                  {short(candidate.description) && <p className="text-xs text-muted-foreground">{short(candidate.description)}</p>}
                  {candidate.reasons.length > 0 && <p className="text-xs"><span className="font-medium">Por qué apareció:</span> {candidate.reasons.join(' · ')}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
