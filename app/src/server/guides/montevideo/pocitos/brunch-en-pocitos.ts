import type { Guide } from '../../types'

/** BORRADOR de prueba (draft): una guía de otro barrio, para ver la sección Barrios. No se publica. */
export const POCITOS_BRUNCH: Guide = {
  draft: true,
  slug: 'brunch-en-pocitos',
  city: 'montevideo',
  neighborhood: 'POCITOS',
  group: 'eat',
  title: 'Brunch en Pocitos',
  seoTitle: 'Brunch en Pocitos · Salimos',
  seoDescription: 'Dónde hacer un brunch en Pocitos, Montevideo: scones, masa madre, cocina de estación y patios.',
  intro: ['Borrador: brunch en Pocitos.'],
  updatedAt: '2026-11-18',
  places: [
    {
      // Fragolina
      id: '095af98f-3e1a-4ee0-8902-a768ad498e20',
      text: 'Casa de café, brunch y té, tranquila y con mucha luz. Conocida por sus scones de queso.',
    },
    {
      // Plantado Restaurant
      id: 'bfde5b89-d781-497f-a931-cc6207a54c36',
      text: 'El restaurante del Hyatt Centric, con cocina de autor y de estación, y un olivo en el salón.',
    },
    {
      // Jesusa Almacén
      id: 'e417b7ba-5883-45bb-98eb-48eaf38e6d88',
      text: 'Almacén de esquina con panes de masa madre, porciones abundantes y cannoli de postre.',
    },
    {
      // Café del Jardín
      id: 'bcaf9d9e-8436-4ade-a33c-29dfea2d0a0a',
      text: 'Café de especialidad en una casona de 1923, con pastelería casera y patio.',
    },
  ],
}
