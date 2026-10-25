import { serve } from '@hono/node-server'
import { config } from 'dotenv'
import { createApp } from './app.ts'
import { ApifyInstagramProvider } from './providers/apify-instagram-provider.ts'
import { ExaPlaceSearchProvider } from './providers/exa-place-provider.ts'
import { R2LogoStorage } from './providers/logo-storage.ts'
import { archiveSnapshot, fileSnapshotStore } from './providers/extraction-snapshots.ts'
import { GooglePlacesProvider } from './providers/google-places-provider.ts'
import { GoogleNeighborhoodSweeper } from './providers/neighborhood-sweep.ts'
import { fileReportWriter } from './providers/extraction-report.ts'
import { DEFAULT_MAX_CALLS } from './providers/neighborhood-sweep-config.ts'
import { extractionCostRates, PlaceExtractionService } from './providers/place-extraction-service.ts'
import { classifyLogo, logoModel } from './providers/place-logo.ts'
import { APIFY_TRANSIENT_DELAYS_MS, withRateLimitRetry } from './providers/rate-limit.ts'
import { withServiceLimit } from './providers/service-limits.ts'
import { MontevideoBusProvider } from './providers/montevideo-bus-provider.ts'
import { OpenStreetMapProvider } from './providers/openstreetmap-provider.ts'
import { PlaywrightWebsiteScraper } from './providers/website-scraper.ts'

config({ path: '.env', quiet: true })
config({ path: '.env.local', override: true, quiet: true })

const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim()
const provider = apiKey ? new GooglePlacesProvider(apiKey) : undefined
const configuredMaxCalls = Number(process.env.NEIGHBORHOOD_SWEEP_MAX_CALLS)
const sweeper = apiKey
  ? new GoogleNeighborhoodSweeper({
      apiKey,
      maxCalls: Number.isInteger(configuredMaxCalls) && configuredMaxCalls > 0 ? configuredMaxCalls : DEFAULT_MAX_CALLS,
    })
  : undefined
const exaProvider = new ExaPlaceSearchProvider()
const instagramProvider = new ApifyInstagramProvider({
  token: process.env.APIFY_API_TOKEN,
  actorId: process.env.APIFY_INSTAGRAM_ACTOR_ID,
  memoryMbytes: Number(process.env.APIFY_MEMORY_MB) || undefined,
})
const matchProviders = {
  openstreetmap: new OpenStreetMapProvider({
    endpoint: process.env.OSM_OVERPASS_URL ?? '',
    userAgent: process.env.OSM_USER_AGENT ?? '',
  }),
}
const transitProvider = new MontevideoBusProvider({
  clientId: process.env.IM_CLIENT_ID,
  clientSecret: process.env.IM_CLIENT_SECRET,
})
const websiteScraper = new PlaywrightWebsiteScraper()
const logoStorage = new R2LogoStorage()
// Neon es opcional: sin DATABASE_URL el server arranca igual y /api/places responde 503.
const database = process.env.DATABASE_URL?.trim()
  ? await (async () => {
      const [{ db }, { drizzlePlacesStore, gatewayEmbedder, placesSaver }, { drizzleBrandSiblings, drizzleInstagramOwners, drizzleManualInstagram, drizzlePlacesReader }, { drizzleEditStore, placeEditor }] = await Promise.all([
        import('./db/index.ts'),
        import('./places/save.ts'),
        import('./places/list.ts'),
        import('./places/edit.ts'),
      ])
      return {
        placesSaver: placesSaver(drizzlePlacesStore(db)),
        placeEditor: placeEditor({
          store: drizzleEditStore(db),
          embed: gatewayEmbedder,
          // Como el pipeline: cupo de Apify compartido, reintentos por 429 y por fallas pasajeras.
          scrapeInstagram: instagramProvider.configured
            ? (url) => withRateLimitRetry('apify', () => withServiceLimit('apify', () => instagramProvider.scrape(url)), null, { transientDelaysMs: APIFY_TRANSIENT_DELAYS_MS })
            : undefined,
          logo: { storage: logoStorage, classify: classifyLogo, model: logoModel() },
          instagramRunUsd: extractionCostRates().instagramRunUsd,
          archiveSnapshot: (googlePlaceId) => archiveSnapshot(googlePlaceId),
          // El extractor se crea después: se busca al borrar.
          forget: (googlePlaceId) => extractor?.forget(googlePlaceId),
        }),
        placesReader: drizzlePlacesReader(db),
        instagramOwners: drizzleInstagramOwners(db),
        manualInstagram: drizzleManualInstagram(db),
        brandSiblings: drizzleBrandSiblings(db),
      }
    })()
  : undefined
const extractor = provider
  ? new PlaceExtractionService({
      apiKey: process.env.AI_GATEWAY_API_KEY,
      details: provider,
      exa: exaProvider,
      instagram: instagramProvider,
      website: websiteScraper,
      transit: transitProvider,
      logoStorage,
      // Salida del modelo y fuentes en cache/extractions, para yarn extraction:replay.
      snapshots: fileSnapshotStore(),
      // Un Instagram ya guardado para otro lugar no es candidato (cuentas agregadoras).
      instagramOwners: database?.instagramOwners,
      // El Instagram cargado a mano en un procesamiento anterior gana al reprocesar.
      manualInstagram: database?.manualInstagram,
      brandSiblings: database?.brandSiblings,
    })
  : undefined
const apiPort = Number(process.env.BACKOFFICE_API_PORT ?? 8787)

serve(
  {
    fetch: createApp({
      provider,
      exaProvider,
      instagramConfigured: instagramProvider.configured,
      extractor,
      matchProviders,
      sweeper,
      reportWriter: fileReportWriter(),
      placesSaver: database?.placesSaver,
      placesReader: database?.placesReader,
      placeEditor: database?.placeEditor,
    }).fetch,
    hostname: '127.0.0.1',
    port: apiPort,
  },
  (info) => {
    console.log(`API local disponible en http://127.0.0.1:${info.port}`)
  },
)
