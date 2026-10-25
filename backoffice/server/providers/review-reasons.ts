import type { ReviewReason } from '../../src/data/review-reasons.ts'
import type { PlaceEnrichmentDraft, PlaceReview, PlaceReviewAnomalyType } from '../../src/types/places.ts'

// Frases de un local que todavía no abrió. "apertura" suelta no: "horario de apertura" o
// "desde su apertura en 2015" son de locales abiertos. Se comparan sin acentos y en minúscula.
const NOT_OPEN_YET = [
  /\bproximamente\b/,
  /\b(todavia|aun) no (abrio|abrimos|abre|esta abierto)\b/,
  /\b(abre|abrimos|abrira|abriremos|abriran) (muy )?pronto\b/,
  /\bpronto abrimos\b/,
  /\b(abrira|abriremos|abriran) (sus puertas|proximamente)\b/,
  /\bproxima apertura\b/,
  /\bestamos por abrir\b/,
  /\b(coming|opening) soon\b/,
]

// Anomalías del resumen que no dejan publicar. cuisine_unmentioned queda sólo como anomalía.
const BLOCKING_ANOMALIES: readonly (PlaceReviewAnomalyType & ReviewReason)[] = ['restaurant_without_food', 'bar_without_drinks']

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// El prompt pide este prefijo cuando no puede confirmar que los datos que usó son de este local. Sin prefijo no
// cuenta: "descarté las fuentes de otra sucursal" es el modelo haciendo bien su trabajo, no un local dudoso.
const UNCONFIRMED_PLACE_PREFIX = /^local no confirmado\s*:/

// En una cadena, «Sucursal no confirmada:» (o un «Local no confirmado:» que sólo dice que las fuentes no distinguen
// sucursal) es de la marca: carta, tags y estilo valen igual. Patrón estrecho: «sucursales colombianas» no entra.
const BRANCH_ONLY_PREFIX = /^sucursal no confirmada\s*:/
const BRANCH_ONLY_TEXT = /\bno distinguen? (?:entre )?(?:la |las )?sucursal(?:es)?\b/

export function soundsUnconfirmedPlace(doubt: string) {
  const value = normalize(doubt.trim())
  return UNCONFIRMED_PLACE_PREFIX.test(value) || BRANCH_ONLY_PREFIX.test(value)
}

/** La duda es sólo que las fuentes de la marca no dicen de qué sucursal son, no que sean de otro negocio. */
export function soundsBranchOnlyDoubt(doubt: string) {
  const value = normalize(doubt.trim())
  return BRANCH_ONLY_PREFIX.test(value) || (UNCONFIRMED_PLACE_PREFIX.test(value) && BRANCH_ONLY_TEXT.test(value))
}

export function soundsNotOpenYet(text: string) {
  const value = normalize(text)
  return NOT_OPEN_YET.some((pattern) => pattern.test(value))
}

/**
 * Señales del Instagram oficial (el perfil validado) para saber si el local está funcionando. Se guarda en el
 * snapshot para que el replay pueda recalcular los motivos.
 */
export type InstagramActivity = {
  /** Post más nuevo (ISO), si Apify trae fechas. */
  latestPostAt: string | null
  /** La bio tiene horarios ("9:00 a 20:00", "Abrimos 22 hs"). */
  bioHasHours: boolean
  /** La bio o el último post dicen que todavía no abrió. */
  notOpenYet: boolean
}

// Un post de los últimos 60 días cuenta como actividad reciente.
export const RECENT_POST_DAYS = 60
const BIO_HOURS = /\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*(?:hs|h)\b/

export function instagramActivity(profile: { bio: string; posts?: string[]; latestPostAt?: string }): InstagramActivity {
  return {
    latestPostAt: profile.latestPostAt ?? null,
    bioHasHours: BIO_HOURS.test(normalize(profile.bio)),
    notOpenYet: [profile.bio, profile.posts?.[0] ?? ''].some(soundsNotOpenYet),
  }
}

/**
 * El Instagram oficial muestra el local funcionando: no dice "próximamente" y tiene un post reciente o horarios en la
 * bio. Vale más que la web o terceros para decidir si está abierto. `now` es el momento de la extracción.
 */
export function instagramOperating(activity: InstagramActivity | null | undefined, now: Date): boolean {
  if (!activity || activity.notOpenYet) return false
  const latest = activity.latestPostAt ? Date.parse(activity.latestPostAt) : NaN
  const recent = Number.isFinite(latest) && now.getTime() - latest <= RECENT_POST_DAYS * 24 * 60 * 60 * 1000
  return recent || activity.bioHasHours
}

/**
 * Motivos para guardar el lugar con status review en vez de published: no abrió todavía (facts o dudas
 * del modelo, salvo que el Instagram oficial lo muestre funcionando), ningún fact del local (todas las fuentes eran
 * de otros lugares) o una anomalía grave. En una cadena (chainBranch), una duda de local que sólo dice que las fuentes
 * no distinguen sucursal no cuenta.
 */
export function reviewReasonsFor(
  place: Pick<PlaceEnrichmentDraft, 'placeFacts'>,
  review: Pick<PlaceReview, 'doubts' | 'anomalies'>,
  signals: { instagramOperating?: boolean; chainBranch?: boolean } = {},
): ReviewReason[] {
  const reasons: ReviewReason[] = []
  const saysNotOpen = [...place.placeFacts.map((fact) => fact.text), ...review.doubts].some(soundsNotOpenYet)
  if (saysNotOpen && !signals.instagramOperating) reasons.push('not_open_yet')
  if (place.placeFacts.length === 0) reasons.push('no_place_facts')
  // Sin facts ya va por no_place_facts: el motivo nuevo es para cuando hay datos y pueden ser de otro local.
  else {
    const unconfirmed = review.doubts.filter(soundsUnconfirmedPlace)
    if (unconfirmed.length > 0 && !(signals.chainBranch && unconfirmed.every(soundsBranchOnlyDoubt))) reasons.push('unconfirmed_place')
  }
  const anomalies = new Set(review.anomalies.map((anomaly) => anomaly.type))
  for (const type of BLOCKING_ANOMALIES) if (anomalies.has(type)) reasons.push(type)
  return reasons
}
