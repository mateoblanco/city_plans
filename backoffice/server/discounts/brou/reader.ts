import type { DiscountBenefit, DiscountRunError, ProviderPlaceLocation } from '../../../src/types/discounts.ts'
import { normalizeTier } from '../bbva/parse-detail.ts'
import { DiscountSourceError } from '../errors.ts'
import { providerPages } from '../itau/reader.ts'
import { benefitId, dedupeBenefitIds, type ProviderReader, type ReadPlace } from '../reader.ts'
import { mentionsDebit } from '../santander/benefit-text.ts'
import { fold, parseCap, parseDays } from '../text.ts'
import { departmentBlocks, pdfFragments, type DepartmentBlock } from './extract-pdf.ts'
import { parseBrouCampaign, type BrouCampaign, type CampaignBenefit } from './parse-campaign.ts'
import { brouRowSplitter, type RowSplitter } from './split-rows.ts'

const slug = (value: string) => fold(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

type Llm = { calls: number; costUsd: number }

/** Las líneas de beneficio que las reglas no leyeron, con el modelo (validado: nunca un débito que la línea no dice). */
async function pendingBenefits(campaign: BrouCampaign, structure: Parameters<ProviderReader>[0]['structure'], llm: Llm, warnings: string[]): Promise<CampaignBenefit[]> {
  const benefits: CampaignBenefit[] = []
  for (const line of campaign.pending) {
    if (!structure) {
      warnings.push(`${campaign.title}: sin modelo configurado, no se leyó «${line}».`)
      continue
    }
    const result = await structure(line)
    if (!result.cached) {
      llm.calls += 1
      llm.costUsd += result.costUsd
    }
    for (const raw of result.benefits) {
      if (raw.cardType === 'debit' && !mentionsDebit(line)) {
        warnings.push(`${campaign.title}: el modelo propuso un débito que «${line}» no dice: descartado.`)
        continue
      }
      const days = raw.daysText ? parseDays(raw.daysText) : parseDays(line)
      benefits.push({
        percent: raw.percent,
        cardType: raw.cardType,
        cardTiers: raw.cardTiers.map(normalizeTier),
        cardProgram: null,
        days: days.days,
        daysText: raw.daysText ?? days.daysText,
        mode: campaign.mode,
        instantPercent: campaign.mode === 'instant' ? raw.percent : null,
        refundPercent: campaign.mode === 'refund' ? raw.percent : null,
        cap: parseCap(raw.cap),
        validFrom: campaign.validFrom,
        validTo: campaign.validTo,
        conditions: campaign.conditions,
        sourceText: line,
        parsedBy: 'llm',
      })
    }
  }
  return benefits
}

/** Separa las filas de un departamento (por celdas o con el modelo). Si no se puede, error del proveedor. */
async function splitBlock(splitRows: RowSplitter, block: DepartmentBlock, llm: Llm, providerId: string, pdfUrl: string) {
  try {
    const result = await splitRows(block)
    llm.calls += result.modelCalls
    llm.costUsd += result.costUsd
    return result
  } catch (error) {
    // Un departamento sin leer no es "desapareció": mejor no escribir nada que dejar sus locales inactivos.
    throw new DiscountSourceError(providerId, `No se pudieron separar nombre y dirección de ${block.department}: ${error instanceof Error ? error.message : String(error)}`, pdfUrl)
  }
}

/**
 * BROU: cada campaña (una página en config/discount-sources.json) tiene los beneficios en la página y los locales en un
 * PDF que se linkea desde ahí (el nombre cambia). Los beneficios son iguales para todos los locales de la campaña. Un
 * lugar por departamento y nombre (`brou:montevideo:rest-fans`), con un local por fila; sólo los de Montevideo se
 * geocodifican (son los únicos que se cruzan).
 */
export const readBrou: ProviderReader = async ({ provider, fetcher, structure, splitRows = brouRowSplitter(), geocoder, onProgress }) => {
  const pages = providerPages(provider)
  const warnings: string[] = []
  const errors: DiscountRunError[] = []
  const notes: string[] = []
  const llm: Llm = { calls: 0, costUsd: 0 }
  const places = new Map<string, ReadPlace>()
  const geo = { hits: 0, cached: 0, misses: [] as string[] }
  const split = { cells: 0, model: 0, modelRows: 0, cached: 0 }

  onProgress?.({ phase: 'listing', done: 0, total: pages.length })
  for (const [pageIndex, page] of pages.entries()) {
    const campaign = parseBrouCampaign(await fetcher.get(page.url), page.url, provider.id)
    warnings.push(...campaign.warnings)
    const benefits = [...campaign.benefits, ...(await pendingBenefits(campaign, structure, llm, warnings))]
    if (benefits.length === 0) throw new DiscountSourceError(provider.id, `La campaña «${campaign.title}» no tiene beneficios legibles.`, page.url)

    if (!fetcher.getBytes) throw new DiscountSourceError(provider.id, 'El fetcher no baja archivos binarios (PDF).', campaign.pdfUrl)
    let blocks: DepartmentBlock[]
    try {
      const parsed = departmentBlocks(await pdfFragments(await fetcher.getBytes(campaign.pdfUrl)))
      blocks = parsed.blocks
      warnings.push(...parsed.problems.map((problem) => `${campaign.title}: ${problem}`))
    } catch (error) {
      if (error instanceof DiscountSourceError) throw error
      throw new DiscountSourceError(provider.id, `No se pudo leer el PDF de la campaña «${campaign.title}»: ${error instanceof Error ? error.message : String(error)}`, campaign.pdfUrl)
    }
    if (blocks.length === 0) throw new DiscountSourceError(provider.id, `El PDF de la campaña «${campaign.title}» no tiene tablas de locales por departamento (¿cambió el formato?).`, campaign.pdfUrl)

    const byDepartment: string[] = []
    for (const block of blocks) {
      const { rows, aligned, cached, method } = await splitBlock(splitRows, block, llm, provider.id, campaign.pdfUrl)
      if (method === 'cells') split.cells += 1
      else {
        split.model += 1
        split.modelRows += rows.length
        if (cached) split.cached += 1
      }
      if (!aligned) warnings.push(`${campaign.title}: en ${block.department} el PDF tiene celdas pegadas; la separación del modelo sólo se pudo validar por el texto, no por las celdas.`)
      byDepartment.push(`${block.department} ${rows.length}`)
      for (const row of rows) {
        const id = `${provider.id}:${slug(block.department)}:${slug(row.name)}`
        const location: ProviderPlaceLocation = { address: row.address, area: row.city, department: block.department, mapsUrl: null }
        const place = places.get(id) ?? {
          id,
          providerId: provider.id,
          sourceName: row.name,
          category: null,
          city: null,
          departments: [block.department],
          montevideo: block.department === 'Montevideo',
          locations: [],
          website: null,
          instagram: null,
          sourceUrl: page.url,
          logoUrl: null,
          description: null,
          sourceTags: [],
          campaign: { validFrom: campaign.validFrom, validTo: campaign.validTo, text: campaign.text },
          benefits: [],
        }
        if (!place.locations.some((item) => fold(item.address) === fold(row.address) && fold(item.area ?? '') === fold(row.city))) place.locations.push(location)
        if (!place.sourceTags.includes(page.label)) place.sourceTags.push(page.label)
        const fromThisPage = place.benefits.some((benefit) => benefit.sourceUrl === page.url)
        if (!fromThisPage) {
          const own: DiscountBenefit[] = benefits.map((benefit) => ({ ...benefit, id: benefitId(id, benefit.cardType, benefit.cardTiers), sourceUrl: page.url }))
          place.benefits = dedupeBenefitIds([...place.benefits, ...own])
        }
        places.set(id, place)
      }
    }
    notes.push(`${campaign.title}: ${byDepartment.join(', ')} (PDF ${decodeURIComponent(campaign.pdfUrl.split('/').pop() ?? '')}).`)
    onProgress?.({ phase: 'listing', done: pageIndex + 1, total: pages.length })
  }

  for (const place of places.values()) {
    const cities = [...new Set(place.locations.map((location) => location.area).filter(Boolean))]
    place.city = cities.join(', ') || null
  }

  // Coordenadas de los locales de Montevideo (la IDE Uruguay, cacheado); sin coordenadas, el cruce va por nombre.
  const montevideo = [...places.values()].filter((place) => place.montevideo).flatMap((place) => place.locations)
  onProgress?.({ phase: 'details', done: 0, total: montevideo.length })
  for (const [index, location] of montevideo.entries()) {
    if (!geocoder) {
      location.coordinates = null
      continue
    }
    try {
      const outcome = await geocoder.geocode({ address: location.address, city: location.area ?? 'MONTEVIDEO', department: 'Montevideo' })
      location.coordinates = outcome.hit ? { lat: outcome.hit.lat, lng: outcome.hit.lng } : null
      if (outcome.cached) geo.cached += 1
      if (outcome.hit) geo.hits += 1
      else geo.misses.push(`${location.address} (${outcome.reason ?? 'sin resultado'})`)
    } catch (error) {
      location.coordinates = null
      errors.push({ providerId: provider.id, url: 'https://direcciones.ide.uy', message: `No se pudo geocodificar «${location.address}»: ${error instanceof Error ? error.message : String(error)}` })
    }
    onProgress?.({ phase: 'details', done: index + 1, total: montevideo.length })
  }

  notes.push(`Nombre y dirección: ${split.cells} departamentos por las celdas del PDF; ${split.model} con el modelo (${split.modelRows} filas${split.model ? `, ${split.cached} departamentos del cache` : ''}).`)
  if (geocoder) {
    notes.push(`Geocodificador (IDE Uruguay): ${geo.hits} de ${montevideo.length} locales de Montevideo con coordenadas (${geo.cached} del cache, ${geocoder.requests} pedidos).`)
    if (geo.misses.length) notes.push(`Sin coordenadas (se cruzan por nombre): ${geo.misses.join('; ')}.`)
  } else {
    warnings.push('Sin geocodificador: los locales de Montevideo quedan sin coordenadas y se cruzan por nombre.')
  }
  return { places: [...places.values()], unread: [], errors, warnings, notes, llm }
}
