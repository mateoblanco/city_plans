import type { Guide } from '../../types'

/** BORRADOR de prueba (draft): sólo para ver el diseño de la página del barrio con varios grupos. No se publica. */
export const CORDON_SHARE: Guide = {
  draft: true,
  slug: 'para-compartir-con-amigos',
  city: 'montevideo',
  neighborhood: 'CORDON',
  group: 'eat',
  title: 'Para compartir con amigos',
  seoTitle: 'Tapas y picadas para compartir en Cordón · Salimos',
  seoDescription: 'Bares de tapas y picadas en Cordón para ir en grupo y pedir al centro.',
  intro: ['Borrador: lugares para pedir varios platos al centro.'],
  updatedAt: '2026-11-19',
  places: [
    {
      // Demorondanga Bar
      id: '14f62e15-776e-4c70-9702-b550caeeda87',
      text: 'Bar de tapas informal con carta en pizarra que cambia seguido. Vino, vinilos y platos para compartir.',
    },
    {
      // Inmigrantes MVD
      id: 'd7ac9704-4667-45ab-9165-ee3439996e63',
      text: 'Un viejo bar de barrio reconvertido, con tapas y cocina uruguaya. Abajo, un sótano con música en vivo.',
    },
    {
      // Malevo Bar
      id: '7f87ae17-47ca-4bde-bff0-49c94d61ebe3',
      text: 'Picadas, pizzas y tragos en Gaboto y Guayabos. Pensado para juntarse con amigos y festejar.',
    },
  ],
}
