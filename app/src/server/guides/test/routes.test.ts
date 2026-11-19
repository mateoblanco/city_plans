import { describe, expect, it } from 'vitest'
import { GUIDES, guidePath, visibleGuides } from '../catalog'
import { guideProxyAction, guideRoutes, isGuideRoute } from '../routes'

describe('rutas de /guides para el proxy', () => {
  const production = guideRoutes(visibleGuides({ NODE_ENV: 'production' }))
  const development = guideRoutes(visibleGuides({ NODE_ENV: 'development' }))

  it('en producción: la ciudad, el barrio con guías publicadas y cada guía publicada, nada más', () => {
    expect([...production].sort()).toEqual(['/guides/montevideo', '/guides/montevideo/cordon', '/guides/montevideo/cordon/cafes-donde-nadie-te-apura'])
  })

  it('/guides redirige; /guides/montevideo, el barrio y las guías siguen', () => {
    expect(guideProxyAction('/guides', production)).toBe('redirect')
    expect(guideProxyAction('/guides/', production)).toBe('redirect')
    for (const path of ['/guides/montevideo', '/guides/montevideo/cordon', '/guides/montevideo/cordon/cafes-donde-nadie-te-apura']) {
      expect(guideProxyAction(path, production), path).toBe('next')
    }
  })

  it('la guía de ciudad (en desarrollo) sigue al mismo nivel que los barrios', () => {
    expect(guideProxyAction('/guides/montevideo/sushi-para-una-cita', development)).toBe('next')
    expect(guideProxyAction('/guides/montevideo/pocitos', development)).toBe('next')
  })

  it('los borradores dan 404 en producción', () => {
    for (const draft of GUIDES.filter((guide) => guide.draft)) {
      expect(guideProxyAction(guidePath(draft), production), guidePath(draft)).toBe('notFound')
      expect(guideProxyAction(guidePath(draft), development)).toBe('next')
    }
    expect(guideProxyAction('/guides/montevideo/pocitos', production)).toBe('notFound')
  })

  it('lo que no existe: 404', () => {
    for (const path of ['/guides/montevideo/xyz', '/guides/montevideo/cordon/xyz', '/guides/buenos-aires', '/guides/montevideo/cordon/cafes-donde-nadie-te-apura/extra', '/guides/montevideo/sushi-para-una-cita/extra']) {
      expect(guideProxyAction(path, production), path).toBe('notFound')
    }
  })

  it('con barra final cuenta como la misma ruta; con mayúsculas, no', () => {
    expect(isGuideRoute('/guides/montevideo/cordon/', production)).toBe(true)
    expect(isGuideRoute('/guides/montevideo/Cordon', production)).toBe(false)
  })
})
