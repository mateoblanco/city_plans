import type { Guide } from '../types'

/** BORRADOR de prueba (draft): una guía de toda la ciudad (sin barrio). No se publica. */
export const MONTEVIDEO_SUSHI_DATE: Guide = {
  draft: true,
  slug: 'sushi-para-una-cita',
  city: 'montevideo',
  group: 'eat',
  title: 'Lugares de sushi para una cita',
  seoTitle: 'Sushi para una cita en Montevideo · Salimos',
  seoDescription: 'Restaurantes de sushi en Montevideo para ir en pareja: cocina de autor, nikkei y deck frente a la rambla.',
  intro: ['Borrador: sushi en distintos barrios, para una salida de a dos.'],
  updatedAt: '2026-11-19',
  places: [
    {
      // Umami Sushi (Punta Carretas)
      id: 'b454bb84-a22b-4e8a-8777-06b0f7e08e9b',
      text: 'Sushi y cocina japonesa de autor, con tragos de la casa y un deck al aire libre.',
    },
    {
      // Naru Sushi Bar (Punta Carretas)
      id: '7164c26b-b415-4a32-a235-17f8397f2f4c',
      text: 'Sushi con giro nikkei y sudamericano, rolls y ramen, en un ambiente acogedor.',
    },
    {
      // Nagasaki Sushi (Parque Rodó)
      id: '47d5f757-5fe9-4634-acd3-6809a8e571d5',
      text: 'Rolls, nigiris, ceviches y tiraditos con toques peruanos, sobre Bulevar Artigas. Bien para una cena.',
    },
    {
      // Meraki (Pocitos)
      id: '5a8b9da4-5e66-4751-a944-d0edfbf01488',
      text: 'Sushi con deck frente a la rambla y vista al mar. Conocido por su sushi libre.',
    },
  ],
}
