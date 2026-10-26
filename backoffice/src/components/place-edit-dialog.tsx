import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowUpRight, LoaderCircle, MapPin, PencilLine, RotateCcw, Trash2, Upload } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { PlaceLogo } from '@/components/place-logo'
import { TagPicker } from '@/components/tag-picker'
import { ICON_CATEGORIES, type IconCategory } from '@/data/icon-categories'
import { neighborhoodDisplayName } from '@/data/neighborhood-names'
import { CUISINES, STYLES, TAG_GROUPS, groupOf, type StyleId, type TagId } from '@/data/tags'
import { BRAND_KEY, DIET_LEVELS, PRICE_LEVELS, type EditField, type ManualLogo, type PlaceEdit } from '@/data/manual-overrides'
import { googleMapsUrl } from '@/lib/google-maps-url'
import { parseInstagramHandle } from '@/lib/instagram-handle'
import { deleteSavedPlace, getPlaceDetail, PlacesApiError, planPlaceEdit, savePlaceEdit, uploadPlaceLogo } from '@/lib/places-api'
import type { DietLevel, InstagramOwner, PlaceDetail, PlaceEditPlan, PriceLevel } from '@/types/places'

const PRICE_LABELS: Record<PriceLevel, string> = { unknown: 'Sin dato', low: '$ (barato)', moderate: '$$ (moderado)', high: '$$$ (caro)', very_high: '$$$$ (muy caro)' }
const DIET_LABELS: Record<DietLevel, string> = { unknown: 'Sin dato', no: 'No', has_options: 'Tiene opciones', fully: 'Todo el menú' }
const GROUP_HEADINGS: Record<keyof typeof TAG_GROUPS, string> = {
  moments: 'Momentos', cuisines: 'Cocinas', foods: 'Comidas', drinks: 'Bebidas', features: 'Características',
  atmosphere: 'Ambiente', goodFor: 'Ideal para', offers: 'Ofertas',
}
// Los tags sin las cocinas, que se eligen aparte.
const TAG_PICKER_GROUPS = (Object.entries(TAG_GROUPS) as [keyof typeof TAG_GROUPS, (typeof TAG_GROUPS)[keyof typeof TAG_GROUPS]][])
  .filter(([group]) => group !== 'cuisines')
  .map(([group, tags]) => ({ heading: GROUP_HEADINGS[group], tags }))
const CUISINE_GROUPS = [{ heading: 'Cocinas', tags: CUISINES }]
const PLAN_DEBOUNCE_MS = 400

/** Lo que se edita en el modal. instagramInput es el texto tal cual (handle o URL); noInstagram, "No tiene". */
type Draft = {
  name: string
  tags: TagId[]
  cuisines: TagId[]
  style: StyleId | null
  iconCategory: IconCategory | null
  price: PriceLevel
  dietVegan: DietLevel
  dietVegetarian: DietLevel
  dietGlutenFree: DietLevel
  instagramInput: string
  noInstagram: boolean
  website: string
  brandKey: string
  featured: boolean
  logo: { logo: ManualLogo; url: string | null; classificationUsd: number } | null
}

const isCuisine = (id: string) => groupOf(id) === 'cuisines'

function draftOf(place: PlaceDetail): Draft {
  return {
    name: place.name,
    tags: place.tags.filter((id) => !isCuisine(id)),
    cuisines: place.tags.filter(isCuisine),
    style: place.style,
    iconCategory: place.iconCategory,
    price: place.price,
    dietVegan: place.dietVegan,
    dietVegetarian: place.dietVegetarian,
    dietGlutenFree: place.dietGlutenFree,
    instagramInput: place.instagram ?? '',
    noInstagram: !place.instagram,
    website: place.website ?? '',
    brandKey: place.brandKey ?? '',
    featured: place.featured,
    logo: null,
  }
}

type Validated = { edit: PlaceEdit; errors: Partial<Record<'name' | 'instagram' | 'website' | 'brandKey', string>> }

const sameSet = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((id) => right.includes(id))

/** Los campos que cambiaron respecto de lo guardado, ya validados como los valida el servidor. */
function editOf(place: PlaceDetail, draft: Draft): Validated {
  const edit: PlaceEdit = {}
  const errors: Validated['errors'] = {}
  const name = draft.name.trim()
  if (!name) errors.name = 'El nombre no puede quedar vacío.'
  else if (name !== place.name) edit.name = name
  const tags = [...draft.tags, ...draft.cuisines]
  if (!sameSet(tags, place.tags)) edit.tags = tags
  if (draft.style !== place.style) edit.style = draft.style
  if (draft.iconCategory !== place.iconCategory) edit.iconCategory = draft.iconCategory
  if (draft.price !== place.price) edit.price = draft.price
  if (draft.dietVegan !== place.dietVegan) edit.dietVegan = draft.dietVegan
  if (draft.dietVegetarian !== place.dietVegetarian) edit.dietVegetarian = draft.dietVegetarian
  if (draft.dietGlutenFree !== place.dietGlutenFree) edit.dietGlutenFree = draft.dietGlutenFree
  if (draft.noInstagram) {
    if (place.instagram !== null) edit.instagram = null
  } else {
    const handle = parseInstagramHandle(draft.instagramInput)
    if (!handle) errors.instagram = 'Poné un @usuario o la URL del perfil, o marcá «No tiene».'
    else if (handle !== place.instagram) edit.instagram = handle
  }
  const website = draft.website.trim()
  if (website && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(website)) errors.website = 'La web tiene que empezar con http:// o https://.'
  else if ((website || null) !== place.website) edit.website = website || null
  const brandKey = draft.brandKey.trim()
  if (brandKey && !BRAND_KEY.test(brandKey)) errors.brandKey = 'Sólo minúsculas, números y guiones (como cordon-beer).'
  else if ((brandKey || null) !== place.brandKey) edit.brandKey = brandKey || null
  if (draft.featured !== place.featured) edit.featured = draft.featured
  if (draft.logo) edit.logo = draft.logo.logo
  return { edit, errors }
}

const usd = (value: number) => value === 0 ? 'sin costo' : `≈ US$ ${value < 0.001 ? value.toFixed(6) : value.toFixed(4)}`

function EditedMark({ edited }: { edited: boolean }) {
  if (!edited) return null
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900" title="Editado a mano: el pipeline no lo cambia">
      <PencilLine className="size-3" aria-hidden="true" />
      editado a mano
    </span>
  )
}

function Field({ label: text, htmlFor, edited, error, children }: { label: string; htmlFor?: string; edited?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {htmlFor ? <label htmlFor={htmlFor} className="text-sm font-medium">{text}</label> : <span className="text-sm font-medium">{text}</span>}
        <EditedMark edited={Boolean(edited)} />
      </div>
      {children}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  )
}

const selectClass = 'h-9 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; place: PlaceDetail }
type PlanState = { status: 'idle' } | { status: 'loading' } | PlanResult
type PlanResult = { status: 'error'; message: string } | { status: 'ready'; plan: PlaceEditPlan }

type PlaceEditDialogProps = {
  /** Lugar abierto, o null con el modal cerrado. */
  placeId: string | null
  onClose(): void
  /** Se guardó: la tabla vuelve a cargar la página. */
  onSaved(place: PlaceDetail): void
  onDeleted(id: string): void
}

/**
 * Edición de un lugar guardado. Lo editado queda en manual_overrides: el pipeline no lo vuelve a pisar (los tags
 * guardan la diferencia). Antes de guardar muestra qué se recalcula y cuánto cuesta.
 */
export function PlaceEditDialog({ placeId, onClose, onSaved, onDeleted }: PlaceEditDialogProps) {
  return (
    <Dialog open={placeId !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {placeId && <PlaceEditForm key={placeId} placeId={placeId} onClose={onClose} onSaved={onSaved} onDeleted={onDeleted} />}
      </DialogContent>
    </Dialog>
  )
}

function PlaceEditForm({ placeId, onClose, onSaved, onDeleted }: Omit<PlaceEditDialogProps, 'placeId'> & { placeId: string }) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [draft, setDraft] = useState<Draft | null>(null)
  // El último plan que respondió el servidor, con la edición (serializada) a la que corresponde.
  const [planResult, setPlanResult] = useState<{ key: string; result: PlanResult } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [sharedOwners, setSharedOwners] = useState<InstagramOwner[] | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getPlaceDetail(placeId, controller.signal)
      .then((place) => {
        setLoad({ status: 'ready', place })
        setDraft(draftOf(place))
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: 'error', message: error instanceof Error ? error.message : 'No se pudo cargar el lugar.' })
      })
    return () => controller.abort()
  }, [placeId, attempt])

  const place = load.status === 'ready' ? load.place : null
  const validated = useMemo(() => place && draft ? editOf(place, draft) : null, [place, draft])
  const hasErrors = Boolean(validated && Object.keys(validated.errors).length > 0)
  const changed = Boolean(validated && Object.keys(validated.edit).length > 0)
  const editKey = validated ? JSON.stringify(validated.edit) : ''

  // Qué se recalcula y cuánto cuesta, cada vez que cambia la edición (con una pausa para no pedirlo en cada tecla).
  const wantsPlan = Boolean(place && changed && !hasErrors)
  useEffect(() => {
    if (!place || !wantsPlan) return
    // editKey es la edición serializada: el plan se pide de nuevo sólo si cambió.
    const edit = JSON.parse(editKey) as PlaceEdit
    const controller = new AbortController()
    const timer = setTimeout(() => {
      planPlaceEdit(place.id, edit, controller.signal)
        .then((next) => setPlanResult({ key: editKey, result: { status: 'ready', plan: next } }))
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setPlanResult({ key: editKey, result: { status: 'error', message: error instanceof Error ? error.message : 'No se pudo calcular qué se recalcula.' } })
        })
    }, PLAN_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [place, editKey, wantsPlan])
  const plan: PlanState = !wantsPlan ? { status: 'idle' } : planResult?.key === editKey ? planResult.result : { status: 'loading' }

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => current ? { ...current, ...patch } : current)
    setSaveError(null)
    setSharedOwners(null)
  }
  const edited = (field: EditField) => Boolean(place?.editedFields.includes(field))
  // Los sacados a mano ya no están en place.tags; los agregados se ven distinto aunque la extracción también los traiga.
  const manualTags = place?.manualOverrides.tags?.add ?? []

  async function save(confirmSharedInstagram = false) {
    if (!place || !validated || hasErrors || !changed) return
    setSaving(true)
    setSaveError(null)
    setWarnings([])
    try {
      const result = await savePlaceEdit(place.id, validated.edit, { confirmSharedInstagram })
      setSharedOwners(null)
      onSaved(result.place)
      if (result.warnings.length === 0) {
        onClose()
        return
      }
      // Con avisos queda abierto: se guardó, pero algo no se pudo recalcular.
      setWarnings(result.warnings)
      setLoad({ status: 'ready', place: result.place })
      setDraft(draftOf(result.place))
    } catch (error) {
      if (error instanceof PlacesApiError && error.code === 'INSTAGRAM_IN_USE') setSharedOwners(error.owners)
      else setSaveError(error instanceof Error ? error.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function upload(file: File) {
    if (!place) return
    setUploading(true)
    setUploadError(null)
    try {
      const result = await uploadPlaceLogo(place.id, file)
      update({ logo: { logo: result.logo, url: result.logoUrl, classificationUsd: result.classificationUsd } })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'No se pudo subir el logo.')
    } finally {
      setUploading(false)
    }
  }

  async function remove() {
    if (!place) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteSavedPlace(place.id)
      onDeleted(place.id)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'No se pudo borrar el lugar.')
      setDeleting(false)
    }
  }

  if (load.status === 'loading' || !draft) {
    return (
      <div className="grid gap-4 p-5" aria-label="Cargando el lugar">
        <DialogHeader>
          <DialogTitle>Editar lugar</DialogTitle>
          <DialogDescription>Cargando…</DialogDescription>
        </DialogHeader>
        {load.status === 'error' ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>No se pudo cargar el lugar</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <span>{load.message}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => { setLoad({ status: 'loading' }); setAttempt((value) => value + 1) }}>
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          [0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-9 w-full" />)
        )}
      </div>
    )
  }

  const busy = saving || deleting
  const errors = validated?.errors ?? {}
  const logoPreview = draft.logo
    ? { url: draft.logo.url, kind: draft.logo.logo.kind, bgColor: draft.logo.logo.bgColor, color: draft.logo.logo.color }
    : { url: place!.logoUrl, kind: place!.logoKind, bgColor: place!.logoBgColor, color: place!.logoColor }

  return (
    <form
      className="grid"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <DialogHeader className="border-b px-5 py-4 pr-14">
        <DialogTitle>Editar {place!.name}</DialogTitle>
        <DialogDescription>
          {neighborhoodDisplayName(place!.neighborhoodId)} · Lo que cambies queda editado a mano: una re-extracción no lo pisa.
        </DialogDescription>
        <PlaceMapsLink place={place!} />
      </DialogHeader>

      <div className="grid gap-5 px-5 py-5">
        <Field label="Nombre" htmlFor="edit-name" edited={edited('name')} error={errors.name}>
          <Input id="edit-name" value={draft.name} maxLength={200} disabled={busy} onChange={(event) => update({ name: event.target.value })} />
        </Field>

        <Field label="Tags" edited={edited('tags')}>
          <TagPicker noun="tag" groups={TAG_PICKER_GROUPS} value={draft.tags} manual={manualTags} disabled={busy} onChange={(tags) => update({ tags })} />
        </Field>

        <Field label="Cocinas" edited={edited('tags')}>
          <TagPicker noun="cocina" groups={CUISINE_GROUPS} value={draft.cuisines} manual={manualTags} disabled={busy} onChange={(cuisines) => update({ cuisines })} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Estilo" htmlFor="edit-style" edited={edited('style')}>
            <select id="edit-style" className={selectClass} value={draft.style ?? ''} disabled={busy} onChange={(event) => update({ style: (event.target.value || null) as StyleId | null })}>
              <option value="">Sin estilo</option>
              {(Object.keys(STYLES) as StyleId[]).map((id) => <option key={id} value={id}>{STYLES[id].label.es}</option>)}
            </select>
          </Field>
          <Field label="Ícono" htmlFor="edit-icon" edited={edited('icon_category')}>
            <select id="edit-icon" className={selectClass} value={draft.iconCategory ?? ''} disabled={busy} onChange={(event) => update({ iconCategory: (event.target.value || null) as IconCategory | null })}>
              <option value="">Sin categoría</option>
              {(Object.keys(ICON_CATEGORIES) as IconCategory[]).map((id) => (
                <option key={id} value={id}>{ICON_CATEGORIES[id].emoji} {ICON_CATEGORIES[id].description}</option>
              ))}
            </select>
          </Field>
          <Field label="Precio" htmlFor="edit-price" edited={edited('price')}>
            <select id="edit-price" className={selectClass} value={draft.price} disabled={busy} onChange={(event) => update({ price: event.target.value as PriceLevel })}>
              {PRICE_LEVELS.map((id) => <option key={id} value={id}>{PRICE_LABELS[id]}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {([['dietVegan', 'Vegano', 'diet_vegan'], ['dietVegetarian', 'Vegetariano', 'diet_vegetarian'], ['dietGlutenFree', 'Sin gluten', 'diet_gluten_free']] as const).map(([key, text, field]) => (
            <Field key={key} label={text} htmlFor={`edit-${key}`} edited={edited(field)}>
              <select id={`edit-${key}`} className={selectClass} value={draft[key]} disabled={busy} onChange={(event) => update({ [key]: event.target.value as DietLevel })}>
                {DIET_LEVELS.map((id) => <option key={id} value={id}>{DIET_LABELS[id]}</option>)}
              </select>
            </Field>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Instagram" htmlFor="edit-instagram" edited={edited('instagram')} error={errors.instagram}>
            <Input
              id="edit-instagram"
              value={draft.noInstagram ? '' : draft.instagramInput}
              placeholder={draft.noInstagram ? 'No tiene Instagram' : '@usuario o URL del perfil'}
              disabled={busy || draft.noInstagram}
              onChange={(event) => update({ instagramInput: event.target.value })}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" className="size-3.5 accent-primary" checked={draft.noInstagram} disabled={busy} onChange={(event) => update({ noInstagram: event.target.checked })} />
              No tiene Instagram
            </label>
          </Field>
          <Field label="Web" htmlFor="edit-website" edited={edited('website')} error={errors.website}>
            <Input id="edit-website" type="url" value={draft.website} placeholder="https://…" disabled={busy} onChange={(event) => update({ website: event.target.value })} />
          </Field>
        </div>

        {sharedOwners && (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>Ese Instagram ya lo tiene otro lugar</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <ul className="list-disc pl-4">
                {sharedOwners.map((owner) => (
                  <li key={owner.id}>{owner.name} ({neighborhoodDisplayName(owner.neighborhoodId)}){owner.brandKey ? ` · marca ${owner.brandKey}` : ''}</li>
                ))}
              </ul>
              <span>Si es otra sucursal de la misma marca, se agrupan. Si no, revisá el handle.</span>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={busy} onClick={() => void save(true)}>Es otra sucursal: guardar</Button>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setSharedOwners(null)}>Cancelar</Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Marca (brand_key)" htmlFor="edit-brand" edited={edited('brand_key')} error={errors.brandKey}>
            <Input id="edit-brand" list="edit-brand-keys" value={draft.brandKey} placeholder="Sin marca" disabled={busy} onChange={(event) => update({ brandKey: event.target.value })} />
            <datalist id="edit-brand-keys">
              {place!.brandKeys.map((key) => <option key={key} value={key} />)}
            </datalist>
          </Field>
          <Field label="Destacado">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={draft.featured} disabled={busy} onChange={(event) => update({ featured: event.target.checked })} />
              Destacar en la app
            </label>
          </Field>
        </div>

        <Field label="Logo" edited={edited('logo') || Boolean(draft.logo)}>
          <div className="flex flex-wrap items-center gap-3">
            <PlaceLogo name={draft.name || place!.name} {...logoPreview} />
            <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-sm hover:bg-muted ${busy || uploading ? 'pointer-events-none opacity-60' : ''}`}>
              {uploading ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Upload className="size-3.5" aria-hidden="true" />}
              {uploading ? 'Procesando…' : 'Subir logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="sr-only"
                aria-label="Subir logo"
                disabled={busy || uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void upload(file)
                }}
              />
            </label>
            {draft.logo && <span className="text-xs text-muted-foreground">Subido (clasificación {usd(draft.logo.classificationUsd)}); se guarda con el lugar.</span>}
          </div>
          {uploadError && <p className="text-xs text-destructive" role="alert">{uploadError}</p>}
        </Field>

        <section aria-label="Recálculo al guardar" className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
          <p className="font-medium">Al guardar</p>
          {!changed && <p className="text-muted-foreground">No hay cambios.</p>}
          {changed && hasErrors && <p className="text-muted-foreground">Corregí los campos marcados.</p>}
          {plan.status === 'loading' && <p className="flex items-center gap-2 text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />Calculando qué se recalcula…</p>}
          {plan.status === 'error' && <p className="text-destructive" role="alert">{plan.message}</p>}
          {plan.status === 'ready' && (
            <>
              <ul className="mt-1 grid gap-0.5">
                {plan.plan.steps.map((step) => (
                  <li key={`${step.id}-${step.label}`} className="flex justify-between gap-3">
                    <span>{step.label}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{usd(step.costUsd)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 border-t pt-1.5 text-right font-medium tabular-nums">Total: {usd(plan.plan.totalUsd)}</p>
            </>
          )}
        </section>

        {saveError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>No se pudo guardar</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}
        {warnings.length > 0 && (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>Guardado, con avisos</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </AlertDescription>
          </Alert>
        )}

        <section aria-label="Eliminar" className="rounded-lg border border-destructive/30 px-3 py-2.5">
          {!confirmDelete ? (
            <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-3.5" aria-hidden="true" />
              Eliminar lugar
            </Button>
          ) : (
            <div className="grid gap-2 text-sm">
              <p className="font-medium">¿Eliminar {place!.name}? No se puede deshacer.</p>
              <p className="text-muted-foreground">
                El snapshot pasa a cache/extractions/deleted/ y el logo queda en R2 hasta yarn logos:cleanup. Si comparte marca, las otras
                sucursales se reagrupan. Un barrido nuevo lo va a mostrar como nuevo.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void remove()}>
                  {deleting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="size-3.5" aria-hidden="true" />}
                  Sí, eliminar
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancelar</Button>
              </div>
              {deleteError && <p className="text-xs text-destructive" role="alert">{deleteError}</p>}
            </div>
          )}
        </section>
      </div>

      <DialogFooter className="mx-0 mb-0 px-5 py-3">
        <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={busy || uploading || !changed || hasErrors}>
          {saving && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
          Guardar
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Link a la ficha del lugar en Google Maps: la dirección y el teléfono están ahí. */
function PlaceMapsLink({ place }: { place: PlaceDetail }) {
  const href = googleMapsUrl(place)
  if (!href) return <p className="text-sm text-muted-foreground">Sin ficha de Google Maps</p>
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-sm underline-offset-4 hover:underline">
      <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      Ver en Google Maps
      <ArrowUpRight className="size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">(abre Google Maps en una nueva pestaña)</span>
    </a>
  )
}
