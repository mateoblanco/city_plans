import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { AI_CREDIT_URL, groundingIssues, guideGenerator, isNoCredit, type GuideLlmCall } from './generate.ts'
import type { PlacePromptRow } from './prompts.ts'
import type { GuidesStore } from './store.ts'

const row = (n: number, patch: Partial<PlacePromptRow> = {}): PlacePromptRow => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, name: `Lugar ${n}`, neighborhoodId: 'CORDON', locatedIn: null, categories: ['cafe'], tags: ['work'],
  signature: [], dishes: [], descriptionEs: `Café ${n} tranquilo.`, highlights: [], style: 'casual', dietVegan: null, dietVegetarian: null, dietGlutenFree: null, ...patch,
})
const ROWS = [1, 2, 3, 4].map((n) => row(n))
const draft = (texts: string[] = ['', '', '', '']) => ({
  idea: 'cafés para trabajar', title: 'Cafés donde nadie te apura', intro: '', neighborhoodId: 'CORDON', group: 'cafes',
  places: ROWS.map((place, index) => ({ placeId: place.id, text: texts[index] })),
})

/** Un store sólo con lo que usan las rutas de IA. */
function store() {
  let total = 0.1
  const addAiCost = vi.fn(async (_id: string, usd: number) => (total += usd))
  const value = {
    addAiCost,
    placesForPrompt: async (ids: string[]) => ROWS.filter((place) => ids.includes(place.id)),
    areaData: async () => ({ guides: [{ title: 'Cafés', group: 'cafes', neighborhoodId: 'CORDON' }], categories: ['cafe', 'cafe', 'bar'], tags: ['work'], placeCount: 3 }),
  } as unknown as GuidesStore
  return { store: value, addAiCost }
}

const call = (output: unknown, costUsd = 0.02): GuideLlmCall => vi.fn(async () => ({ output, costUsd }))
const post = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('validación de lo generado', () => {
  it('rechaza horarios, precios, superlativos y comparaciones que no están en los datos', () => {
    const data = ['descripcion: Café tranquilo.']
    expect(groundingIssues('Abre a las 9:00 y tiene buen café.', data)).toEqual(['un horario'])
    expect(groundingIssues('Un cortado a $120.', data)).toEqual(['un monto'])
    expect(groundingIssues('El mejor café de Cordón.', data)).toEqual(['un superlativo'])
    expect(groundingIssues('Más tranquilo que los otros.', data)).toEqual(['una comparación'])
    expect(groundingIssues('Café tranquilo para ir con la compu.', data)).toEqual([])
    // Si el dato lo dice, se puede repetir.
    expect(groundingIssues('Dicen que es el mejor chivito.', ['descripcion: El mejor chivito del barrio.'])).toEqual([])
  })

  it('superlativos y comparaciones: rechazados en lugares e introducciones, permitidos en los títulos', () => {
    const data = ['descripcion: Chivitos al pan.']
    expect(groundingIssues('Los mejores chivitos de Montevideo', data, { superlatives: false })).toEqual([])
    expect(groundingIssues('Los mejores chivitos de Montevideo', data, { superlatives: true })).toEqual(['un superlativo'])
    expect(groundingIssues('Más rico que el de la esquina.', data, { superlatives: false })).toEqual([])
    // Montos y horarios siguen rechazados también en los títulos.
    expect(groundingIssues('Chivitos a $500', data, { superlatives: false })).toEqual(['un monto'])
  })

  it('precio: sólo la palabra fija de los datos; nunca montos ni comparaciones de precio', () => {
    const cheap = ['precio: económico']
    expect(groundingIssues('Un café económico para quedarse.', cheap)).toEqual([])
    expect(groundingIssues('Un café de precio medio.', ['precio: precio medio'])).toEqual([])
    expect(groundingIssues('Es caro, pero vale la pena.', ['precio: caro'])).toEqual([])
    // Otra palabra que la de los datos, o sin precio en los datos: no.
    expect(groundingIssues('Un café barato.', cheap)).toEqual(['una palabra de precio'])
    expect(groundingIssues('Es accesible.', cheap)).toEqual(['una palabra de precio'])
    expect(groundingIssues('Un café caro.', cheap)).toEqual(['una palabra de precio'])
    expect(groundingIssues('Un café económico.', ['descripcion: Café.'])).toEqual(['una palabra de precio'])
    // Comparaciones de precio y montos: nunca, aunque el dato esté y también en un título.
    expect(groundingIssues('Más económico que los de 18 de Julio.', cheap, { superlatives: false })).toEqual(['una comparación de precio'])
    expect(groundingIssues('Un poco más caro que el resto.', ['precio: caro'])).toContain('una comparación de precio')
    expect(groundingIssues('Cortado a 120 pesos.', cheap)).toEqual(['un monto'])
    // "carne que" o "carta que" no son precio.
    expect(groundingIssues('La carne que sirven es de la casa, y la carta que tienen es corta.', ['descripcion: Parrilla.'])).toEqual([])
  })

  it('título con superlativo: pasa; el mismo superlativo en el texto de un lugar: 422', async () => {
    const title = await guideGenerator({ call: call({ title: 'Los mejores cafés: para laburar tranquilo' }) }).title(draft() as never, ROWS)
    expect(title.value.title).toBe('Los mejores cafés: para laburar tranquilo')
    const seo = await guideGenerator({ call: call({ seoTitle: 'Los mejores cafés de Cordón', seoDescription: 'Cuatro cafés de Cordón para ir con la compu, con wifi y mesa para apoyarse, donde podés quedarte la tarde.' }) }).seo(draft() as never, ROWS)
    expect(seo.value.seoTitle).toBe('Los mejores cafés de Cordón')
    await expect(guideGenerator({ call: call({ text: 'El mejor café de Cordón para trabajar.' }) }).place(draft() as never, ROWS[0])).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
    await expect(guideGenerator({ call: call({ paragraphs: ['Los mejores cafés de Cordón para trabajar tranquilo.'] }) }).intro(draft() as never, ROWS)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
  })

  it('una salida que no pasa el schema o que inventa (también al reintentar): error con lo pagado por los 2 intentos, sin valor', async () => {
    await expect(guideGenerator({ call: call({ text: '' }) }).place(draft() as never, ROWS[0])).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT', costUsd: 0.04 })
    await expect(guideGenerator({ call: call({ text: 'El mejor café, abre a las 8:00.' }) }).place(draft() as never, ROWS[0])).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
    const ok = await guideGenerator({ call: call({ text: 'Tranquilo y con mesa para la compu.' }) }).place(draft() as never, ROWS[0])
    expect(ok).toEqual({ value: { text: 'Tranquilo y con mesa para la compu.' }, costUsd: 0.02 })
  })

  it('reconoce el 402 del AI Gateway, también envuelto', () => {
    expect(isNoCredit({ statusCode: 402 })).toBe(true)
    expect(isNoCredit({ name: 'AI_RetryError', lastError: { cause: { statusCode: 402 } } })).toBe(true)
    expect(isNoCredit(new Error('Insufficient funds in your account'))).toBe(true)
    expect(isNoCredit({ statusCode: 429 })).toBe(false)
  })
})

describe('formato de título, intro y textos de lugares', () => {
  it('título: "Gancho: descripción"; sin dos puntos, 422', async () => {
    const ok = await guideGenerator({ call: call({ title: 'Primera cita sin ceremonia: bares y restaurantes para charlar tranquilos' }) }).title(draft() as never, ROWS)
    expect(ok.value.title).toBe('Primera cita sin ceremonia: bares y restaurantes para charlar tranquilos')
    await expect(guideGenerator({ call: call({ title: 'Bares para una primera cita' }) }).title(draft() as never, ROWS)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
  })

  it('intro: 2 o 3 frases, sin nombrar lugares de la guía', async () => {
    const two = await guideGenerator({ call: call({ sentences: ['Cafés tranquilos para quedarse la tarde.', 'Todos tienen mesa y wifi.'] }) }).intro(draft() as never, ROWS)
    expect(two.value.sentences).toHaveLength(2)
    await expect(guideGenerator({ call: call({ sentences: ['Una sola frase larga sobre el plan.'] }) }).intro(draft() as never, ROWS)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
    await expect(guideGenerator({ call: call({ sentences: ['Desde Lugar 1 hasta el último café.', 'Todos tienen wifi.'] }) }).intro(draft() as never, ROWS)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
  })

  it('texto de un lugar: el tema repetido, una muletilla o la carta enumerada dan 422', async () => {
    const rich = row(1, { dishes: ['pizza', 'faina', 'empanadas'] })
    const themed = { ...draft(), title: 'Primera cita sin ceremonia: bares y restaurantes para charlar' }
    await expect(guideGenerator({ call: call({ text: 'Café tranquilo, bueno para una primera cita.' }) }).place(themed as never, rich)).rejects.toMatchObject({ message: expect.stringMatching(/tema de la guía/) })
    await expect(guideGenerator({ call: call({ text: 'Café tranquilo, ideal para quedarse.' }) }).place(draft() as never, rich)).rejects.toMatchObject({ message: expect.stringMatching(/muletillas/) })
    await expect(guideGenerator({ call: call({ text: 'Café tranquilo con pizza, faina y empanadas.' }) }).place(draft() as never, rich)).rejects.toMatchObject({ message: expect.stringMatching(/más de 2 platos/) })
  })

  it('el prompt de un lugar lleva los textos que ya tiene la guía', async () => {
    const spy = call({ text: 'Café tranquilo con mesa larga.' })
    await guideGenerator({ call: spy }).place(draft() as never, ROWS[0], ['Otro texto ya escrito.'])
    expect((spy as unknown as { mock: { calls: { prompt: string }[][] } }).mock.calls[0][0].prompt).toMatch(/Textos que ya tiene la guía[\s\S]*Otro texto ya escrito\./)
  })
})

describe('POST /api/guides/generate', () => {
  it('genera, devuelve el borrador (no guarda texto) y suma el costo a la guía', async () => {
    const { store: s, addAiCost } = store()
    const app = createApp({ guidesStore: s, guidesPreview: { generator: guideGenerator({ call: call({ title: 'Cafés sin apuro: para laburar en Cordón' }, 0.015) }) } })
    const response = await app.request('/api/guides/generate', post({ kind: 'title', guideId: 'g1', draft: draft() }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ value: { kind: 'title', title: 'Cafés sin apuro: para laburar en Cordón' }, costUsd: 0.015 })
    expect(body.guideCostUsd).toBeCloseTo(0.115, 4)
    expect(addAiCost).toHaveBeenCalledWith('g1', 0.015)
  })

  it('sin crédito: 402 con el link para cargar', async () => {
    const failing: GuideLlmCall = async () => {
      throw Object.assign(new Error('Payment required'), { statusCode: 402 })
    }
    const app = createApp({ guidesStore: store().store, guidesPreview: { generator: guideGenerator({ call: failing }) } })
    const response = await app.request('/api/guides/generate', post({ kind: 'intro', draft: draft() }))
    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({ error: { code: 'AI_NO_CREDIT' }, creditUrl: AI_CREDIT_URL })
  })

  it('respuesta inválida: 422 sin valor, pero el costo pagado se suma igual', async () => {
    const { store: s, addAiCost } = store()
    const app = createApp({ guidesStore: s, guidesPreview: { generator: guideGenerator({ call: call({ seoTitle: 'x' }, 0.03) }) } })
    const response = await app.request('/api/guides/generate', post({ kind: 'seo', guideId: 'g1', draft: draft() }))
    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.value).toBeUndefined()
    expect(body.error.code).toBe('AI_INVALID_OUTPUT')
    // Los 2 intentos (el reintento con el motivo también falló): se pagaron los dos.
    expect(addAiCost).toHaveBeenCalledWith('g1', 0.06)
  })

  it('generar los vacíos: de a uno y en orden, cada uno con los textos de antes (los escritos y los recién generados)', async () => {
    const prompts: string[] = []
    let n = 0
    const sequential: GuideLlmCall = async ({ prompt }) => {
      prompts.push(prompt)
      return { output: { text: `Generado número ${++n}.` }, costUsd: 0.01 }
    }
    const app = createApp({ guidesStore: store().store, guidesPreview: { generator: guideGenerator({ call: sequential }) } })
    await app.request('/api/guides/generate', post({ kind: 'places-empty', draft: draft(['Escrito a mano antes.', '', '', '']) }))
    expect(prompts).toHaveLength(3)
    expect(prompts[0]).toMatch(/Escrito a mano antes\./)
    expect(prompts[0]).not.toMatch(/Generado número/)
    expect(prompts[2]).toMatch(/Generado número 1\.[\s\S]*Generado número 2\./)
  })

  it('generar los vacíos: saltea los que tienen texto y aguanta un error parcial (uno que falla también al reintentar)', async () => {
    let n = 0
    // El 2.º lugar inventa dos veces seguidas (llamadas 2 y 3): queda con error; los otros dos salen.
    const flaky: GuideLlmCall = async () => (++n === 2 || n === 3 ? { output: { text: 'El mejor de todos.' }, costUsd: 0.01 } : { output: { text: `Arranque distinto ${n}.` }, costUsd: 0.01 })
    const app = createApp({ guidesStore: store().store, guidesPreview: { generator: guideGenerator({ call: flaky }) } })
    const response = await app.request('/api/guides/generate', post({ kind: 'places-empty', draft: draft(['Ya tiene', '', '', '']) }))
    expect(response.status).toBe(200)
    const { value, costUsd } = await response.json()
    expect(value.texts).toHaveLength(2)
    expect(value.errors).toHaveLength(1)
    expect(value.texts.concat(value.errors).map((item: { placeId: string }) => item.placeId)).not.toContain(ROWS[0].id)
    expect(costUsd).toBeCloseTo(0.04, 4)
  })

  it('si el texto no pasa los chequeos, reintenta una vez con el texto anterior y el motivo; si el reintento pasa, sale ese', async () => {
    const rich = row(1, { dishes: ['pizza artesanal', 'risotto de cordero', 'lasagna de cordero'] })
    const prompts: string[] = []
    const outputs = [
      { text: 'Se hizo conocido por el risotto de cordero y la lasagna de cordero, y también hace pizza artesanal.' },
      { text: 'Se hizo conocido por el risotto de cordero y la lasagna de cordero braseado.' },
    ]
    const twice: GuideLlmCall = async ({ prompt }) => {
      prompts.push(prompt)
      return { output: outputs[prompts.length - 1], costUsd: 0.01 }
    }
    const result = await guideGenerator({ call: twice }).place(draft() as never, rich)
    expect(result).toEqual({ value: outputs[1], costUsd: 0.02 })
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).not.toMatch(/Tu intento anterior/)
    expect(prompts[1]).toMatch(/Tu intento anterior no sirve:\n«Se hizo conocido por el risotto de cordero y la lasagna de cordero, y también hace pizza artesanal\.»/)
    expect(prompts[1]).toMatch(/Problemas: más de 2 platos \(pizza artesanal, risotto de cordero, lasagna de cordero\)/)
  })

  it('un texto que pasa a la primera no se reintenta (una sola llamada, un solo costo)', async () => {
    const once = vi.fn(async () => ({ output: { text: 'Tranquilo, con mesa larga y buena luz.' }, costUsd: 0.01 }))
    const result = await guideGenerator({ call: once }).place(draft() as never, ROWS[0])
    expect(result.costUsd).toBe(0.01)
    expect(once).toHaveBeenCalledTimes(1)
  })

  it('sin generador: 503; sin lugares: 422; un lugar que no está en la guía: 422', async () => {
    expect((await createApp({ guidesStore: store().store }).request('/api/guides/generate', post({ kind: 'title', draft: draft() }))).status).toBe(503)
    const app = createApp({ guidesStore: store().store, guidesPreview: { generator: guideGenerator({ call: call({ title: 'x' }) }) } })
    expect((await app.request('/api/guides/generate', post({ kind: 'title', draft: { ...draft(), places: [] } }))).status).toBe(422)
    expect((await app.request('/api/guides/generate', post({ kind: 'place', draft: draft(), placeId: '00000000-0000-4000-8000-000000000009' }))).status).toBe(422)
  })

  it('intro de barrio con los datos del barrio; ai-status con saldo y link', async () => {
    const spy = call({ paragraphs: ['Cordón tiene cafés para trabajar y algún bar.'] })
    const app = createApp({ guidesStore: store().store, guidesPreview: { generator: guideGenerator({ call: spy }), balance: async () => 0 } })
    const response = await app.request('/api/guides/generate', post({ kind: 'neighborhood-intro', neighborhoodId: 'CORDON' }))
    expect((await response.json()).value).toEqual({ kind: 'area-intro', intro: 'Cordón tiene cafés para trabajar y algún bar.' })
    expect((spy as unknown as { mock: { calls: { prompt: string }[][] } }).mock.calls[0][0].prompt).toMatch(/Cafetería \(2\)|Café \(2\)/)
    expect(await (await app.request('/api/guides/ai-status')).json()).toMatchObject({ balanceUsd: 0, creditUrl: AI_CREDIT_URL, model: 'anthropic/claude-opus-5.5' })
  })
})
