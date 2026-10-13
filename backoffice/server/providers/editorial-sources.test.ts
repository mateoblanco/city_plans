import { describe, expect, it } from 'vitest'
import { editorialSignals, isEditorialSource, registrableDomain } from './editorial-sources.ts'

const context = { brand: 'El Palenque', websiteUrl: 'https://www.elpalenque.com.uy/' }
const page = (url: string, text = 'Fuimos a El Palenque, en el Mercado del Puerto.', title = '') => ({ url, title, text })

describe('registrableDomain', () => {
  it('saca www y subdominios, respetando los segundos niveles de los ccTLD', () => {
    expect(registrableDomain('www.montevideo.com.uy')).toBe('montevideo.com.uy')
    expect(registrableDomain('galeria.busqueda.com.uy')).toBe('busqueda.com.uy')
    expect(registrableDomain('blog.example.com')).toBe('example.com')
  })
})

describe('isEditorialSource', () => {
  it('cuenta un medio conocido que nombra al lugar', () => {
    expect(isEditorialSource(page('https://www.elpais.com.uy/gastronomia/x', 'El Palenque abrió en 1993.'), context)).toBe(true)
  })

  it('cuenta un blog desconocido por palabras clave del título o la URL', () => {
    expect(isEditorialSource(page('https://comerenmvd.com/blog/palenque'), context)).toBe(true)
    expect(isEditorialSource(page('https://sabores.uy/notas/palenque', 'El Palenque y su parrilla.'), context)).toBe(true)
    expect(isEditorialSource(page('https://sabores.uy/p/123', 'El Palenque.', 'Probamos El Palenque'), context)).toBe(true)
  })

  it('no mira palabras clave en el texto: la plantilla de un directorio no la hace editorial', () => {
    expect(isEditorialSource(page('https://directorio.example/local/123', 'El Palenque. Reseñas. Los mejores restaurantes. Blog.'), context)).toBe(false)
  })

  it('no cuenta agregadores ni sitios de gobierno aunque tengan palabras editoriales', () => {
    expect(isEditorialSource(page('https://1122.com.uy/local/el-palenque/LOC1', 'El Palenque', 'Los mejores'), context)).toBe(false)
    expect(isEditorialSource(page('https://www.gub.uy/ministerio/comunicacion/noticias/el-palenque'), context)).toBe(false)
  })

  it('no cuenta directorios, delivery, la web propia, el resumen de Exa ni páginas sin la marca', () => {
    expect(isEditorialSource(page('https://www.tripadvisor.com.uy/Restaurant_Review-el_palenque'), context)).toBe(false)
    expect(isEditorialSource(page('https://www.saliracomer.com/restaurantes/el-palenque'), context)).toBe(false)
    expect(isEditorialSource(page('https://www.rappi.com.uy/restaurantes/el-palenque'), context)).toBe(false)
    expect(isEditorialSource(page('https://www.pedidosya.com.uy/restaurantes/montevideo/el-palenque'), context)).toBe(false)
    expect(isEditorialSource(page('https://elpalenque.com.uy/blog/historia'), context)).toBe(false)
    expect(isEditorialSource(page('https://exa.ai/'), context)).toBe(false)
    expect(isEditorialSource(page('https://www.elpais.com.uy/gastronomia/x', 'Otra parrilla del puerto.'), context)).toBe(false)
  })

  it('no cuenta una página comercial desconocida sin palabras editoriales', () => {
    expect(isEditorialSource(page('https://montevideoshopping.com.uy/locales', 'El Palenque. Local 120. Gastronomía.'), context)).toBe(false)
  })
})

describe('editorialSignals', () => {
  it('cuenta cada dominio una sola vez', () => {
    const signals = editorialSignals([
      page('https://www.elpais.com.uy/a', 'El Palenque, una parrilla.'),
      page('https://www.elpais.com.uy/b', 'Volvimos a El Palenque.'),
      page('https://www.ladiaria.com.uy/c', 'El Palenque.'),
    ], context)
    expect(signals).toMatchObject({ editorialMentions: 2, listedOrAwarded: false })
  })

  it('marca listedOrAwarded con un ranking o un premio en el título o la URL de una fuente editorial', () => {
    expect(editorialSignals([page('https://www.montevideo.com.uy/x', 'El Palenque.', 'Las 10 mejores parrillas de Montevideo')], context).listedOrAwarded).toBe(true)
    expect(editorialSignals([page('https://www.elobservador.com.uy/el-palenque-premiado-mejor-parrilla', 'El Palenque.')], context).listedOrAwarded).toBe(true)
  })

  it('ignora el sufijo del sitio en el título', () => {
    const suffixed = page('https://www.alacarta.com.uy/el-palenque-clasico/', 'El Palenque.', 'El Palenque, un clásico - A La Carta - Portal de gastronomía - Donde comer bien en Montevideo')
    expect(editorialSignals([suffixed], context)).toMatchObject({ editorialMentions: 1, listedOrAwarded: false })
    expect(editorialSignals([page('https://www.montevideo.com.uy/x', 'El Palenque.', 'Las 10 mejores parrillas | Montevideo Portal')], context).listedOrAwarded).toBe(true)
  })

  it('un ranking o premio sólo en el texto no marca listedOrAwarded', () => {
    expect(editorialSignals([page('https://www.elobservador.com.uy/x', 'El Palenque fue premiado. Dónde comer: los mejores.')], context))
      .toMatchObject({ editorialMentions: 1, listedOrAwarded: false })
  })

  it('un ranking en una fuente no editorial no cuenta', () => {
    expect(editorialSignals([page('https://www.tripadvisor.com/x', 'El Palenque.', 'Los 10 mejores restaurantes')], context))
      .toEqual({ editorialMentions: 0, listedOrAwarded: false, editorialHosts: [] })
  })
})
