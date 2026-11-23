import { ExternalLink, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GuideAi } from '@/hooks/use-guide-ai'
import { formatAiCost } from '@/lib/guides-api'

type ButtonProps = {
  ai: GuideAi
  slotKey: string
  /** "Generar" si el campo está vacío; "Regenerar" si no. */
  hasValue: boolean
  what: string
  disabled?: boolean
  onClick: () => void
}

/** Botón de generar/regenerar un campo, con el costo de la última generación o el error. */
export function AiButton({ ai, slotKey, hasValue, what, disabled, onClick }: ButtonProps) {
  const slot = ai.slot(slotKey)
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" size="xs" variant="outline" onClick={onClick} disabled={disabled || slot.busy || ai.noCredit} aria-label={`${hasValue ? 'Regenerar' : 'Generar'} ${what} con IA`}>
        <Sparkles aria-hidden="true" />
        {slot.busy ? 'Generando…' : hasValue ? 'Regenerar' : 'Generar'}
      </Button>
      {slot.cost !== null && (!slot.error || slot.partial) && <span className="text-xs text-muted-foreground tabular-nums">{formatAiCost(slot.cost)}</span>}
      {slot.error && (
        <span role="alert" className="text-xs text-destructive">
          {slot.error}
          {slot.cost && !slot.partial ? ` (se cobró ${formatAiCost(slot.cost)})` : ''}
          {slot.creditUrl && (
            <>
              {' '}
              <a href={slot.creditUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
                Cargar crédito
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </>
          )}
        </span>
      )}
    </span>
  )
}

/** El aviso de arriba del editor cuando el Gateway no tiene crédito (antes de generar). */
export function AiCreditNotice({ ai }: { ai: GuideAi }) {
  if (!ai.noCredit || !ai.status) return null
  return (
    <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      El AI Gateway no tiene crédito: los botones de IA están apagados.{' '}
      <a href={ai.status.creditUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium underline">
        Cargar crédito
        <ExternalLink className="size-3" aria-hidden="true" />
      </a>
    </p>
  )
}
