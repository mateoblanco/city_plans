import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, LoaderCircle, RotateCcw } from 'lucide-react'
import { PlaceTagsEvidence } from '@/components/place-tags-evidence'
import { SavePlaceButton } from '@/components/save-place-button'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  getGooglePlaceDetails,
  extractPlace,
  PlacesApiError,
  searchPlaceWithExa,
} from '@/lib/places-api'
import type {
  ExaPlaceResponse,
  GooglePlaceDetailsResponse,
  PlaceEnrichmentResponse,
  PlaceAnchor,
  PlaceSummary,
} from '@/types/places'

type SourceKey = 'google' | 'exa'
type TabKey = 'info' | SourceKey
type SourceStatus = 'waiting' | 'loading' | 'success' | 'error'
type SourceState = {
  status: SourceStatus
  data?: GooglePlaceDetailsResponse | ExaPlaceResponse
  error?: { code: string; message: string }
}

type ExtractionState = {
  status: SourceStatus
  data?: PlaceEnrichmentResponse
  error?: { code: string; message: string }
}

const sourceLabels: Record<SourceKey, string> = {
  google: 'Google Places',
  exa: 'Exa',
}

const tabLabels: Record<TabKey, string> = {
  info: 'Info',
  ...sourceLabels,
}

const tabOrder: TabKey[] = ['google', 'exa', 'info']

function waitingStates(): Record<SourceKey, SourceState> {
  return {
    google: { status: 'loading' },
    exa: { status: 'waiting' },
  }
}

function errorData(error: unknown) {
  return error instanceof PlacesApiError
    ? { code: error.code, message: error.message }
    : { code: 'UNKNOWN_ERROR', message: 'No se pudo completar la consulta.' }
}

type PlaceExplorerDialogProps = {
  place: PlaceSummary | null
  onClose: () => void
}

export function PlaceExplorerDialog({ place, onClose }: PlaceExplorerDialogProps) {
  const [activeSource, setActiveSource] = useState<TabKey>('google')
  const [anchor, setAnchor] = useState<PlaceAnchor | null>(null)
  const [states, setStates] = useState<Record<SourceKey, SourceState>>(waitingStates)
  const [extraction, setExtraction] = useState<ExtractionState>({ status: 'waiting' })
  const controllers = useRef(new Map<SourceKey | 'extract', AbortController>())

  const updateState = useCallback((source: SourceKey, state: SourceState) => {
    setStates((current) => ({ ...current, [source]: state }))
  }, [])

  const loadExtraction = useCallback(async (placeId: string, seedCategories: PlaceSummary['seedCategories']) => {
    controllers.current.get('extract')?.abort()
    const controller = new AbortController()
    controllers.current.set('extract', controller)
    setExtraction({ status: 'loading' })
    try {
      const data = await extractPlace({ googlePlaceId: placeId, seedCategories }, controller.signal)
      setExtraction({ status: 'success', data })
    } catch (error) {
      if (controller.signal.aborted) return
      setExtraction({ status: 'error', error: errorData(error) })
    }
  }, [])

  const loadExa = useCallback(async (name: string, refresh = false) => {
    controllers.current.get('exa')?.abort()
    const controller = new AbortController()
    controllers.current.set('exa', controller)
    updateState('exa', { status: 'loading' })
    try {
      const data = await searchPlaceWithExa(name, refresh, controller.signal)
      updateState('exa', { status: 'success', data })
    } catch (error) {
      if (controller.signal.aborted) return
      updateState('exa', { status: 'error', error: errorData(error) })
    }
  }, [updateState])

  const loadGoogle = useCallback(async (selectedPlace: PlaceSummary) => {
    for (const controller of controllers.current.values()) controller.abort()
    controllers.current.clear()
    setAnchor(null)
    setStates(waitingStates())
    setExtraction({ status: 'waiting' })

    const controller = new AbortController()
    controllers.current.set('google', controller)
    void loadExa(selectedPlace.name)
    void loadExtraction(selectedPlace.placeId, selectedPlace.seedCategories)
    try {
      const data = await getGooglePlaceDetails(selectedPlace.placeId, controller.signal)
      setAnchor(data.anchor)
      updateState('google', { status: 'success', data })
    } catch (error) {
      if (controller.signal.aborted) return
      updateState('google', { status: 'error', error: errorData(error) })
    }
  }, [loadExa, loadExtraction, updateState])

  useEffect(() => {
    if (!place) return
    const activeControllers = controllers.current
    queueMicrotask(() => {
      setActiveSource('google')
      void loadGoogle(place)
    })
    return () => {
      for (const controller of activeControllers.values()) controller.abort()
    }
  }, [loadGoogle, place])

  const isInfoTab = activeSource === 'info'
  const state = isInfoTab ? null : states[activeSource]
  const json = state?.data ?? (state?.error ? { error: state.error } : null)
  const infoIsLoading = extraction.status === 'loading' || extraction.status === 'waiting'
  const infoCanRetry = isInfoTab && extraction.status === 'error' && place

  return (
    <Dialog open={Boolean(place)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className="flex max-h-[90svh] min-w-0 flex-col gap-0 overflow-hidden p-0"
        style={{ width: 'calc(100vw - 2rem)', maxWidth: '64rem' }}
      >
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <DialogTitle>Información multi-fuente</DialogTitle>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <DialogDescription>
              {place?.name}. Google es exacto; las demás fuentes son coincidencias estimadas.
            </DialogDescription>
            <SavePlaceButton result={extraction.status === 'success' ? extraction.data ?? null : null} />
          </div>
        </DialogHeader>

        <div
          className="grid grid-cols-3 gap-2 border-b bg-muted/30 p-3"
          role="tablist"
          aria-label="Fuentes de información"
        >
          {tabOrder.map((source) => (
            <button
              key={source}
              type="button"
              role="tab"
              aria-selected={activeSource === source}
              onClick={() => setActiveSource(source)}
              className={`inline-flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm font-medium transition-colors ${
                activeSource === source
                  ? 'border-foreground/20 bg-background text-foreground shadow-sm'
                  : 'bg-background/50 text-muted-foreground hover:border-foreground/15 hover:text-foreground'
              }`}
            >
              <span className="truncate">{tabLabels[source]}</span>
              <span className="shrink-0" aria-hidden="true">
                {source === 'info' && (!anchor && states.google.status === 'loading' || anchor && infoIsLoading) && (
                  <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
                )}
                {source === 'info' && !anchor && states.google.status !== 'loading' && states.google.status !== 'error' && (
                  <span className="block size-2 rounded-full bg-muted-foreground/40" />
                )}
                {source === 'info' && anchor && extraction.status === 'success' && (
                  <span className="block size-2 rounded-full bg-emerald-600" />
                )}
                {source === 'info' && (states.google.status === 'error' || extraction.status === 'error') && (
                  <span className="block size-2 rounded-full bg-destructive" />
                )}
                {source !== 'info' && states[source].status === 'loading' && (
                  <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
                )}
                {source !== 'info' && states[source].status === 'waiting' && (
                  <span className="block size-2 rounded-full bg-muted-foreground/40" />
                )}
                {source !== 'info' && states[source].status === 'success' && (
                  <span className="block size-2 rounded-full bg-emerald-600" />
                )}
                {source !== 'info' && states[source].status === 'error' && (
                  <span className="block size-2 rounded-full bg-destructive" />
                )}
              </span>
            </button>
          ))}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4 sm:p-5" role="tabpanel">
          <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
            <div className="text-sm">
              {isInfoTab && !anchor && states.google.status !== 'error' && (
                <span className="text-muted-foreground">Esperando las coordenadas de Google…</span>
              )}
              {isInfoTab && states.google.status === 'error' && (
                <span className="inline-flex items-center gap-2 font-medium text-destructive">
                  <AlertCircle className="size-4" aria-hidden="true" />
                  No se pudieron obtener las coordenadas del lugar.
                </span>
              )}
              {isInfoTab && anchor && (
                extraction.status === 'loading' || extraction.status === 'waiting' ? (
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    Consultando Google, Exa e Instagram para generar el borrador…
                  </span>
                ) : extraction.status === 'error' ? (
                  <span className="inline-flex items-center gap-2 font-medium text-destructive">
                    <AlertCircle className="size-4" aria-hidden="true" />
                    {extraction.error?.message}
                  </span>
                ) : extraction.data?.status === 'no_sources' ? (
                  <span className="font-medium text-amber-700">No hay fuentes Exa o Instagram para enriquecer.</span>
                ) : (
                  <span className="font-medium text-emerald-700">Borrador estructurado disponible</span>
                )
              )}
              {state?.status === 'waiting' && (
                <span className="text-muted-foreground">Esperando las coordenadas de Google…</span>
              )}
              {state?.status === 'loading' && (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  Consultando {tabLabels[activeSource]}…
                </span>
              )}
              {state?.status === 'success' && (
                <span className="font-medium text-emerald-700">
                  {activeSource === 'google' ? 'Coincidencia exacta' : 'Consulta completada'}
                </span>
              )}
              {state?.status === 'error' && (
                <span className="inline-flex items-center gap-2 font-medium text-destructive">
                  <AlertCircle className="size-4" aria-hidden="true" />
                  {state.error?.message}
                </span>
              )}
            </div>

            {(infoCanRetry || state?.status === 'error' && place) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (activeSource === 'info') void loadExtraction(place.placeId, place.seedCategories)
                  else if (activeSource === 'google') void loadGoogle(place)
                  else if (activeSource === 'exa') void loadExa(place.name, true)
                }}
                disabled={false}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Reintentar
              </Button>
            )}
          </div>

          {isInfoTab ? (
            <div className="flex min-h-72 w-full flex-1 flex-col gap-3 overflow-auto">
              {extraction.data?.status === 'ok' && <PlaceTagsEvidence place={extraction.data.place} />}
              <div className="w-full rounded-xl border bg-[#111315] p-4 font-mono text-xs leading-5 text-[#e5e7eb]">
                <pre className="whitespace-pre-wrap">
                  {extraction.data
                    ? JSON.stringify(extraction.data, null, 2)
                    : extraction.status === 'error'
                      ? '// No se pudo generar el borrador. Podés reintentar.'
                      : '// Generando borrador desde Google, Exa e Instagram…'}
                </pre>
              </div>
            </div>
          ) : (
            <pre className="min-h-72 w-full min-w-0 flex-1 overflow-auto rounded-xl border bg-[#111315] p-4 font-mono text-xs leading-5 text-[#e5e7eb]">
              {json ? JSON.stringify(json, null, 2) : '// Esperando respuesta…'}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
