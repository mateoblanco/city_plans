import { useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { label, type TagDef, type TagId } from '@/data/tags'

type TagPickerProps = {
  /** Nombre del campo, para los aria-label ("Agregar cocina"). */
  noun: string
  /** Grupos del catálogo que se pueden elegir, con su título. */
  groups: { heading: string; tags: Record<string, TagDef> }[]
  value: TagId[]
  /** Tags agregados a mano (manual_overrides.tags.add): se ven en ámbar, como el cartel de "editado a mano". */
  manual?: readonly TagId[]
  onChange(value: TagId[]): void
  disabled?: boolean
}

/** Tags del catálogo de /shared como chips; se agregan desde una lista con búsqueda (nada de texto libre). */
export function TagPicker({ noun, groups, value, manual = [], onChange, disabled }: TagPickerProps) {
  const [open, setOpen] = useState(false)
  const toggle = (id: TagId) => onChange(value.includes(id) ? value.filter((tag) => tag !== id) : [...value, id])

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((id) => {
        const added = manual.includes(id)
        return (
          <span
            key={id}
            data-variant={added ? 'manual' : 'auto'}
            title={added ? 'Agregado a mano' : undefined}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2 text-xs',
              added ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200' : 'bg-muted/40',
            )}
          >
            {label(id)}
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              onClick={() => toggle(id)}
              disabled={disabled}
              aria-label={`Sacar ${label(id)}`}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        )
      })}
      {value.length === 0 && <span className="text-xs text-muted-foreground">Ninguno</span>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button type="button" variant="outline" size="sm" className="h-7 px-2" disabled={disabled} aria-label={`Agregar ${noun}`} />}>
          <Plus className="size-3.5" aria-hidden="true" />
          Agregar
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(320px,calc(100vw-32px))] p-0">
          <Command>
            <CommandInput placeholder={`Buscar ${noun}…`} />
            <CommandList>
              <CommandEmpty>No hay {noun} con ese nombre.</CommandEmpty>
              {groups.map((group) => (
                <CommandGroup key={group.heading} heading={group.heading}>
                  {Object.keys(group.tags).map((id) => (
                    <CommandItem key={id} value={`${label(id)} ${id}`} onSelect={() => toggle(id as TagId)}>
                      <Check className={cn('size-4', value.includes(id as TagId) ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                      <span>{label(id)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
