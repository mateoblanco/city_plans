import { describe, expect, it } from 'vitest'
import { analyticsUrl } from '../analytics-url'

describe('analyticsUrl', () => {
  it('saca el texto de búsqueda y deja los filtros', () => {
    expect(analyticsUrl('https://www.adondevamos.com.uy/search?q=caf%C3%A9+con+mi+novia&intent=cafes&f=open:now'))
      .toBe('https://www.adondevamos.com.uy/search?intent=cafes&f=open%3Anow')
  })

  it('saca las coordenadas del near viejo y la clave de vista previa', () => {
    expect(analyticsUrl('https://www.adondevamos.com.uy/search?near=-34.9,-56.1&loc=all')).toBe('https://www.adondevamos.com.uy/search?loc=all')
    expect(analyticsUrl('https://www.adondevamos.com.uy/guides/montevideo/x?preview=secreto')).toBe('https://www.adondevamos.com.uy/guides/montevideo/x')
  })

  it('sin parámetros, la misma URL', () => {
    expect(analyticsUrl('https://www.adondevamos.com.uy/place/trouville')).toBe('https://www.adondevamos.com.uy/place/trouville')
  })

  it('una URL que no se puede leer va sin query', () => {
    expect(analyticsUrl('no es una url?q=hola')).toBe('no es una url')
  })
})
