import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { deleteGuide } from '@/lib/guides-api'

type Props = {
  /** La guía a eliminar; null = cerrado. */
  guide: { id: string; title: string } | null
  onClose: () => void
  /** Después de eliminarla (el diálogo ya se cerró). */
  onDeleted: (id: string) => void
}

/**
 * Confirmación de "Eliminar guía" (editor y listado). Sólo para borradores: una publicada se despublica antes (el
 * servidor responde 409 igual). Se borran también sus lugares. Si falla, el error queda en el diálogo.
 */
export function GuideDeleteDialog({ guide, onClose, onDeleted }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (busy) return
    setError(null)
    onClose()
  }

  async function confirm() {
    if (!guide) return
    setBusy(true)
    setError(null)
    try {
      await deleteGuide(guide.id)
      setBusy(false)
      onClose()
      onDeleted(guide.id)
    } catch (failure) {
      setBusy(false)
      setError(failure instanceof Error ? failure.message : 'No se pudo eliminar la guía.')
    }
  }

  return (
    <Dialog open={guide !== null} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>¿Eliminar «{guide?.title || 'Guía sin título'}»?</DialogTitle>
          <DialogDescription>Esta acción no se puede deshacer. Se borran la guía y sus lugares con sus textos.</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={close}>Cancelar</Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {busy && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
            Eliminar guía
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
