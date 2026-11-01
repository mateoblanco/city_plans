import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type TextListEditorProps = {
  /** Nombre de cada ítem, para los aria-label ("Agregar plato"). */
  noun: string
  value: string[]
  onChange(value: string[]): void
  /** Ítems agregados a mano: se ven en ámbar, como los tags. */
  manual?: readonly string[]
  /** Cómo se guarda cada ítem (los platos van en minúscula); también se usa para no repetir. */
  normalize?: (value: string) => string
  maxItems: number
  maxLength: number
  placeholder?: string
  disabled?: boolean
}

const trimmed = (value: string) => value.trim().replace(/\s+/g, ' ')

/** Lista de texto libre como chips: se agrega con el input (Enter o "Agregar") y se saca con la ×. */
export function TextListEditor({ noun, value, onChange, manual = [], normalize = trimmed, maxItems, maxLength, placeholder, disabled }: TextListEditorProps) {
  const [input, setInput] = useState('')
  const next = normalize(input)
  const repeated = value.some((item) => normalize(item).toLowerCase() === next.toLowerCase())
  const full = value.length >= maxItems
  const canAdd = Boolean(next) && !repeated && !full && !disabled

  const add = () => {
    if (!canAdd) return
    onChange([...value, next])
    setInput('')
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((item) => {
          const added = manual.includes(item)
          return (
            <span
              key={item}
              data-variant={added ? 'manual' : 'auto'}
              title={added ? 'Agregado a mano' : undefined}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2 text-xs',
                added ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200' : 'bg-muted/40',
              )}
            >
              {item}
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                onClick={() => onChange(value.filter((other) => other !== item))}
                disabled={disabled}
                aria-label={`Sacar ${item}`}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          )
        })}
        {value.length === 0 && <span className="text-xs text-muted-foreground">Ninguno</span>}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          maxLength={maxLength}
          placeholder={full ? `Máximo ${maxItems}` : placeholder}
          disabled={disabled || full}
          aria-label={`Nuevo ${noun}`}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            // Enter agrega el ítem; no manda el formulario.
            event.preventDefault()
            add()
          }}
        />
        <Button type="button" variant="outline" size="sm" className="h-9" disabled={!canAdd} aria-label={`Agregar ${noun}`} onClick={add}>
          <Plus className="size-3.5" aria-hidden="true" />
          Agregar
        </Button>
      </div>
      {repeated && next && <p className="text-xs text-muted-foreground">Ya está en la lista.</p>}
    </div>
  )
}
