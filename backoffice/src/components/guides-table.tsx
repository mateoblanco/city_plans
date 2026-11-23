import { useEffect, useState } from 'react'
import { AlertCircle, AlertTriangle, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { GuideDeleteDialog } from '@/components/guide-delete-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { neighborhoodDisplayName } from '@/data/neighborhood-names'
import { formatGuideDate, groupLabel, GROUP_OPTIONS, guideScope, STATUS_LABELS, warningLabel } from '@/lib/guide-labels'
import { listGuides, setGuideFeatured, type GuideListFilters } from '@/lib/guides-api'
import type { GuideListResponse, GuideSummary } from '@/types/guides'

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: GuideListResponse }

const selectClass = 'h-9 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

type Props = {
  onOpen: (id: string) => void
  onCreate: () => void
}

/** El listado de guías: filtros en el servidor, featured desde la fila y los avisos de las publicadas. */
export function GuidesTable({ onOpen, onCreate }: Props) {
  const [filters, setFilters] = useState<GuideListFilters>({})
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState<Set<string>>(() => new Set())
  const [featuredErrors, setFeaturedErrors] = useState<Record<string, string>>({})
  // Los barrios del filtro: los de la primera carga sin filtro de barrio, así no desaparecen al filtrar.
  const [neighborhoods, setNeighborhoods] = useState<string[]>([])
  const [deleting, setDeleting] = useState<GuideSummary | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listGuides(filters, controller.signal)
      .then((data) => {
        setState({ status: 'ready', data })
        setNeighborhoods((current) => [...new Set([...current, ...data.neighborhoods])].sort())
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: errorMessage(error, 'No se pudieron leer las guías.') })
      })
    return () => controller.abort()
  }, [filters, attempt])

  const filter = (patch: GuideListFilters) => {
    setState({ status: 'loading' })
    setFilters((current) => ({ ...current, ...patch }))
  }

  const updateRow = (id: string, patch: Partial<GuideSummary>) =>
    setState((current) => current.status === 'ready'
      ? { ...current, data: { ...current.data, guides: current.data.guides.map((guide) => (guide.id === id ? { ...guide, ...patch } : guide)) } }
      : current)

  async function toggleFeatured(guide: GuideSummary) {
    const featured = !guide.featured
    updateRow(guide.id, { featured })
    setSaving((current) => new Set(current).add(guide.id))
    setFeaturedErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== guide.id)))
    try {
      await setGuideFeatured(guide.id, featured)
    } catch (error) {
      updateRow(guide.id, { featured: !featured })
      setFeaturedErrors((current) => ({ ...current, [guide.id]: errorMessage(error, 'No se pudo guardar.') }))
    } finally {
      setSaving((current) => {
        const next = new Set(current)
        next.delete(guide.id)
        return next
      })
    }
  }

  const guides = state.status === 'ready' ? state.data.guides : []
  const filtered = Object.values(filters).some(Boolean)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Estado
          <select aria-label="Estado" className={selectClass} value={filters.status ?? ''} onChange={(event) => filter({ status: event.target.value || undefined })}>
            <option value="">Todos</option>
            <option value="draft">Borrador</option>
            <option value="published">Publicada</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Grupo
          <select aria-label="Grupo" className={selectClass} value={filters.group ?? ''} onChange={(event) => filter({ group: event.target.value || undefined })}>
            <option value="">Todos</option>
            {GROUP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Barrio
          <select aria-label="Barrio" className={selectClass} value={filters.neighborhood ?? ''} onChange={(event) => filter({ neighborhood: event.target.value || undefined })}>
            <option value="">Todos</option>
            <option value="city">Toda la ciudad</option>
            {neighborhoods.map((id) => <option key={id} value={id}>{neighborhoodDisplayName(id) ?? id}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Destacada
          <select aria-label="Destacada" className={selectClass} value={filters.featured ?? ''} onChange={(event) => filter({ featured: event.target.value || undefined })}>
            <option value="">Todas</option>
            <option value="1">Sí</option>
            <option value="0">No</option>
          </select>
        </label>
        <Button type="button" className="ml-auto" onClick={onCreate}>
          <Plus aria-hidden="true" />
          Nueva guía
        </Button>
      </div>

      {state.status === 'error' && (
        <Alert variant="destructive" className="mb-4 rounded-xl bg-background">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>No se pudieron cargar las guías</AlertTitle>
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
      )}

      {state.status === 'loading' && (
        <div className="grid gap-2 rounded-xl border bg-background p-4" aria-busy="true" aria-label="Cargando guías">
          {[0, 1, 2].map((index) => <Skeleton key={index} className="h-6 w-full" />)}
        </div>
      )}

      {state.status === 'ready' && guides.length === 0 && (
        <p className="rounded-xl border bg-background p-6 text-sm text-muted-foreground">
          {filtered ? 'Ninguna guía con estos filtros.' : 'Todavía no hay guías. Creá la primera con «Nueva guía».'}
        </p>
      )}

      {state.status === 'ready' && guides.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Ciudad / barrio</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-center">Destacada</TableHead>
                <TableHead className="text-right">Lugares</TableHead>
                <TableHead>Actualizada</TableHead>
                <TableHead><span className="sr-only">Acciones</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {guides.map((guide) => (
                <TableRow key={guide.id} className="cursor-pointer" onClick={() => onOpen(guide.id)}>
                  <TableCell className="max-w-80 whitespace-normal">
                    <button type="button" className="text-left font-medium hover:underline" onClick={(event) => {
                      event.stopPropagation()
                      onOpen(guide.id)
                    }}>
                      {guide.title || <span className="text-muted-foreground italic">Sin título</span>}
                    </button>
                    <span className="block text-xs text-muted-foreground">{guide.slug}</span>
                    {guide.warnings.length > 0 && (
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {guide.warnings.map((warning) => (
                          <li key={warning.code} className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200">
                            <AlertTriangle className="size-3" aria-hidden="true" />
                            {warningLabel(warning)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{guideScope(guide.neighborhoodId)}</TableCell>
                  <TableCell>{groupLabel(guide.group)}</TableCell>
                  <TableCell>
                    <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${guide.status === 'published' ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-muted text-muted-foreground'}`}>
                      {STATUS_LABELS[guide.status]}
                    </span>
                  </TableCell>
                  <TableCell className="text-center" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-primary disabled:cursor-wait"
                      checked={guide.featured}
                      disabled={saving.has(guide.id)}
                      onChange={() => void toggleFeatured(guide)}
                      aria-label={`Destacar ${guide.title || guide.slug}`}
                    />
                    {saving.has(guide.id) && <p className="mt-1 text-xs text-muted-foreground">Guardando…</p>}
                    {featuredErrors[guide.id] && <p className="mt-1 text-xs text-destructive" role="alert">{featuredErrors[guide.id]}</p>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{guide.placeCount}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{formatGuideDate(guide.contentUpdatedAt)}</TableCell>
                  <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setDeleting(guide)}
                      disabled={guide.status === 'published'}
                      title={guide.status === 'published' ? 'Para eliminarla, despublicala primero.' : 'Eliminar guía'}
                      aria-label={guide.status === 'published' ? `Eliminar ${guide.title || guide.slug} (despublicala primero)` : `Eliminar ${guide.title || guide.slug}`}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <GuideDeleteDialog
        guide={deleting ? { id: deleting.id, title: deleting.title } : null}
        onClose={() => setDeleting(null)}
        onDeleted={(id) => setState((current) => (current.status === 'ready' ? { ...current, data: { ...current.data, guides: current.data.guides.filter((guide) => guide.id !== id) } } : current))}
      />
    </div>
  )
}
