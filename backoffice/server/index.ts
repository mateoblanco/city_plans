import { serve } from '@hono/node-server'
import { config } from 'dotenv'
import { createApp } from './app.ts'
import { ApifyInstagramProvider } from './providers/apify-instagram-provider.ts'
import { ExaPlaceSearchProvider } from './providers/exa-place-provider.ts'
import { GooglePlacesProvider } from './providers/google-places-provider.ts'
import { GoogleNeighborhoodSweeper } from './providers/neighborhood-sweep.ts'
import { fileReportWriter } from './providers/extraction-report.ts'
import { DEFAULT_MAX_CALLS } from './providers/neighborhood-sweep-config.ts'
import { PlaceExtractionService } from './providers/place-extraction-service.ts'
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
const extractor = provider
  ? new PlaceExtractionService({
      apiKey: process.env.AI_GATEWAY_API_KEY,
      details: provider,
      exa: exaProvider,
      instagram: instagramProvider,
      website: websiteScraper,
      transit: transitProvider,
    })
  : undefined
// Neon es opcional: sin DATABASE_URL el server arranca igual y /api/places responde 503.
const database = process.env.DATABASE_URL?.trim()
  ? await (async () => {
      const [{ db }, { drizzlePlacesStore, placesSaver }, { drizzlePlacesReader }] = await Promise.all([
        import('./db/index.ts'),
        import('./places/save.ts'),
        import('./places/list.ts'),
      ])
      return { placesSaver: placesSaver(drizzlePlacesStore(db)), placesReader: drizzlePlacesReader(db) }
    })()
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
    }).fetch,
    hostname: '127.0.0.1',
    port: apiPort,
  },
  (info) => {
    console.log(`API local disponible en http://127.0.0.1:${info.port}`)
  },
)
