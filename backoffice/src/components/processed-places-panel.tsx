import { useEffect, useRef, useState } from 'react'
import { Check, Copy, LoaderCircle, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ExtractionRow } from '@/hooks/use-extraction-batch'
import { existingPlaceIds, savePlaces } from '@/lib/places-api'
import { buildProcessedSummary } from '@/lib/processed-summary'
import type { PlaceEnrichmentResponse, PlaceSummary, SavePlaceResult } from '@/types/places'

type ProcessedPlacesPanelProps = {
  rows: Record<string, ExtractionRow>
  /** Lugares de la corrida: dan el nombre de las filas que fallaron. */
  places: readonly Pick<PlaceSummary, 'placeId' | 'name'>[]
  categoryLabel: (id: string) => string
}

type DbState =
  | { status: 'unknown' }
  | { status: 'new' }
  | { status: 'exists' }
  | { status: 'saved'; outcome: SavePlaceResult }
  | { status: 'error'; message: string }

type Summary = { created: number; updated: number; withoutEmbedding: number; errors: number; requestError?: string }

const MISSING_NAME = 'Sin nombre confirmado'

/** Un resultado ok sin nombre confirmado por las fuentes no se puede guardar: name es NOT NULL. */
function missingName(row: ExtractionRow | undefined) {
  return row?.result?.status === 'ok' && !row.result.place.name.trim()
}

const HOURS_LABELS: Record<string, string> = { exact: 'Exacto', partial: 'Parcial', vague: 'Vago', none: 'Sin horario' }

function DbStatus({ state }: { state: DbState | undefined }) {
  if (!state || state.status === 'unknown') return <span className="text-muted-foreground">…</span>
  if (state.status === 'new') return <span className="text-muted-foreground">nuevo</span>
  if (state.status === 'exists') return <span>ya existe</span>
  if (state.status === 'error') {
    return (
      <span className="flex flex-col" title={state.message}>
        <span className="font-medium text-destructive">error</span>
        <span className="text-xs text-destructive">{state.message}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <span className="font-medium text-emerald-700">{state.outcome.action === 'created' ? 'guardado' : 'actualizado'}</span>
      {!state.outcome.embedded && <span className="text-xs text-amber-700">sin embedding</span>}
    </span>
  )
}

/**
 * Resultados del pipeline de la corrida actual, para guardarlos en la base. Los resultados vienen
 * del estado de la UI; sólo se consulta qué lugares ya existen y se manda el POST de guardado.
 */
export function ProcessedPlacesPanel({ rows, places, categoryLabel }: ProcessedPlacesPanelProps) {
  const processed = Object.entries(rows).filter(([, row]) => row.status === 'done' || row.status === 'error')
  const ids = processed.map(([id]) => id)
  const idsKey = ids.join(',')
  const savable = (id: string) => rows[id]?.status === 'done' && Boolean(rows[id]?.result) && !missingName(rows[id])

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const seen = useRef(new Set<string>())
  const [dbStates, setDbStates] = useState<Record<string, DbState>>({})
  const [saving, setSaving] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  // Cada fila nueva entra tildada si su resultado es ok; después la selección es del usuario.
  const okKey = processed.filter(([, row]) => row.status === 'done' && row.result?.status === 'ok' && !missingName(row)).map(([id]) => id).join(',')
  useEffect(() => {
    const fresh = (okKey ? okKey.split(',') : []).filter((id) => !seen.current.has(id))
    if (fresh.length === 0) return
    for (const id of fresh) seen.current.add(id)
    setSelected((current) => new Set([...current, ...fresh]))
  }, [okKey])

  // Al abrir la tab (montar) se consulta qué lugares ya están en la base.
  useEffect(() => {
    const placeIds = idsKey ? idsKey.split(',') : []
    if (placeIds.length === 0) return
    const controller = new AbortController()
    existingPlaceIds(placeIds, controller.signal)
      .then((existing) => setDbStates((current) => {
        const next = { ...current }
        // Lo que ya se guardó en esta sesión manda sobre la consulta.
        for (const id of placeIds) if (next[id]?.status !== 'saved') next[id] = { status: existing.has(id) ? 'exists' : 'new' }
        return next
      }))
      .catch(() => {})
    return () => controller.abort()
  }, [idsKey])

  const nameOf = (id: string, row: ExtractionRow) => {
    const result = row.result
    if (result?.status === 'ok' && result.place.name) return result.place.name
    if (result?.status === 'no_sources') return result.target.name
    return places.find((place) => place.placeId === id)?.name ?? id
  }

  const selectedIds = ids.filter((id) => selected.has(id) && savable(id))
  const selectableIds = ids.filter(savable)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds))
  }

  async function copySummary() {
    clearTimeout(copyTimer.current)
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildProcessedSummary(processed, nameOf), null, 2))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    copyTimer.current = setTimeout(() => setCopyState('idle'), 2000)
  }

  async function save(placeIds: string[]) {
    const results = placeIds.flatMap((id) => rows[id]?.result ? [rows[id].result as PlaceEnrichmentResponse] : [])
    if (results.length === 0) return
    setSaving(true)
    try {
      const outcomes = await savePlaces(results)
      setDbStates((current) => {
        const next = { ...current }
        for (const outcome of outcomes) {
          next[outcome.googlePlaceId] = outcome.action === 'skipped'
            ? { status: 'error', message: outcome.error ?? 'No se pudo guardar.' }
            : { status: 'saved', outcome }
        }
        return next
      })
      const stored = outcomes.filter((outcome) => outcome.action !== 'skipped')
      setSummary({
        created: outcomes.filter((outcome) => outcome.action === 'created').length,
        updated: outcomes.filter((outcome) => outcome.action === 'updated').length,
        withoutEmbedding: stored.filter((outcome) => !outcome.embedded).length,
        errors: outcomes.length - stored.length,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron guardar los lugares.'
      setDbStates((current) => {
        const next = { ...current }
        for (const id of placeIds) next[id] = { status: 'error', message }
        return next
      })
      setSummary({ created: 0, updated: 0, withoutEmbedding: 0, errors: placeIds.length, requestError: message })
    } finally {
      setSaving(false)
    }
  }

  if (processed.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">
        Todavía no hay lugares procesados en esta corrida.
      </p>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 sm:px-5">
        <p className="text-sm" role="status">
          {summary && (
            <>
              <span className="tabular-nums">
                {summary.created} creados, {summary.updated} actualizados, {summary.withoutEmbedding} sin embedding, {summary.errors} errores
              </span>
              {summary.requestError && <span className="ml-2 text-destructive">{summary.requestError}</span>}
            </>
          )}
          {copyState === 'failed' && <span className="ml-2 text-destructive">No se pudo copiar</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void copySummary()}>
            {copyState === 'copied'
              ? <Check className="size-3.5" aria-hidden="true" />
              : <Copy className="size-3.5" aria-hidden="true" />}
            {copyState === 'copied' ? 'Copiado' : 'Copiar resumen'}
          </Button>
          <Button type="button" size="sm" disabled={saving || selectedIds.length === 0} onClick={() => void save(selectedIds)}>
            {saving
              ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              : <Save className="size-3.5" aria-hidden="true" />}
            Guardar seleccionados ({selectedIds.length})
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-10 pl-4 sm:pl-5">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todos los procesados"
                  checked={allSelected}
                  disabled={saving || selectableIds.length === 0}
                  onChange={toggleAll}
                  className="size-4 accent-foreground"
                />
              </TableHead>
              <TableHead className="px-4 sm:px-5">Nombre</TableHead>
              <TableHead className="px-4 sm:px-5">Categorías</TableHead>
              <TableHead className="px-4 sm:px-5">Horario</TableHead>
              <TableHead className="px-4 sm:px-5">En base</TableHead>
              <TableHead className="px-4 text-right sm:px-5">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {processed.map(([id, row]) => {
              const name = nameOf(id, row)
              const place = row.result?.status === 'ok' ? row.result.place : null
              return (
                <TableRow key={id}>
                  <TableCell className="w-10 pl-4 sm:pl-5">
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${name}`}
                      checked={savable(id) && selected.has(id)}
                      disabled={!savable(id) || saving}
                      onChange={() => toggle(id)}
                      className="size-4 accent-foreground"
                    />
                  </TableCell>
                  <TableCell className="px-4 py-3 font-medium sm:px-5">
                    {name}
                    {row.status === 'error' && <span className="block text-xs font-normal text-destructive">Error: {row.error}</span>}
                    {row.result?.status === 'no_sources' && <span className="block text-xs font-normal text-amber-700">Sin fuentes</span>}
                    {missingName(row) && <span className="block text-xs font-normal text-destructive">{MISSING_NAME}</span>}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground sm:px-5">
                    {place && place.categories.length > 0 ? place.categories.map(categoryLabel).join(', ') : '—'}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground sm:px-5">
                    {place ? HOURS_LABELS[place.hours.status] ?? place.hours.status : '—'}
                  </TableCell>
                  <TableCell className="px-4 py-3 sm:px-5">
                    {missingName(row)
                      ? <DbStatus state={{ status: 'error', message: `${MISSING_NAME}: no se puede guardar` }} />
                      : savable(id) ? <DbStatus state={dbStates[id]} /> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right sm:px-5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Guardar ${name}`}
                      disabled={saving || !savable(id)}
                      onClick={() => void save([id])}
                    >
                      <Save className="size-3.5" aria-hidden="true" />
                      Guardar
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between gap-4 border-t bg-muted/20 px-4 py-3 sm:px-5">
        <p className="text-xs text-muted-foreground">Resultados del pipeline en memoria</p>
        <span
          className="font-sans text-xs font-normal tracking-normal whitespace-nowrap text-[#5e5e5e]"
          translate="no"
          aria-label="Google Maps"
        >
          Google Maps
        </span>
      </div>
    </>
  )
}
