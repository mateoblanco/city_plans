import { describe, expect, it } from 'vitest'
import { isPreviewKey, previewPath } from '../preview'
import { guideProxyAction, guideRoutes, isGuideRoute } from '../routes'
import { ALL_GUIDES, CORDON_BEERS, PUBLISHED_GUIDES } from './fixtures'

const SECRET = 'clave-de-prueba-123'

describe('rutas de /guides para el proxy', () => {
  const routes = new Set(guideRoutes(PUBLISHED_GUIDES))

  it('la ciudad, los barrios con página y cada guía con página en su URL plana, nada más', () => {
    expect([...routes].sort()).toEqual([
      '/guides/montevideo',
      '/guides/montevideo/cafes-donde-nadie-te-apura',
      '/guides/montevideo/cordon',
      '/guides/montevideo/pizzas-en-pocitos',
      '/guides/montevideo/sushi-para-una-cita',
      '/guides/montevideo/tapas-en-cordon',
      '/guides/montevideo/vinos-en-cordon',
    ])
    // Aunque la lista traiga borradores (no debería), no entran.
    expect(guideRoutes(ALL_GUIDES).sort()).toEqual([...routes].sort())
    expect(guideRoutes([])).toEqual(['/guides/montevideo'])
  })

  it('/guides redirige; la ciudad, el barrio con página y las guías siguen', () => {
    expect(guideProxyAction('/guides', routes).kind).toBe('redirect')
    for (const path of ['/guides/montevideo', '/guides/montevideo/cordon', '/guides/montevideo/cafes-donde-nadie-te-apura', '/guides/montevideo/pizzas-en-pocitos']) {
      expect(guideProxyAction(path, routes).kind, path).toBe('next')
    }
  })

  it('la ruta vieja /guides/montevideo/<barrio>/<slug> es 404, sin redirect', () => {
    expect(guideProxyAction('/guides/montevideo/cordon/cafes-donde-nadie-te-apura', routes).kind).toBe('notFound')
    expect(guideProxyAction('/guides/montevideo/pocitos/pizzas-en-pocitos', routes).kind).toBe('notFound')
  })

  it('un barrio debajo del mínimo es 404 (aunque tenga guías); un borrador o una guía sin lugares publicados, también', () => {
    expect(guideProxyAction('/guides/montevideo/pocitos', routes).kind).toBe('notFound')
    expect(guideProxyAction('/guides/montevideo/cervezas-artesanales', routes).kind).toBe('notFound')
    expect(guideProxyAction('/guides/montevideo/brunch-en-pocitos', routes).kind).toBe('notFound')
  })

  it('lo que no existe: 404', () => {
    for (const path of ['/guides/montevideo/xyz', '/guides/buenos-aires', '/guides/montevideo/__none__', '/guides/montevideo/cafes-donde-nadie-te-apura/extra']) {
      expect(guideProxyAction(path, routes).kind, path).toBe('notFound')
    }
  })

  it('con barra final cuenta como la misma ruta; con mayúsculas, no; sin lista, deja pasar', () => {
    expect(isGuideRoute('/guides/montevideo/cordon/', routes)).toBe(true)
    expect(isGuideRoute('/guides/montevideo/Cordon', routes)).toBe(false)
    expect(guideProxyAction('/guides/montevideo/cordon', null).kind).toBe('next')
  })
})

describe('vista previa', () => {
  const routes = new Set(guideRoutes(PUBLISHED_GUIDES))

  it('con la clave correcta, un borrador se reescribe a /guide-preview/montevideo/<slug>', () => {
    expect(guideProxyAction(`/guides/montevideo/${CORDON_BEERS.slug}`, routes, { preview: SECRET, secret: SECRET })).toEqual({
      kind: 'preview',
      path: '/guide-preview/montevideo/cervezas-artesanales',
    })
  })

  it('la ruta vieja con barrio no tiene vista previa: 404', () => {
    expect(guideProxyAction('/guides/montevideo/cordon/cervezas-artesanales', routes, { preview: SECRET, secret: SECRET }).kind).toBe('notFound')
  })

  it('sin la clave o con otra, un borrador es 404; /guide-preview directo, siempre 404', () => {
    expect(guideProxyAction('/guides/montevideo/cervezas-artesanales', routes, { preview: 'otra', secret: SECRET }).kind).toBe('notFound')
    expect(guideProxyAction('/guide-preview/montevideo/cervezas-artesanales', routes, { preview: SECRET, secret: SECRET }).kind).toBe('notFound')
  })

  it('isPreviewKey: sin variable, vacía o distinta, nunca', () => {
    expect(isPreviewKey(SECRET, SECRET)).toBe(true)
    expect(isPreviewKey(SECRET, undefined)).toBe(false)
    expect(isPreviewKey('', SECRET)).toBe(false)
    expect(isPreviewKey(`${SECRET}x`, SECRET)).toBe(false)
  })

  it('previewPath: sólo /guides/montevideo/<slug>', () => {
    expect(previewPath('/guides/montevideo/x')).toBe('/guide-preview/montevideo/x')
    expect(previewPath('/guides/montevideo/x/')).toBe('/guide-preview/montevideo/x')
    expect(previewPath('/guides/montevideo/cordon/x')).toBeNull()
    expect(previewPath('/guides/montevideo')).toBeNull()
  })
})
