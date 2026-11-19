import type { Guide } from '../../types'

/** BORRADOR de prueba (draft): sólo para ver el diseño de la página del barrio con varios grupos. No se publica. */
export const CORDON_BEERS: Guide = {
  draft: true,
  slug: 'cervezas-artesanales',
  city: 'montevideo',
  neighborhood: 'CORDON',
  group: 'bars',
  title: 'Cervezas artesanales en Cordón',
  seoTitle: 'Cervecerías artesanales en Cordón · Salimos',
  seoDescription: 'Cervecerías y bares de Cordón con cerveza artesanal tirada, patios y algo para picar.',
  intro: ['Borrador: cervecerías del barrio con canillas propias o mucha variedad tirada.'],
  updatedAt: '2026-11-19',
  places: [
    {
      // La Fábrica Bar
      id: '3addc558-8e77-4df3-90c3-afbfe24df251',
      text: 'Bar y cervecería artesanal con buena variedad de cervezas y tragos. Pizzas y picadas para compartir con amigos.',
    },
    {
      // Cervecería Shelter
      id: 'c614b818-2800-4ca5-a5cb-f030d792709d',
      text: 'Patio cervecero con cervezas de elaboración propia, mesas y livings. Pizzetas, hamburguesas y chivitos para acompañar.',
    },
    {
      // Matute
      id: '9826e708-fdef-4ee8-ae4a-e6ff0bf95c3a',
      text: 'Cuarenta canillas, incluida su propia Mist, y cocina al horno de barro. Para después de la oficina o para festejar.',
    },
    {
      // Duna
      id: '2871c44e-2610-48ad-aa49-c92f87d96e5f',
      text: 'Tapas y pizzas al horno a leña, mucha cerveza artesanal tirada y patio. Va bien para un after office.',
    },
  ],
}
