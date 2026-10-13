import { useEffect, useState } from 'react'
import { LoaderCircle, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { existingPlaceIds, savePlaces } from '@/lib/places-api'
import type { PlaceEnrichmentResponse, SavePlaceResult } from '@/types/places'

type SavePlaceButtonProps = {
  /** null mientras el pipeline no terminó o si falló: el botón queda deshabilitado. */
  result: PlaceEnrichmentResponse | null
}

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; outcome: SavePlaceResult }
  | { status: 'error'; message: string }

function resultPlaceId(result: PlaceEnrichmentResponse) {
  return result.status === 'ok' ? result.place.googlePlaceId : result.target.googlePlaceId
}

/** Guarda en la base el resultado del pipeline que se está viendo: "Guardar" si es nuevo, "Actualizar" si ya está. */
export function SavePlaceButton({ result }: SavePlaceButtonProps) {
  const placeId = result ? resultPlaceId(result) : null
  // Cada estado recuerda a qué resultado pertenece: otro lugar o un reintento empiezan de cero.
  const [existsFor, setExistsFor] = useState<{ result: PlaceEnrichmentResponse; exists: boolean } | null>(null)
  const [stateFor, setStateFor] = useState<{ result: PlaceEnrichmentResponse; state: SaveState } | null>(null)
  const exists = result && existsFor?.result === result ? existsFor.exists : null
  const state: SaveState = result && stateFor?.result === result ? stateFor.state : { status: 'idle' }

  useEffect(() => {
    if (!result || !placeId) return
    const controller = new AbortController()
    existingPlaceIds([placeId], controller.signal)
      .then((ids) => setExistsFor({ result, exists: ids.has(placeId) }))
      // Sin la consulta igual se puede guardar: el server decide si crea o actualiza.
      .catch(() => { if (!controller.signal.aborted) setExistsFor({ result, exists: false }) })
    return () => controller.abort()
  }, [result, placeId])

  async function save() {
    if (!result) return
    const setState = (next: SaveState) => setStateFor({ result, state: next })
    setState({ status: 'saving' })
    try {
      const [outcome] = await savePlaces([result])
      if (!outcome || outcome.action === 'skipped') {
        setState({ status: 'error', message: outcome?.error ?? 'No se pudo guardar el lugar.' })
        return
      }
      setExistsFor({ result, exists: true })
      setState({ status: 'saved', outcome })
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'No se pudo guardar el lugar.' })
    }
  }

  // Sin un nombre confirmado por las fuentes el lugar no se puede guardar (name es NOT NULL).
  const missingName = result?.status === 'ok' && !result.place.name.trim()
  const saving = state.status === 'saving'
  const saved = state.status === 'saved' ? state.outcome : null

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <Button type="button" size="sm" variant="outline" disabled={!result || missingName || exists === null || saving} onClick={() => void save()}>
        {saving
          ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          : <Save className="size-3.5" aria-hidden="true" />}
        {exists ? 'Actualizar' : 'Guardar'}
      </Button>
      {saved && (
        <span className="font-medium text-emerald-700">
          {saved.action === 'created' ? 'Guardado ✓' : 'Actualizado ✓'}
        </span>
      )}
      {saved && !saved.embedded && <span className="text-xs text-amber-700">sin embedding</span>}
      {missingName && <span className="text-destructive">No se puede guardar: ninguna fuente confirma el nombre.</span>}
      {state.status === 'error' && <span className="text-destructive">{state.message}</span>}
    </span>
  )
}
