import { Copy, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { crossesMidnight, DAY_LABELS, MAX_SLOTS_PER_DAY, WEEK_ORDER, type HoursIssue, type ManualSlot } from '@/data/hours-edit'

const timeClass = 'h-8 w-[6.5rem] rounded-lg border bg-background px-2 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'

type HoursEditorProps = {
  /** Turnos del borrador; opens/closes vacíos mientras se cargan. */
  value: ManualSlot[]
  issues: HoursIssue[]
  disabled?: boolean
  onChange(slots: ManualSlot[]): void
}

/**
 * Horario semanal: una fila por día (de lunes a domingo) con sus turnos, "Cerrado" y copiar el día a los demás. Un
 * turno que cierra antes de abrir (20:00–02:00) cruza la medianoche y queda en el día en que abre.
 */
export function HoursEditor({ value, issues, disabled = false, onChange }: HoursEditorProps) {
  const slotsOf = (day: number) => value.filter((slot) => slot.day === day)
  const replaceDay = (day: number, slots: Omit<ManualSlot, 'day'>[]) =>
    onChange([...value.filter((slot) => slot.day !== day), ...slots.map((slot) => ({ ...slot, day }))])
  const copyToOthers = (day: number) => {
    const source = slotsOf(day)
    onChange(WEEK_ORDER.flatMap((other) => source.map((slot) => ({ ...slot, day: other }))))
  }
  const general = issues.filter((issue) => issue.day === null)

  return (
    <div className="grid gap-1.5">
      <div className="grid divide-y rounded-lg border">
        {WEEK_ORDER.map((day) => {
          const slots = slotsOf(day)
          const closed = slots.length === 0
          const dayIssues = issues.filter((issue) => issue.day === day)
          const label = DAY_LABELS[day]
          return (
            <div key={day} className="grid gap-1.5 px-3 py-2 sm:grid-cols-[6.5rem_1fr_auto] sm:items-start" role="group" aria-label={label}>
              <span className="pt-1.5 text-sm font-medium">{label}</span>
              <div className="grid gap-1.5">
                {closed && <span className="pt-1.5 text-sm text-muted-foreground">Cerrado</span>}
                {slots.map((slot, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="time"
                      className={timeClass}
                      value={slot.opens}
                      disabled={disabled}
                      aria-label={`${label}, turno ${index + 1}: abre`}
                      onChange={(event) => replaceDay(day, slots.map((item, position) => position === index ? { ...item, opens: event.target.value } : item))}
                    />
                    <span className="text-muted-foreground">–</span>
                    <input
                      type="time"
                      className={timeClass}
                      value={slot.closes}
                      disabled={disabled}
                      aria-label={`${label}, turno ${index + 1}: cierra`}
                      onChange={(event) => replaceDay(day, slots.map((item, position) => position === index ? { ...item, closes: event.target.value } : item))}
                    />
                    {crossesMidnight(slot) && <span className="text-xs text-muted-foreground">(día siguiente)</span>}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={disabled}
                      aria-label={`${label}: quitar turno ${index + 1}`}
                      onClick={() => replaceDay(day, slots.filter((_, position) => position !== index))}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                {dayIssues.map((issue) => <p key={issue.message} className="text-xs text-destructive" role="alert">{issue.message}</p>)}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={closed}
                    disabled={disabled}
                    aria-label={`${label}: cerrado`}
                    onChange={(event) => replaceDay(day, event.target.checked ? [] : [{ opens: '', closes: '' }])}
                  />
                  Cerrado
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled || slots.length >= MAX_SLOTS_PER_DAY}
                  aria-label={`${label}: agregar turno`}
                  onClick={() => replaceDay(day, [...slots, { opens: '', closes: '' }])}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Turno
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`Copiar ${label.toLowerCase()} a los demás días`} onClick={() => copyToOthers(day)}>
                  <Copy className="size-3.5" aria-hidden="true" />
                  Copiar a los demás
                </Button>
              </div>
            </div>
          )
        })}
      </div>
      {general.map((issue) => <p key={issue.message} className="text-xs text-destructive" role="alert">{issue.message}</p>)}
    </div>
  )
}
