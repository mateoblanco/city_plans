import { describe, expect, it } from 'vitest'
import { factsBlock, PLACE_FACT_KEYS, placeFacts, placePrompt, systemPrompt, titlePrompt, type PlacePromptRow } from './prompts.ts'

/** Un lugar de prueba con TODAS las columnas de places, también las que nunca pueden llegar al modelo. */
const FULL_ROW = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Inocencio Café',
  neighborhoodId: 'CORDON',
  locatedIn: 'Mercado Ferrando',
  categories: ['cafe'],
  tags: ['work', 'wifi', 'cozy', 'brunch'],
  signature: ['brunch'],
  dishes: ['sándwich caliente'],
  descriptionEs: 'Café tranquilo para ir con la compu.',
  highlights: [{ es: 'Sándwich caliente', en: 'Hot sandwich' }],
  style: 'casual',
  dietVegan: 'no',
  dietVegetarian: 'has_options',
  dietGlutenFree: 'unknown',
  // Al modelo le llega como "caro", nunca el id.
  price: 'high',
  // Prohibidos: nunca en el prompt.
  reservations: 'recommended',
  hours: { raw: 'Lunes a viernes 8:00 a 20:00', slots: [{ day: 1, opens: '08:00', closes: '20:00' }], status: 'exact' },
  instagram: 'inocencio.cafe',
  website: 'https://inocencio.uy',
  igFollowers: 12345,
  prominence: 0.73,
  chainBranch: false,
  brandKey: 'inocencio',
  featured: true,
  logoKey: 'logos/abc.webp',
  googlePlaceId: 'ChIJ_PROHIBIDO',
  location: { lat: -34.9012345, lng: -56.1712345 },
  descriptionEn: 'Quiet coffee shop.',
  embeddingText: 'TEXTO_DE_EMBEDDING',
  keywordText: 'TEXTO_DE_KEYWORDS',
  manualOverrides: { price: 'high' },
  reviewReasons: ['low_rating'],
  status: 'published',
} satisfies PlacePromptRow

const FORBIDDEN_VALUES = ['high', 'recommended', '8:00', '20:00', 'inocencio.cafe', 'https://inocencio.uy', '12345', '0.73', 'logos/abc.webp', 'ChIJ_PROHIBIDO', '-34.90', '-56.17', 'Quiet coffee', 'TEXTO_DE_EMBEDDING', 'TEXTO_DE_KEYWORDS', 'low_rating']

const DRAFT = { idea: 'cafés para trabajar', title: '', intro: '', neighborhoodId: 'CORDON', group: 'cafes' as const }

describe('lo que llega al modelo de cada lugar', () => {
  it('placeFacts sólo tiene claves permitidas, con labels en español; el precio como palabra fija', () => {
    const facts = placeFacts(FULL_ROW)
    expect(facts.precio).toBe('caro')
    expect(placeFacts({ ...FULL_ROW, price: 'low' }).precio).toBe('económico')
    expect(placeFacts({ ...FULL_ROW, price: 'moderate' }).precio).toBe('precio medio')
    expect(placeFacts({ ...FULL_ROW, price: 'unknown' })).not.toHaveProperty('precio')
    for (const key of Object.keys(facts)) expect(PLACE_FACT_KEYS).toContain(key)
    expect(facts).toMatchObject({
      nombre: 'Inocencio Café',
      barrio: 'Cordón',
      dentro_de: 'Mercado Ferrando',
      descripcion: 'Café tranquilo para ir con la compu.',
      platos: ['sándwich caliente'],
      dietas: ['Vegetariano: tiene opciones'],
    })
  })

  it('el prompt armado (system + pedido) no trae ningún valor prohibido', () => {
    const text = `${systemPrompt('ESTILO')}\n${placePrompt(DRAFT, placeFacts(FULL_ROW))}\n${titlePrompt(DRAFT, [placeFacts(FULL_ROW)])}`
    for (const value of FORBIDDEN_VALUES) expect(text, value).not.toContain(value)
    // Ningún id interno: van labels.
    expect(text).not.toMatch(/\bwork\b|\bcafe\b/)
  })

  it('un dato vacío no aparece; con pocos datos se pide una sola oración', () => {
    const sparse = { ...FULL_ROW, price: 'unknown', locatedIn: null, descriptionEs: '  ', tags: [], signature: [], dishes: [], highlights: [], style: null, dietVegetarian: 'no' }
    const facts = placeFacts(sparse)
    expect(Object.keys(facts).sort()).toEqual(['barrio', 'nombre', 'tipo'])
    const block = factsBlock(facts)
    expect(block).not.toMatch(/dentro_de|descripcion|dietas|platos/)
    expect(placePrompt(DRAFT, facts)).toMatch(/una sola oración/)
  })

  it('el system lleva la guía de estilo del archivo de config, sin sus comentarios', () => {
    const system = systemPrompt()
    expect(system).toMatch(/Guía de estilo de las guías/)
    expect(system).toMatch(/voseo/)
    expect(system).not.toMatch(/<!--|no va al modelo/)
    expect(system).toMatch(/Usá SÓLO los datos que te paso/)
  })
})
