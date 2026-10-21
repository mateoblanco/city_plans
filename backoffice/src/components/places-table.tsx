import type { ReactNode } from 'react'
import { ArrowUpRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { PlaceSummary } from '@/types/places'

export type PlacesTableColumn<T extends PlaceSummary> = {
  header: string
  cell: (place: T) => ReactNode
}

export type PlacesTableSelection<T extends PlaceSummary> = {
  isSelected: (place: T) => boolean
  onToggle: (place: T) => void
  allSelected: boolean
  onToggleAll: () => void
  /** Filas que no se pueden seleccionar (por ejemplo, cerrados según Google). */
  isDisabled?: (place: T) => boolean
}

type PlacesTableProps<T extends PlaceSummary> = {
  places: readonly T[]
  columns: readonly PlacesTableColumn<T>[]
  footerNote: string
  onSelect?: (place: T) => void
  selection?: PlacesTableSelection<T>
  /** Texto chico debajo del nombre. */
  subtitle?: (place: T) => ReactNode
  /** Fila resaltada desde afuera (por ejemplo, el punto del mapa bajo el mouse). */
  highlightedId?: string | null
  onHover?: (placeId: string | null) => void
}

export function PlacesTable<T extends PlaceSummary>({
  places,
  columns,
  footerNote,
  onSelect,
  selection,
  subtitle,
  highlightedId,
  onHover,
}: PlacesTableProps<T>) {
  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {selection && (
                <TableHead className="w-10 pl-4 sm:pl-5">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todos"
                    checked={selection.allSelected}
                    onChange={selection.onToggleAll}
                    className="size-4 accent-foreground"
                  />
                </TableHead>
              )}
              <TableHead className="w-1/2 px-4 sm:px-5">Nombre</TableHead>
              {columns.map((column) => (
                <TableHead key={column.header} className="px-4 sm:px-5">
                  {column.header}
                </TableHead>
              ))}
              {onSelect && <TableHead className="px-4 text-right sm:px-5">Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {places.map((place) => (
              <TableRow
                key={place.placeId}
                data-highlighted={place.placeId === highlightedId || undefined}
                className="data-highlighted:bg-muted"
                onMouseEnter={onHover ? () => onHover(place.placeId) : undefined}
                onMouseLeave={onHover ? () => onHover(null) : undefined}
              >
                {selection && (
                  <TableCell className="w-10 pl-4 sm:pl-5">
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${place.name}`}
                      checked={selection.isSelected(place)}
                      disabled={selection.isDisabled?.(place) ?? false}
                      onChange={() => selection.onToggle(place)}
                      className="size-4 accent-foreground"
                    />
                  </TableCell>
                )}
                <TableCell className="px-4 py-3 font-medium sm:px-5">
                  <a
                    href={place.googleMapsUri}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex items-center gap-1.5 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {place.name}
                    <ArrowUpRight
                      className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                    <span className="sr-only">(abre Google Maps en una nueva pestaña)</span>
                  </a>
                  {subtitle?.(place)}
                </TableCell>
                {columns.map((column) => (
                  <TableCell key={column.header} className="px-4 py-3 text-muted-foreground sm:px-5">
                    {column.cell(place)}
                  </TableCell>
                    ))}
                    {onSelect && (
                      <TableCell className="px-4 py-3 text-right sm:px-5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Buscar información de ${place.name}`}
                          onClick={() => onSelect(place)}
                        >
                          <Search className="size-3.5" aria-hidden="true" />
                          Buscar
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between gap-4 border-t bg-muted/20 px-4 py-3 sm:px-5">
        <p className="text-xs text-muted-foreground">{footerNote}</p>
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
