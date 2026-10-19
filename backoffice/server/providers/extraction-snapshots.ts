import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GooglePlaceDetailsResponse, InstagramAuditCandidate, PlaceEnrichmentDraft, PlaceReview } from '../../src/types/places.ts'
import type { TransitInfo } from './montevideo-bus-provider.ts'
import type { InstagramActivity } from './review-reasons.ts'
import {
  postProcess,
  targetFromDetails,
  type DeterministicContact,
  type PlaceExtraction,
  type PlaceExtractionRequest,
  type ProminenceSourceSignals,
  type Source,
} from './place-extraction-service.ts'

/**
 * Lo que hace falta para volver a correr postProcess sin pagar el LLM ni las fuentes: la salida del modelo y las
 * fuentes que leyó. Nada de Google (ni nombre, ni dirección, ni coordenadas): la re-corrida vuelve a pedir Place
 * Details para el local objetivo.
 */
export type ExtractionSnapshot = {
  googlePlaceId: string
  savedAt: string
  model: string
  request: PlaceExtractionRequest
  transit: TransitInfo
  sources: Source[]
  deterministicContact: DeterministicContact
  prominenceSignals: ProminenceSourceSignals | null
  /** Actividad del Instagram validado al extraer (null sin Instagram). Falta en snapshots de antes. */
  instagramActivity?: InstagramActivity | null
  llmOutput: PlaceExtraction
  /**
   * Para diagnosticar el Instagram: cada candidato con sus fuentes (origins), la decisión y la regla que lo aceptó o
   * rechazó; el que validó Apify, si el modelo lo rechazó y el que quedó guardado. Falta en snapshots de antes.
   */
  instagramAudit?: {
    candidates: InstagramAuditCandidate[]
    validated: string | null
    modelRejected: boolean
    saved: string | null
    fallback?: PlaceReview['instagramFallback']
    tieBreak?: PlaceReview['instagramTieBreak']
  }
}

export type ExtractionSnapshotStore = { save(snapshot: ExtractionSnapshot): Promise<void> }

export const DEFAULT_SNAPSHOT_DIR = 'cache/extractions'

const fileName = (googlePlaceId: string) => `${googlePlaceId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`

/** Un archivo por lugar (el último pisa al anterior), en una carpeta fuera de git. */
export function fileSnapshotStore(dir = DEFAULT_SNAPSHOT_DIR): ExtractionSnapshotStore {
  return {
    async save(snapshot) {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, fileName(snapshot.googlePlaceId)), JSON.stringify(snapshot))
    },
  }
}

export async function readSnapshots(dir = DEFAULT_SNAPSHOT_DIR): Promise<ExtractionSnapshot[]> {
  const files = (await readdir(dir).catch(() => [] as string[])).filter((file) => file.endsWith('.json'))
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(join(dir, file), 'utf8')) as ExtractionSnapshot))
}

/** postProcess con la salida guardada y el local objetivo de un Place Details nuevo (la única llamada paga). */
export async function replaySnapshot(snapshot: ExtractionSnapshot, details: { getDetails(placeId: string): Promise<GooglePlaceDetailsResponse> }): Promise<PlaceEnrichmentDraft> {
  const target = targetFromDetails(snapshot.googlePlaceId, await details.getDetails(snapshot.googlePlaceId), snapshot.request, snapshot.transit)
  return postProcess(target, snapshot.llmOutput, {
    sources: snapshot.sources,
    seedCategories: snapshot.request.seedCategories,
    deterministicContact: snapshot.deterministicContact,
    prominenceSignals: snapshot.prominenceSignals ?? undefined,
    categoryFallback: [],
  })
}
