import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, RotateCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getPopularity } from '@/lib/popularity-api'
import { nextSort, originShares, sortPopularity, type PopularitySort, type SortDirection } from '@/lib/popularity'
import type { PopularityResponse } from '@/types/popularity'

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: PopularityResponse }

const COLUMNS: { sort: Exclude<PopularitySort, 'name'>; label: string }[] = [
  { sort: 'views7', label: 'Vistas 7 d' },
  { sort: 'views30', label: 'Vistas 30 d' },
  { sort: 'saves7', label: 'Guardados 7 d' },
  { sort: 'saves30', label: 'Guardados 30 d' },
  { sort: 'directions7', label: 'Cómo llegar 7 d' },
  { sort: 'directions30', label: 'Cómo llegar 30 d' },
]

const number = (value: number) => value.toLocaleString('es-UY')

function SortHeader({ label, sort, current, onSort, numeric }: { label: string; sort: PopularitySort; current: { sort: PopularitySort; direction: SortDirection }; onSort: (sort: PopularitySort) => void; numeric?: boolean }) {
  const active = current.sort === sort
  const Icon = !active ? ArrowUpDown : current.direction === 'asc' ? ArrowUp : ArrowDown
  return (
    <TableHead aria-sort={active ? (current.direction === 'asc' ? 'ascending' : 'descending') : 'none'} className={numeric ? 'text-right' : undefined}>
      <button type="button" className={`inline-flex items-center gap-1 font-medium hover:text-foreground ${numeric ? 'flex-row-reverse' : ''}`} onClick={() => onSort(sort)}>
        {label}
        <Icon className={`size-3.5 ${active ? '' : 'text-muted-foreground/60'}`} aria-hidden="true" />
      </button>
    </TableHead>
  )
}

/** Popularidad (etapa 1): sólo para mirar lo que se está guardando; la app todavía no la usa. */
export function PopularityPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [order, setOrder] = useState<{ sort: PopularitySort; direction: SortDirection }>({ sort: 'views30', direction: 'desc' })

  useEffect(() => {
    const controller = new AbortController()
    getPopularity(controller.signal)
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: error instanceof Error ? error.message : 'No se pudo leer la popularidad.' })
      })
    return () => controller.abort()
  }, [attempt])

  const rows = useMemo(() => (state.status === 'ready' ? sortPopularity(state.data.rows, order.sort, order.direction) : []), [state, order])
  const onSort = (sort: PopularitySort) => setOrder((current) => nextSort(current, sort))

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <section aria-labelledby="popularity-title">
        <div className="mb-7 max-w-2xl">
          <h2 id="popularity-title" className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
            Popularidad
          </h2>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            Personas por lugar en los últimos 7 y 30 días, hasta ayer: fichas vistas, guardados (los que se sacaron restan) y clics en «Google Maps». Cada persona cuenta una vez por día. Todavía no se usa en la app.
          </p>
        </div>

        {state.status === 'error' && (
          <Alert variant="destructive" className="mb-4 rounded-xl bg-background">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>No se pudo cargar la popularidad</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{state.message}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => {
                setState({ status: 'loading' })
                setAttempt((value) => value + 1)
              }}>
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {state.status === 'loading' && (
          <div className="grid gap-2 rounded-xl border bg-background p-4" aria-busy="true" aria-label="Cargando popularidad">
            {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-6 w-full" />)}
          </div>
        )}

        {state.status === 'ready' && rows.length === 0 && (
          <p className="rounded-xl border bg-background p-6 text-sm text-muted-foreground">
            Todavía no hay datos. Los eventos se guardan sólo con TRACK_EVENTS=true en Production, y el resumen se arma cada noche con el día anterior.
          </p>
        )}

        {state.status === 'ready' && rows.length > 0 && (
          <div className="overflow-hidden rounded-xl border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader label="Lugar" sort="name" current={order} onSort={onSort} />
                  {COLUMNS.map((column) => <SortHeader key={column.sort} label={column.label} sort={column.sort} current={order} onSort={onSort} numeric />)}
                  <TableHead>De dónde vienen las vistas (30 d)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    {COLUMNS.map((column) => <TableCell key={column.sort} className="text-right tabular-nums">{number(row[column.sort])}</TableCell>)}
                    <TableCell className="text-xs text-muted-foreground">
                      {originShares(row.origins).map((share) => `${share.label} ${share.percent}%`).join(' · ') || '—'}
                      {row.homeRows.length > 0 && <span className="block">Filas: {row.homeRows.map((item) => `${item.row} (${item.count})`).join(', ')}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}
