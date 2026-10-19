import type { LogoObject } from '../providers/logo-storage.ts'

export const MIN_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Objetos de R2 que ninguna fila de places usa. Sólo son borrables (orphans) los de más de 24 h:
 * los más nuevos (recent) pueden ser de una extracción que todavía no se guardó.
 */
export function classifyLogoObjects(
  objects: readonly LogoObject[],
  usedKeys: readonly (string | null)[],
  now: Date,
  minAgeMs = MIN_ORPHAN_AGE_MS,
): { orphans: LogoObject[]; recent: LogoObject[] } {
  const used = new Set(usedKeys.filter(Boolean))
  const unused = objects.filter((object) => !used.has(object.key)).sort((a, b) => a.key.localeCompare(b.key))
  const old = (object: LogoObject) => now.getTime() - object.lastModified.getTime() > minAgeMs
  return { orphans: unused.filter(old), recent: unused.filter((object) => !old(object)) }
}

type CleanupDeps = {
  listBucket(prefix: string): Promise<LogoObject[]>
  usedKeys(): Promise<(string | null)[]>
  deleteKeys(keys: string[]): Promise<number>
}

/** Con dryRun sólo informa; si no, borra las huérfanas de más de 24 h. */
export async function cleanupLogos(deps: CleanupDeps, { dryRun, now = new Date() }: { dryRun: boolean; now?: Date }) {
  const [objects, usedKeys] = await Promise.all([deps.listBucket('logos/'), deps.usedKeys()])
  const { orphans, recent } = classifyLogoObjects(objects, usedKeys, now)
  const deleted = dryRun || orphans.length === 0 ? 0 : await deps.deleteKeys(orphans.map((object) => object.key))
  return { total: objects.length, orphans, recent, deleted }
}
