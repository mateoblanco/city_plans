import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MontevideoBusProvider } from './montevideo-bus-provider.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function feature(id: number, longitude: number, latitude: number, line: string) {
  return { type: 'Feature', properties: { COD_UBIC_P: id, DESC_LINEA: line }, geometry: { type: 'Point', coordinates: [longitude, latitude] } }
}

async function fixtureDirectory(features = [
  feature(100, -56.17, -34.9, '10'),
  feature(100, -56.17, -34.9, 'D10'),
  feature(200, -56.17, -34.899, '2'),
  feature(200, -56.17, -34.899, '10'),
]) {
  const directory = await mkdtemp(join(tmpdir(), 'mvd-bus-provider-'))
  directories.push(directory)
  const stopsPath = join(directory, 'paradas.json')
  await writeFile(stopsPath, JSON.stringify({ type: 'FeatureCollection', features }))
  return { stopsPath }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function provider(stopsPath: string, fetcher: typeof fetch, credentials = true) {
  return new MontevideoBusProvider({
    ...(credentials ? { clientId: 'client-id', clientSecret: 'client-secret' } : {}),
    stopsPath,
    fetcher,
    now: () => 0,
  })
}

describe('MontevideoBusProvider', () => {
  it('obtiene líneas cercanas directamente del índice local de paradas', async () => {
    const { stopsPath } = await fixtureDirectory()
    const fetcherMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/token')) return json({ access_token: 'token', expires_in: 300 })
      return json([
        { line: '10', origin: 'CIUDAD VIEJA', destination: 'MALVÍN' },
        { line: '10', origin: 'MALVÍN', destination: 'CIUDAD VIEJA' },
        { line: '2', origin: 'PORTONES', destination: 'PARQUE RODÓ' },
      ])
    })
    const fetcher = fetcherMock as unknown as typeof fetch

    const result = await provider(stopsPath, fetcher).findNearbyLines(-34.9, -56.17)

    expect(result).toEqual({
      status: 'success',
      lines: [
        { line: '2', stopId: '200', meters: 111 },
        { line: '10', stopId: '100', meters: 0 },
        { line: 'D10', stopId: '100', meters: 0 },
      ],
    })
    expect(fetcherMock).not.toHaveBeenCalled()
  })

  it('no depende del catálogo remoto para devolver líneas locales', async () => {
    const { stopsPath } = await fixtureDirectory([feature(100, -56.17, -34.9, '121')])
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      String(input).includes('/token') ? json({ access_token: 'token', expires_in: 300 }) : json({}, 500),
    ) as unknown as typeof fetch

    const result = await provider(stopsPath, fetcher).findNearbyLines(-34.9, -56.17)

    expect(result).toEqual({ status: 'success', lines: [{ line: '121', stopId: '100', meters: 0 }] })
  })

  it('funciona con el dataset local aunque no haya credenciales', async () => {
    const { stopsPath } = await fixtureDirectory([feature(100, -56.17, -34.9, '121')])
    const fetcher = vi.fn() as unknown as typeof fetch

    const result = await provider(stopsPath, fetcher, false).findNearbyLines(-34.9, -56.17)

    expect(result).toEqual({ status: 'success', lines: [{ line: '121', stopId: '100', meters: 0 }] })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('no devuelve líneas si no hay paradas a menos de 500 metros', async () => {
    const { stopsPath } = await fixtureDirectory([feature(100, -56.17, -34.91, '121')])

    const result = await provider(stopsPath, vi.fn() as unknown as typeof fetch, false).findNearbyLines(-34.9, -56.17)

    expect(result).toEqual({ status: 'success', lines: [] })
  })

  it('amplía de 350 a 500 metros y excluye líneas especiales', async () => {
    const { stopsPath } = await fixtureDirectory([
      feature(100, -56.17, -34.8965, 'CARNAVAL'),
      feature(200, -56.17, -34.8965, '121'),
    ])
    const result = await provider(stopsPath, vi.fn() as unknown as typeof fetch, false).findNearbyLines(-34.9, -56.17)

    expect(result.lines).toEqual([{ line: '121', stopId: '200', meters: 389 }])
  })
})
