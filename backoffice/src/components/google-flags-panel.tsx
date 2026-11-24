import { useEffect, useState } from 'react'
import { AlertCircle, ChevronDown, EyeOff, LoaderCircle, MapPinOff, RotateCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { GOOGLE_FLAG_REASONS, type GoogleFlagReason, type GoogleRefreshStopReason } from '@/data/google-flags'
import { REVIEW_REASONS } from '@/data/review-reasons'
import { ignoreGoogleFlag, listGoogleFlags, unpublishGoogleFlag } from '@/lib/google-flags-api'
import type { GoogleFlagItem, GoogleFlagsResponse } from '@/types/google-flags'

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'success'; data: GoogleFlagsResponse }

type Props = {
  /** Después de despublicar: la lista de lugares cambia (pasa a "A revisar"). */
  onUnpublished: (name: string) => void
}

const REASON_STYLES: Record<GoogleFlagReason, string> = {
  moved: 'bg-amber-50 text-amber-800 ring-amber-200',
  not_found: 'bg-red-50 text-red-800 ring-red-200',
  replaced: 'bg-violet-50 text-violet-800 ring-violet-200',
}
const UNPUBLISH_LABEL: Record<GoogleFlagReason, string> = {
  moved: REVIEW_REASONS.location_moved,
  not_found: REVIEW_REASONS.not_found_in_google,
  replaced: REVIEW_REASONS.not_found_in_google,
}
const STOP_LABELS: Record<GoogleRefreshStopReason, string> = {
  quota: 'cortada por cuota (429)',
  authorization: 'cortada: Google rechazó la clave (403)',
  missing_key: 'cortada: falta GOOGLE_PLACES_API_KEY',
}

const message = (error: unknown) => (error instanceof Error ? error.message : 'No se pudo completar la consulta.')
const date = (iso: string) => new Date(iso).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' })
const places = (count: number) => `${count} ${count === 1 ? 'lugar' : 'lugares'}`

function Tag({ reason }: { reason: GoogleFlagReason }) {
  return (
    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ${REASON_STYLES[reason]}`}>
      {GOOGLE_FLAG_REASONS[reason]}
    </span>
  )
}

/** Detalle del aviso: cuánto se movió o el id nuevo que indicó Google. */
function detail(flag: GoogleFlagItem) {
  if (flag.reason === 'moved' && flag.distanceM !== null) return `${flag.distanceM.toLocaleString('es-UY')} m`
  if (flag.reason === 'replaced' && flag.newGooglePlaceId) return `Nuevo id: ${flag.newGooglePlaceId}`
  return null
}

/**
 * Lugares › Avisos de Google: lo que marcó el cron de refresco de coordenadas de la app (se movió más de 100 m, el
 * place_id ya no existe o Google lo reemplazó). Arriba, el control: cuántos publicados tienen coordenadas de más de 30
 * días y la última corrida. Nada se despublica solo: "Despublicar" lo manda a "A revisar" con el motivo (se deshace
 * con Publicar) e "Ignorar" deja de mostrar el aviso. Sin llamadas a Google desde acá.
 */
export function GoogleFlagsPanel({ onUnpublished }: Props) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<GoogleFlagItem | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listGoogleFlags(controller.signal)
      .then((data) => setState({ status: 'success', data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: message(error) })
      })
    return () => controller.abort()
  }, [attempt])

  const retry = () => {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }

  const setBusyId = (id: string, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  // Saca el aviso de la lista; si la acción falla, vuelve a su lugar con el error en la fila.
  const removeFlag = (id: string) =>
    setState((current) => (current.status === 'success' ? { ...current, data: { ...current.data, flags: current.data.flags.filter((flag) => flag.id !== id) } } : current))
  const restore = (snapshot: GoogleFlagsResponse) => setState({ status: 'success', data: snapshot })

  async function ignore(flag: GoogleFlagItem) {
    if (state.status !== 'success') return
    const snapshot = state.data
    setBusyId(flag.id, true)
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== flag.id)))
    removeFlag(flag.id)
    try {
      await ignoreGoogleFlag(flag.id)
    } catch (error) {
      restore(snapshot)
      setErrors((current) => ({ ...current, [flag.id]: message(error) }))
    } finally {
      setBusyId(flag.id, false)
    }
  }

  async function confirmUnpublish() {
    if (!confirming || state.status !== 'success') return
    const flag = confirming
    setBusyId(flag.id, true)
    setConfirmError(null)
    try {
      await unpublishGoogleFlag(flag.id)
      setConfirming(null)
      removeFlag(flag.id)
      onUnpublished(flag.placeName)
    } catch (error) {
      setConfirmError(message(error))
    } finally {
      setBusyId(flag.id, false)
    }
  }

  const data = state.status === 'success' ? state.data : null
  const flags = data?.flags ?? []

  return (
    <section aria-labelledby="google-flags-title" aria-describedby="google-flags-summary" className="mb-6 overflow-hidden rounded-xl border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 id="google-flags-title" className="text-sm font-semibold">
            Avisos de Google{data ? ` (${flags.length})` : ''}
          </h3>
          <p id="google-flags-summary" className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
            {state.status === 'loading' && 'Cargando…'}
            {data && (
              <>
                <span className={data.stale > 0 ? 'font-medium text-amber-800' : undefined}>
                  {data.stale === 0 ? 'Todas las coordenadas tienen menos de 30 días' : `${places(data.stale)} con coordenadas de más de 30 días`}
                </span>
                {' · '}
                {data.lastRun
                  ? `Última corrida: ${date(data.lastRun.startedAt)}, refrescó ${data.lastRun.refreshed}, marcó ${data.lastRun.flagged}, fallaron ${data.lastRun.failed}${data.lastRun.stoppedReason ? ` (${STOP_LABELS[data.lastRun.stoppedReason]})` : ''}`
                  : 'Todavía no corrió el refresco'}
              </>
            )}
          </p>
        </div>
        {data && flags.length > 0 && (
          <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-controls="google-flags-list" onClick={() => setOpen((value) => !value)}>
            {open ? 'Ocultar avisos' : 'Ver avisos'}
            <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </Button>
        )}
      </div>

      {state.status === 'loading' && (
        <div className="border-t px-4 py-3 sm:px-5" aria-label="Cargando avisos de Google">
          <Skeleton className="h-5 w-1/3" />
        </div>
      )}

      {state.status === 'error' && (
        <Alert variant="destructive" className="rounded-none border-0 border-t">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>No se pudieron cargar los avisos de Google</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{state.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {data && open && flags.length > 0 && (
        <div id="google-flags-list" className="overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4 sm:px-5">Lugar</TableHead>
                <TableHead className="px-4 sm:px-5">Motivo</TableHead>
                <TableHead className="px-4 sm:px-5">Detectado</TableHead>
                <TableHead className="px-4 sm:px-5">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flags.map((flag) => (
                <TableRow key={flag.id}>
                  <TableCell className="px-4 py-3 font-medium sm:px-5">{flag.placeName}</TableCell>
                  <TableCell className="px-4 py-3 sm:px-5">
                    <Tag reason={flag.reason} />
                    {detail(flag) && <span className="ml-2 text-xs text-muted-foreground tabular-nums">{detail(flag)}</span>}
                  </TableCell>
                  <TableCell className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums sm:px-5">{date(flag.detectedAt)}</TableCell>
                  <TableCell className="px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={busy.has(flag.id)} onClick={() => { setConfirmError(null); setConfirming(flag) }} aria-label={`Despublicar ${flag.placeName}`}>
                        <MapPinOff className="size-3.5" aria-hidden="true" />
                        Despublicar
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busy.has(flag.id)} onClick={() => void ignore(flag)} aria-label={`Ignorar el aviso de ${flag.placeName}`}>
                        {busy.has(flag.id) ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <EyeOff className="size-3.5" aria-hidden="true" />}
                        Ignorar
                      </Button>
                    </div>
                    {errors[flag.id] && <p className="mt-1 text-xs text-destructive" role="alert">{errors[flag.id]}</p>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={confirming !== null} onOpenChange={(value) => { if (!value && !(confirming && busy.has(confirming.id))) setConfirming(null) }}>
        <DialogContent className="sm:max-w-md">
          {confirming && (
            <>
              <DialogHeader>
                <DialogTitle>¿Despublicar «{confirming.placeName}»?</DialogTitle>
                <DialogDescription>
                  Deja de verse en el sitio y pasa a «A revisar» con el motivo «{UNPUBLISH_LABEL[confirming.reason]}». Se deshace con Publicar.
                </DialogDescription>
              </DialogHeader>
              {confirmError && <p className="text-sm text-destructive" role="alert">{confirmError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy.has(confirming.id)} onClick={() => setConfirming(null)}>Cancelar</Button>
                <Button type="button" variant="destructive" disabled={busy.has(confirming.id)} onClick={() => void confirmUnpublish()}>
                  {busy.has(confirming.id) && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
                  Despublicar
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
