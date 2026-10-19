import { describe, expect, it, vi } from 'vitest'
import { MIN_ORPHAN_AGE_MS, classifyLogoObjects, cleanupLogos } from './logo-cleanup.ts'

const now = new Date('2026-10-16T12:00:00.000Z')
const ago = (ms: number) => new Date(now.getTime() - ms)
const hours = (value: number) => value * 60 * 60 * 1000

describe('limpieza de logos', () => {
  it('borrables son las claves sin fila de más de 24 h; las más nuevas se saltean y las usadas no se tocan', () => {
    const objects = [
      { key: 'logos/viejo-1.webp', lastModified: ago(hours(30)) },
      { key: 'logos/nuevo-2.webp', lastModified: ago(hours(2)) },
      { key: 'logos/usado-3.webp', lastModified: ago(hours(100)) },
      // Justo 24 h todavía no es "más de 24 h".
      { key: 'logos/borde-4.webp', lastModified: ago(MIN_ORPHAN_AGE_MS) },
    ]

    const { orphans, recent } = classifyLogoObjects(objects, ['logos/usado-3.webp', null], now)

    expect(orphans.map((object) => object.key)).toEqual(['logos/viejo-1.webp'])
    expect(recent.map((object) => object.key)).toEqual(['logos/borde-4.webp', 'logos/nuevo-2.webp'])
  })

  it('con --dry-run lista las borrables y las recientes sin borrar; sin él, borra sólo las viejas', async () => {
    const deps = {
      listBucket: vi.fn(async () => [
        { key: 'logos/a-1.webp', lastModified: ago(hours(48)) },
        { key: 'logos/b-2.webp', lastModified: ago(hours(1)) },
        { key: 'logos/c-3.webp', lastModified: ago(hours(48)) },
      ]),
      usedKeys: vi.fn(async () => ['logos/c-3.webp']),
      deleteKeys: vi.fn(async (keys: string[]) => keys.length),
    }

    const dry = await cleanupLogos(deps, { dryRun: true, now })
    expect(dry).toMatchObject({ total: 3, deleted: 0 })
    expect(dry.orphans.map((object) => object.key)).toEqual(['logos/a-1.webp'])
    expect(dry.recent.map((object) => object.key)).toEqual(['logos/b-2.webp'])
    expect(deps.deleteKeys).not.toHaveBeenCalled()

    expect((await cleanupLogos(deps, { dryRun: false, now })).deleted).toBe(1)
    expect(deps.deleteKeys).toHaveBeenCalledWith(['logos/a-1.webp'])
    expect(deps.listBucket).toHaveBeenCalledWith('logos/')
  })
})
