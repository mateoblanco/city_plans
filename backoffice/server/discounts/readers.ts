import type { DiscountProviderId } from './providers.ts'
import type { ProviderReader } from './reader.ts'
import { readBbva } from './bbva/reader.ts'
import { readSantander } from './santander/reader.ts'
import { readItau } from './itau/reader.ts'

/** El lector de cada proveedor configurado. */
export const DISCOUNT_READERS: Record<DiscountProviderId, ProviderReader> = {
  bbva: readBbva,
  santander: readSantander,
  itau: readItau,
  'itau-personal-bank': readItau,
}
