// Borra de R2 los logos que ninguna fila de places usa (extracciones que no se guardaron o logos
// reemplazados) y que tienen más de 24 h; los más nuevos se saltean porque pueden ser de una
// extracción que todavía no se guardó. Uso: yarn logos:cleanup [--dry-run]
import './env.ts'
import { isNotNull } from 'drizzle-orm'
import { places } from '../db/schema.ts'
import { cleanupLogos } from '../places/logo-cleanup.ts'
import { R2LogoStorage } from '../providers/logo-storage.ts'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')
  const storage = new R2LogoStorage()
  if (!storage.configured) throw new Error('Falta configurar R2_ENDPOINT, R2_REGION, R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY.')
  const { db } = await import('../db/index.ts')
  const { total, orphans, recent, deleted } = await cleanupLogos({
    listBucket: (prefix) => storage.list(prefix),
    usedKeys: async () => (await db.select({ key: places.logoKey }).from(places).where(isNotNull(places.logoKey))).map((row) => row.key),
    deleteKeys: (keys) => storage.deleteMany(keys),
  }, { dryRun })
  console.log(dryRun ? `A borrar (sin fila y con más de 24 h): ${orphans.length}` : `Borrados (sin fila y con más de 24 h): ${deleted}`)
  for (const { key, lastModified } of orphans) console.log(`  ${key}  ${lastModified.toISOString()}`)
  console.log(`Salteados por recientes (sin fila, menos de 24 h): ${recent.length}`)
  for (const { key, lastModified } of recent) console.log(`  ${key}  ${lastModified.toISOString()}`)
  console.log(`${total} logos en el bucket${dryRun ? ' · dry run: no se borró nada' : ''}.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
