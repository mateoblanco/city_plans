import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { getDb } from '../db'
import { groupBenefits, type PlaceDiscountProvider } from './benefits'
import { discountProvidersQuery, placeBenefitsQuery, type BenefitRow } from './queries'
import { byProviderOrder, isDiscountProvider, providerName } from './selection'

/** Una fila del panel "Descuentos": el proveedor y los tipos de tarjeta de sus beneficios (con "other"). */
export type DiscountProviderOption = { id: string; name: string; cardTypes: string[] }

export type { PlaceBenefit, PlaceDiscountProvider } from './benefits'

/**
 * Proveedores con algún beneficio que cuenta, en el orden de la config, con los tipos de tarjeta que tienen: las filas
 * del panel "Descuentos" de la barra. Cambian sólo con una corrida del backoffice.
 */
export async function activeDiscountProviders(): Promise<DiscountProviderOption[]> {
  'use cache: remote'
  cacheLife('hours')
  cacheTag('discount-providers')
  const { rows } = await getDb().execute(discountProvidersQuery())
  const byProvider = new Map<string, string[]>()
  for (const row of rows as { id: string; cardType: string }[]) {
    if (isDiscountProvider(row.id)) byProvider.set(row.id, [...(byProvider.get(row.id) ?? []), row.cardType])
  }
  return byProviderOrder([...byProvider].map(([id, cardTypes]) => ({ id, name: providerName(id), cardTypes })), (row) => row.id)
}

/** Los descuentos de un lugar para su ficha, por proveedor. */
export async function placeDiscounts(placeId: string): Promise<PlaceDiscountProvider[]> {
  const { rows } = await getDb().execute(placeBenefitsQuery(placeId))
  return groupBenefits(rows as BenefitRow[])
}
