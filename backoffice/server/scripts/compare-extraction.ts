// Compara configuraciones de modelo de extracción con las mismas fuentes.
// Uso: npx tsx --env-file=.env server/scripts/compare-extraction.ts <carpeta-de-salida> [--only a|b]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CategoryId } from '../../src/data/tags.ts'
import type { PlaceEnrichmentResponse } from '../../src/types/places.ts'
import { ApifyInstagramProvider } from '../providers/apify-instagram-provider.ts'
import { ExaPlaceSearchProvider } from '../providers/exa-place-provider.ts'
import { GooglePlacesProvider } from '../providers/google-places-provider.ts'
import { MontevideoBusProvider } from '../providers/montevideo-bus-provider.ts'
import { PlaceExtractionService, type ExtractionModelConfig } from '../providers/place-extraction-service.ts'
import { PlaywrightWebsiteScraper } from '../providers/website-scraper.ts'

const PLACES: { query: string; seed: CategoryId }[] = [
  { query: 'Oriundo Montevideo', seed: 'wine_bar' },
  { query: 'Namasté Montevideo', seed: 'restaurant' },
  { query: 'El Palenque Montevideo', seed: 'grill' },
  { query: "Baker's Bar Montevideo", seed: 'bar' },
  { query: 'Culto Café La Tostaduría Montevideo', seed: 'cafe' },
  { query: 'Casa Berracos Montevideo', seed: 'cafe' },
  { query: 'Oviedo Bar Montevideo', seed: 'bar' },
]

const CONFIGS: Record<'a' | 'b', ExtractionModelConfig> = {
  a: { model: 'openai/gpt-5-mini', reasoning: 'low' },
  b: { model: 'anthropic/claude-sonnet-5.5', reasoning: 'medium' },
}

const DAY_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

function hoursSummary(response: PlaceEnrichmentResponse) {
  if (response.status !== 'ok') return 'sin fuentes'
  const { slots, status } = response.place.hours
  const byPeriod = new Map<string, number[]>()
  for (const slot of slots) {
    const key = `${slot.opens}–${slot.closes ?? '?'}`
    byPeriod.set(key, [...(byPeriod.get(key) ?? []), slot.day])
  }
  const periods = [...byPeriod].map(([period, days]) => `${days.map((day) => DAY_NAMES[day]).join(',')} ${period}`).join('; ')
  return `${slots.length} slots, ${status}${periods ? ` (${periods})` : ''}`
}

function row(name: string, label: string, response: PlaceEnrichmentResponse | Error) {
  if (response instanceof Error) return `| ${name} | ${label} | ERROR: ${response.message.replaceAll('|', '/')} (${String((response.cause as Error | undefined)?.message ?? '').slice(0, 200).replaceAll('|', '/').replaceAll('\n', ' ')}) | | | | | | |`
  if (response.status !== 'ok') return `| ${name} | ${label} | sin fuentes | | | | | | |`
  const { place, performance } = response
  const dietary = `vegan ${place.dietary.vegan}, veg ${place.dietary.vegetarian}, sin TACC ${place.dietary.glutenFree}`
  const llm = performance.costUsd.providers.llm
  return [
    name, label, place.categories.join(', '), place.tags.join(', '), dietary, hoursSummary(response),
    place.highlights.map((highlight) => highlight.es).join('; '),
    `${((performance.stepsMs.llm ?? 0) / 1000).toFixed(1)} s`,
    `${llm.costUsd.toFixed(4)} (${llm.inputTokens ?? '?'} in / ${llm.outputTokens ?? '?'} out${llm.gatewayCostUsd !== null ? `; gateway ${llm.gatewayCostUsd.toFixed(4)}` : ''})`,
  ].map((cell) => String(cell).replaceAll('|', '/')).join(' | ').replace(/^/, '| ').concat(' |')
}

// Un Error no se serializa a JSON: se guarda el mensaje y la causa completa.
function serializable(response: PlaceEnrichmentResponse | Error) {
  return response instanceof Error ? { error: response.message, cause: String((response.cause as Error | undefined)?.message ?? response.cause ?? '') } : response
}

async function main() {
  const outDir = process.argv[2]
  if (!outDir) throw new Error('Falta la carpeta de salida.')
  const onlyIndex = process.argv.indexOf('--only')
  const only = onlyIndex > 0 ? process.argv[onlyIndex + 1] : null
  if (only && only !== 'a' && only !== 'b') throw new Error('--only acepta a o b.')
  const labels = only ? [only as 'a' | 'b'] : (['a', 'b'] as const)
  mkdirSync(outDir, { recursive: true })
  const google = new GooglePlacesProvider(process.env.GOOGLE_PLACES_API_KEY!.trim())
  const service = new PlaceExtractionService({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    details: google,
    exa: new ExaPlaceSearchProvider(),
    instagram: new ApifyInstagramProvider({ token: process.env.APIFY_API_TOKEN, actorId: process.env.APIFY_INSTAGRAM_ACTOR_ID }),
    website: new PlaywrightWebsiteScraper(),
    transit: new MontevideoBusProvider({ clientId: process.env.IM_CLIENT_ID, clientSecret: process.env.IM_CLIENT_SECRET }),
  })

  const rows: string[] = []
  const factsSections: string[] = []
  const descriptions: string[] = []
  let sourcesCost = 0
  let llmCost = { a: 0, b: 0 }
  await Promise.all(PLACES.map(async ({ query, seed }, index) => {
    const found = await google.search({ mode: 'text', query, seedCategory: seed })
    const match = found.items[0]
    if (!match) {
      rows[index] = `| ${query} | sin resultados en Google | | | | | | | |`
      return
    }
    // Las fuentes se buscan UNA vez y se pasan iguales a las dos configuraciones.
    const collected = await service.collectSources(match.placeId, { seedCategories: [seed] })
    // Un error en una configuración se registra en la tabla sin cortar el resto.
    const run = (config: ExtractionModelConfig) => service.extractFrom(collected, config).catch((error: Error) => error)
    const results = Object.fromEntries(await Promise.all(labels.map(async (label) => [label, await run(CONFIGS[label])] as const))) as Partial<Record<'a' | 'b', PlaceEnrichmentResponse | Error>>
    const llmUsd = (response: PlaceEnrichmentResponse | Error | undefined) => !response || response instanceof Error ? 0 : response.performance.costUsd.providers.llm.costUsd
    const sourcesUsd = Object.values(results).find((response): response is PlaceEnrichmentResponse => !(response instanceof Error))
    if (sourcesUsd) sourcesCost += sourcesUsd.performance.costUsd.totalUsd - llmUsd(sourcesUsd)
    llmCost = { a: llmCost.a + llmUsd(results.a), b: llmCost.b + llmUsd(results.b) }
    rows[index] = labels.map((label) => row(match.name, label, results[label]!)).join('\n')
    const factsFrom = results.b ?? results.a
    if (factsFrom && !(factsFrom instanceof Error) && factsFrom.status === 'ok') {
      factsSections[index] = [`### ${match.name}`, '', ...factsFrom.place.placeFacts.map((fact) =>
        `- **${fact.id}**. ${fact.text} — _${fact.kind}, ${fact.sourceId} (${fact.trust})_${fact.supports.length ? ` → ${fact.supports.join(', ')}` : ''}`)].join('\n')
    }
    descriptions[index] = [`### ${match.name}`, ...labels.map((label) => {
      const response = results[label]!
      if (response instanceof Error) return `- **${label}**: error`
      return response.status === 'ok' ? `- **${label}**: ${response.place.description.es} — display: ${response.place.hours.display?.es ?? 'null'}` : `- **${label}**: sin fuentes`
    })].join('\n')
    writeFileSync(join(outDir, `${match.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.json`), JSON.stringify({
      name: match.name, placeId: match.placeId, seed,
      sources: collected.sources.map((source) => ({ id: source.id, kind: source.kind, trust: source.trust, url: source.url, chars: source.text.length })),
      ...Object.fromEntries(labels.map((label) => [label, serializable(results[label]!)])),
    }, null, 2))
  }))

  const report = [
    `# Comparación de extracción`,
    '',
    labels.map((label) => `${label} = ${CONFIGS[label].model} (${CONFIGS[label].reasoning})`).join(' · ') + (labels.length > 1 ? '. Mismas fuentes para a y b.' : ''),
    '',
    `Costo total: fuentes USD ${sourcesCost.toFixed(4)} (una vez por lugar) · ${labels.map((label) => `LLM ${label} USD ${llmCost[label].toFixed(4)}`).join(' · ')}`,
    '',
    '| Lugar | Conf. | categories | tags | dietary | hours | highlights | tiempo LLM | costo LLM USD |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    '## Descripciones y display',
    '',
    ...descriptions.filter(Boolean),
    '',
    `## placeFacts (${labels.includes('b') ? 'b' : 'a'})`,
    '',
    ...factsSections.filter(Boolean),
  ].join('\n')
  writeFileSync(join(outDir, 'comparacion.md'), report)
  console.log(report)
}

await main()
process.exit(0)
