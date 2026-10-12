import { AlertCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PlaceTagsEvidence } from '@/components/place-tags-evidence'
import type { ExtractionRow } from '@/hooks/use-extraction-batch'
import type { PlaceSummary } from '@/types/places'

type ExtractionResultDialogProps = {
  place: PlaceSummary | null
  row: ExtractionRow | undefined
  onClose: () => void
}

/** Muestra el resultado ya obtenido por el lote, con la misma vista que la pestaña Info. No vuelve a llamar al pipeline. */
export function ExtractionResultDialog({ place, row, onClose }: ExtractionResultDialogProps) {
  const seconds = row?.durationMs !== undefined
    ? `${(row.durationMs / 1000).toLocaleString('es-UY', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`
    : null

  return (
    <Dialog open={Boolean(place && row)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className="flex max-h-[90svh] min-w-0 flex-col gap-0 overflow-hidden p-0"
        style={{ width: 'calc(100vw - 2rem)', maxWidth: '64rem' }}
      >
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <DialogTitle>Resultado del pipeline</DialogTitle>
          <DialogDescription>
            {place?.name}
            {seconds ? ` · ${seconds}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4 sm:p-5">
          <div className="mb-3 flex min-h-9 items-center text-sm">
            {row?.status === 'error' ? (
              <span className="inline-flex items-center gap-2 font-medium text-destructive">
                <AlertCircle className="size-4" aria-hidden="true" />
                {row.error}
              </span>
            ) : row?.result?.status === 'no_sources' ? (
              <span className="font-medium text-amber-700">No hay fuentes Exa o Instagram para enriquecer.</span>
            ) : (
              <span className="font-medium text-emerald-700">Borrador estructurado disponible</span>
            )}
          </div>
          <div className="flex min-h-72 w-full flex-1 flex-col gap-3 overflow-auto">
            {row?.result?.status === 'ok' && <PlaceTagsEvidence place={row.result.place} />}
            <div className="w-full rounded-xl border bg-[#111315] p-4 font-mono text-xs leading-5 text-[#e5e7eb]">
              <pre className="whitespace-pre-wrap">
                {row?.result
                  ? JSON.stringify(row.result, null, 2)
                  : '// No se pudo generar el borrador. Podés reintentar los fallidos.'}
              </pre>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
