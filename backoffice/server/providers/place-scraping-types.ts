import type { ApiErrorCode } from '../../src/types/places.ts'

export type ScrapeSourceStatus = 'success' | 'not_found' | 'error'

export type ScrapeDiscoverySource =
  | 'google_places'
  | 'website_link'
  | 'google_search'
  | 'user_selected'

export type ScrapeSourceError = {
  code: ApiErrorCode
  message: string
}

export type WebsiteScrapeResult = {
  status: ScrapeSourceStatus
  url: string | null
  discoveredVia?: ScrapeDiscoverySource
  title?: string
  description?: string
  content?: string
  instagramUrls?: string[]
  links?: string[]
  error?: ScrapeSourceError
}

export type InstagramScrapeResult = {
  status: ScrapeSourceStatus
  url: string | null
  discoveredVia?: ScrapeDiscoverySource
  name?: string
  bio?: string
  links?: string[]
  posts?: string[]
  error?: ScrapeSourceError
}

export type DiscoveryCandidate = {
  kind: 'website' | 'instagram'
  url: string
  title: string
  snippet: string | null
  confidence: 'medium' | 'low'
  evidence: string[]
}

export type PlaceScrapeRequest = {
  refresh?: boolean
  selectedCandidate?: Pick<DiscoveryCandidate, 'kind' | 'url'>
}

export type PlaceScrapeResponse = {
  source: 'scraping'
  scrapedInfo: string
  website: WebsiteScrapeResult
  instagram: InstagramScrapeResult
  discovery: {
    googleSearchAttempted: boolean
    websiteCandidates: DiscoveryCandidate[]
    instagramCandidates: DiscoveryCandidate[]
    instagramHintReview?: 'unverified' | 'location_mismatch'
  }
  attribution: string
}
